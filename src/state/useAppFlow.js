import { useCallback, useEffect, useRef, useState } from 'react';
import { connectWallet, requestWalletAccounts, fetchClusterData } from '../data/public.js';
import { enrichCluster } from '../data/enrich.js';
import { fetchPrices, fetchPortfolioHistory } from '../data/prices.js';
import { revokeApproval } from '../data/approvals.js';
import { buildPortfolio, holdingPriceTargets } from '../analytics/portfolio.js';
import { buildClusterFacts } from '../analytics/facts.js';
import { shieldedKey } from '../data/shielded.js';
import {
  getCluster,
  purgeDemoWallets,
  isKnownWallet,
  addWallet,
  removeWallet,
  renameWallet as persistRename,
  addNearAccount,
  removeNearAccount,
  getPrefs,
  setPrefs,
} from '../storage/local.js';
import { getManyCached, setCachedData, getCachedEnriched } from '../storage/dataCache.js';
import { buildWarmupMessages } from '../prompts/wallet-analysis.js';
import { recommendModel, degradeChain } from '../utils/resource-detector.js';
import { getModel, isModelHosted, formatSize } from '../models/registry.js';
import { optimalThreads } from '../utils/offload-planner.js';
import { fetchHostInfo } from '../utils/system-info.js';
import { estimateStorage, requestPersistentStorage } from '../utils/storage-quota.js';
import { getASR } from '../voice/index.js';
import { NEARAI_DEFAULT_MODEL } from '../near/nearAiContext.js';
import { loadNearAccount, isNearAccountId, normalizeAccountId } from '../near/nearAccount.js';

// Central onboarding/workspace state machine. Transitions are EFFECT-driven:
// entering a stage triggers its async work, which then advances the stage.
// stages: welcome → wallets → clusterLoad → voicePrompt → ready
// (the AI model loads in the background; it does not gate any stage)
export function useAppFlow(ctx, { initialStage = 'welcome' } = {}) {
  const [stage, setStage] = useState(initialStage);
  const [cluster, setCluster] = useState(() => getCluster());
  // Demo mode = the cluster holds a session-only "Demo · …" entry (see loadDemo).
  const demo = Object.values(cluster.labels || {}).some((l) => String(l).startsWith('Demo · '));
  const [wallet, setWallet] = useState(null); // {address, provider, signer, chainId}
  const [clusterData, setClusterData] = useState({});
  const [facts, setFacts] = useState(null);
  const [portfolio, setPortfolio] = useState(null);
  const [pricing, setPricing] = useState(false);
  // Per-section background-refresh flags. After cached data is painted, each card
  // shows an "updating data…" header chip until ITS OWN data settles, so a card
  // stops spinning as soon as it's current rather than waiting on the others:
  //   • activity — cleared when the raw chain fetch (txs) commits;
  //   • defi / caps — cleared when enrichment resolves;
  //   • holdings — cleared after the final reprice (it waits on prices too).
  //   • shielded — cleared when confidential-token discovery settles.
  const NO_REFRESH = { activity: false, holdings: false, defi: false, caps: false, shielded: false };
  const [refreshing, setRefreshing] = useState(NO_REFRESH);
  const patchRefreshing = useCallback((p) => setRefreshing((r) => ({ ...r, ...p })), []);
  // Confidential-token holdings across every FHE stack (Zama / CoFHE / Inco).
  // `shielded` is the holding list; `shieldedStacks` is per-stack probe status so
  // the card can say "not configured" rather than "nothing found".
  //
  // PRIVACY: a revealed amount lives here in React state for the session only. It
  // is never written to localStorage or IndexedDB — see storage/local.js.
  const [shielded, setShielded] = useState([]);
  const [shieldedStacks, setShieldedStacks] = useState([]);
  // NEAR Confidential Intents (private shard). Its holdings join `shielded` as
  // stack 'near-intents' rows; this tracks the sign-in itself.
  // status: 'idle' | 'signing' | 'unlocked' | 'error'. Memory only, like `shielded`.
  const [nearIntents, setNearIntents] = useState({ status: 'idle', error: null, address: null, history: null });
  const [model, setModel] = useState({
    status: 'idle', id: null, mode: 'local', externalName: null, reason: '', progress: 0, statusText: '', ctxStatus: null, error: null, log: [],
  });
  const [prefs, setPrefsState] = useState(() => getPrefs());
  const [voiceDownload, setVoiceDownload] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const loadingCluster = useRef(false);
  const loadingModel = useRef(false);
  // Set once the live enrich/price pass begins, so the early cache-first paint
  // (paintFromCache) never stomps fresher live data with a late price response.
  const liveEnrichStarted = useRef(false);
  // loadModel is defined after loadCluster; this ref lets loadCluster start the
  // background model load without a forward reference / dependency cycle.
  const loadModelRef = useRef(null);
  // Same trick for confidential-token discovery, which is declared further down
  // but has to be kicked off from loadCluster / refresh.
  const discoverShieldedRef = useRef(null);
  const shieldedRef = useRef(shielded);
  shieldedRef.current = shielded;
  // Public NEAR accounts (read-only by name): loaded results [{accountId,
  // holdings}] for buildPortfolio, plus per-account load status for the UI.
  const nearRef = useRef([]);
  const [nearStatus, setNearStatus] = useState({}); // id → { status, error }
  const [nearData, setNearData] = useState([]); // mirror of nearRef for renders (AI facts)
  // raw + enriched cluster data kept for rebuilding the portfolio (e.g. after
  // a sealed unlock) without re-fetching the chain.
  const clusterDataRef = useRef({});
  const enrichedRef = useRef({});
  const pricesRef = useRef(new Map());
  // Latest facts, so loadModel can warm the model with the current wallet's
  // prefix after a (re)load without taking a dependency on the changing value.
  const factsRef = useRef(null);
  factsRef.current = facts;

  // --- enrichment + pricing (runs in the background; updates portfolio) ---
  // Streams results to the dashboard in three waves so the page is useful early:
  //   1. cache-first paint — last-good balances + their prices, instantly;
  //   2. tier-1 live balances per chain as each chain resolves, priced as a set;
  //   3. the long-tail (tier-2) balances + a final reprice.
  const enrichAndPrice = useCallback(async (clusterDataFresh) => {
    const addresses = Object.keys(clusterDataFresh);
    clusterDataRef.current = clusterDataFresh;
    setPricing(true);
    patchRefreshing({ holdings: true, defi: true, caps: true });

    // Re-render from a given enriched set, reusing whatever prices we have so far.
    const render = (enriched) => {
      enrichedRef.current = enriched;
      setPortfolio(buildPortfolio({
        clusterData: clusterDataFresh, enriched,
        prices: pricesRef.current, shielded: shieldedRef.current, near: nearRef.current,
      }));
    };

    // Price the currently-known holdings and re-render. Calls are CHAINED
    // (not fired in parallel) so this cycle's up-to-3 price() invocations —
    // cache-first, tier1, final — never overlap: fetchPrices() caps its OWN
    // concurrency, but two overlapping calls each capped at 3 still burst
    // DefiLlama at up to 6+ concurrent requests. Chaining also fixes a
    // latent stale-render race: if an earlier call (e.g. cache-first)
    // resolved after a later one, it would re-render with its older
    // `enriched` snapshot and visually roll the dashboard back.
    let priceQueue = Promise.resolve();
    const price = (enriched) => {
      priceQueue = priceQueue.then(async () => {
        try {
          const prices = await fetchPrices(
            holdingPriceTargets(clusterDataFresh, enriched, shieldedRef.current)
          );
          pricesRef.current = prices;
          render(enriched);
        } catch (e) {
          console.warn('[flow] price failed', e);
        }
      });
      return priceQueue;
    };

    try {
      // ── 1. Cache-first paint: show last-good enriched balances (and price
      // them) before any chain probe begins, so the dashboard is never blank. ──
      const cachedEnriched = {};
      await Promise.all(addresses.map(async (a) => {
        const c = await getCachedEnriched(a).catch(() => null);
        if (c?.chains?.length) cachedEnriched[a] = c.chains;
      }));
      if (Object.keys(cachedEnriched).length) {
        render(cachedEnriched);
        price(cachedEnriched); // don't await — let the live probe proceed
      }

      // ── 2 + 3. Live probe streams balances in; price the high-value tier-1
      // set as soon as it lands, then reprice once the long tail is in. ──
      const enriched = await enrichCluster(addresses, {
        clusterData: clusterDataFresh,
        onProgress: (en, phase) => {
          render(en);
          if (phase === 'tier1') price(en);
        },
      });
      // Enrichment fully resolved: DeFi positions and approvals are now final.
      // Holdings keep spinning until the reprice below lands.
      patchRefreshing({ defi: false, caps: false });
      await price(enriched);
      patchRefreshing({ holdings: false });
    } catch (e) {
      console.warn('[flow] enrich/price failed', e);
    } finally {
      setPricing(false);
      // Safety net: clear any flag THIS pass owns that is still set (e.g. because
      // enrich/price threw). Deliberately not NO_REFRESH: confidential-token
      // discovery runs concurrently and owns `shielded`, so a blanket reset would
      // stop the Shielded card's "scanning…" chip while it is still scanning.
      patchRefreshing({ activity: false, holdings: false, defi: false, caps: false });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Cache-first paint for the holdings / DeFi / spending-caps cards. Reads the
  // last-good ENRICHED data (token balances, positions, approvals) and renders a
  // full portfolio from it immediately — BEFORE the slow live chain fetch — so
  // those cards show cached values on reload instead of rebuilding from blank.
  // Prices the cached holdings too, but bails on the deferred write if the live
  // enrich pass has meanwhile started (so it never overwrites fresher data).
  const paintFromCache = useCallback(async (addresses, rawData) => {
    const cachedEn = {};
    await Promise.all(addresses.map(async (a) => {
      const c = await getCachedEnriched(a).catch(() => null);
      if (c?.chains?.length) cachedEn[a] = c.chains;
    }));
    if (!Object.keys(cachedEn).length || liveEnrichStarted.current) return;
    clusterDataRef.current = rawData;
    enrichedRef.current = cachedEn;
    setPortfolio(buildPortfolio({
      clusterData: rawData, enriched: cachedEn,
      prices: pricesRef.current, shielded: shieldedRef.current, near: nearRef.current,
    }));
    try {
      const prices = await fetchPrices(holdingPriceTargets(rawData, cachedEn, shieldedRef.current));
      if (liveEnrichStarted.current) return; // live data took over — don't stomp it
      pricesRef.current = prices;
      setPortfolio(buildPortfolio({
        clusterData: rawData, enriched: cachedEn,
        prices, shielded: shieldedRef.current, near: nearRef.current,
      }));
    } catch {}
  }, []);

  const rebuildPortfolio = useCallback((nextShielded = shieldedRef.current) => {
    setPortfolio(
      buildPortfolio({
        clusterData: clusterDataRef.current,
        enriched: enrichedRef.current,
        prices: pricesRef.current,
        shielded: nextShielded,
        near: nearRef.current,
      })
    );
  }, []);

  // Rebuild a portfolio view limited to `addresses` (the selected wallets).
  // Reuses the already-fetched raw + enriched data, so toggling wallets is
  // instant and never re-hits the chain. Empty/falsy ⇒ all wallets.
  const rebuildView = useCallback((addresses) => {
    const all = clusterDataRef.current || {};
    const list = addresses && addresses.length ? addresses : Object.keys(all);
    const keep = new Set(list.map((a) => a.toLowerCase()));
    const pick = (obj) => {
      const out = {};
      for (const k of Object.keys(obj || {})) if (keep.has(k.toLowerCase())) out[k] = obj[k];
      return out;
    };
    return buildPortfolio({
      clusterData: pick(all),
      enriched: pick(enrichedRef.current),
      prices: pricesRef.current,
      // Confidential holdings are a flat list keyed by wallet, so they need the
      // same narrowing the address-keyed maps get above — otherwise deselecting a
      // wallet would still count its shielded balance in the total.
      shielded: (shieldedRef.current || []).filter((t) => keep.has(t.wallet.toLowerCase())),
      near: (nearRef.current || []).filter((a) => keep.has(a.accountId)),
    });
  }, []);

  // --- stage work (called by effects on stage entry) ---

  const loadCluster = useCallback(async () => {
    if (loadingCluster.current) return;
    loadingCluster.current = true;
    liveEnrichStarted.current = false;
    setError(null);
    // NOTE: the local-AI model is NOT loaded here. Connecting a wallet should
    // not kick off a multi-GB model download (that surfaced a confusing
    // "preparing locally…" on every connect). The model loads lazily instead —
    // when the user actually engages the assistant or clicks the status pill
    // (see startModel / Assistant.send).
    try {
      const addresses = getCluster().addresses;
      // cache-first: show whatever we already have, instantly
      const cached = await getManyCached(addresses);
      const seeded = {};
      for (const a of addresses) if (cached[a]) seeded[a] = cached[a];
      if (Object.keys(seeded).length) {
        setClusterData(seeded);
        setFacts(buildClusterFacts(seeded, shieldedRef.current));
        // Paint holdings/DeFi/caps from cached ENRICHED data right away (don't
        // await — let the live fetch proceed in parallel).
        paintFromCache(Object.keys(seeded), seeded);
        // Show the "updating data…" chips over the cached values. Only when we
        // actually painted cache — otherwise the cards show skeletons and the
        // chip would be redundant.
        patchRefreshing({ activity: true, holdings: true, defi: true, caps: true });
      }
      // background refresh from chain.
      const fresh = await fetchClusterData(addresses, {});

      // For chains that errored in the fresh fetch, fall back to the last cached
      // good data for that chain so transient RPC failures don't blank whole chains.
      const merged = {};
      for (const a of addresses) {
        const f = fresh[a] || { address: a, chains: [] };
        const c = cached[a];
        merged[a] = {
          ...f,
          chains: (f.chains || []).map((fc) => {
            if (!fc.error) return fc;
            const fallback = c?.chains?.find((cc) => cc.chainId === fc.chainId && !cc.error);
            return fallback ? { ...fallback, stale: true } : fc;
          }),
        };
      }

      setClusterData(merged);
      setFacts(buildClusterFacts(merged, shieldedRef.current));
      // Recent activity is driven by the raw chain data, which is now final.
      patchRefreshing({ activity: false });

      // Cache only chains that succeeded so the fallback pool stays clean.
      for (const a of addresses) {
        const f = fresh[a];
        if (!f) continue;
        const goodChains = (f.chains || []).filter((c) => !c.error);
        if (goodChains.length > 0) setCachedData(a, { ...f, chains: goodChains });
      }

      // kick off enrichment + pricing in the background (don't block the flow)
      liveEnrichStarted.current = true;
      enrichAndPrice(merged);
      // Confidential-token discovery runs alongside it. Read-only view calls, so
      // it needs no wallet signature and never blocks the dashboard.
      discoverShieldedRef.current?.(addresses);
      // Go straight to the dashboard (or the optional voice prompt). The AI
      // model keeps loading in the background; the Assistant shows its status
      // and stays usable for everything else in the meantime.
      // If the user is already on the dashboard (app route landed straight on
      // 'ready'), stay there; otherwise advance from the onboarding flow.
      setStage((prev) =>
        prev === 'ready' ? 'ready' : getPrefs().voiceEnabled === null ? 'voicePrompt' : 'ready'
      );
    } catch (e) {
      setError(String(e?.message || e));
    } finally {
      loadingCluster.current = false;
    }
  }, [enrichAndPrice, paintFromCache, patchRefreshing]);

  const loadModel = useCallback(async () => {
    if (loadingModel.current) return;
    loadingModel.current = true;
    // Human-readable trace of the whole load (model picked → each tier tried →
    // the actual error). Surfaced in the Details drawer so a failed load is
    // debuggable without opening the console.
    const log = [];
    const push = (line) => {
      const stamped = `${new Date().toLocaleTimeString()}  ${line}`;
      log.push(stamped);
      console.info('[model]', line);
    };
    try {
      // ── External API path: no download/degrade ladder — validate the
      // configured endpoint and mark ready. The router sends chat through the
      // local /api/llm proxy. ──
      const prefs = getPrefs();
      // ── NEAR AI TEE path: verify gateway + model attestation in the
      // browser, then mark ready. Fails closed — no fallback to an
      // unverified or Incognito model. ──
      if (prefs.inference === 'nearai') {
        const cfg = { apiKey: prefs.nearAi?.apiKey || '', model: prefs.nearAi?.model || NEARAI_DEFAULT_MODEL };
        const base = { mode: 'nearai', id: 'nearai', externalName: cfg.model };
        if (!cfg.apiKey) {
          push('NEAR AI selected but no API key is set.');
          setModel((m) => ({
            ...m, ...base, status: 'error',
            error: 'NEAR AI is selected but no API key is set. Open Settings → AI model to add one.',
            log: [...log],
          }));
          return;
        }
        push(`Using NEAR AI Cloud TEE model "${cfg.model}"`);
        setModel((m) => ({
          ...m, ...base, status: 'loading', reason: 'NEAR AI TEE', progress: 1,
          statusText: 'Verifying attestation…', error: null, log: [...log],
        }));
        try {
          const status = await ctx.initializeNearAi(cfg, (s) => setModel((m) => ({ ...m, statusText: s })));
          const a = status.attestation;
          push(`✓ Attestation verified — gateway TCB ${a?.gateway?.tcbStatus}, ${a?.models?.length || 0} model quote(s), GPU ${a?.models?.map((x) => x.gpuEvidence).join('/')}`);
          setModel((m) => ({ ...m, ...base, status: 'ready', ctxStatus: status, statusText: '', log: [...log] }));
        } catch (e) {
          push(`✗ NEAR AI verification failed: ${String(e?.message || e)}`);
          setModel((m) => ({ ...m, ...base, status: 'error', error: String(e?.message || e), log: [...log] }));
        }
        return;
      }
      if (prefs.inference === 'external') {
        const cfg = prefs.externalApi || {};
        if (!cfg.baseUrl || !cfg.model) {
          push('External model selected but base URL or model name is missing.');
          setModel((m) => ({
            ...m, status: 'error', mode: 'external', id: 'external', externalName: cfg.model || null,
            error: 'External model is selected but its API base URL or model name is missing. Open Settings → AI model to configure it.',
            log: [...log],
          }));
          return;
        }
        push(`Using external model "${cfg.model}" at ${cfg.baseUrl}`);
        setModel((m) => ({
          ...m, status: 'loading', mode: 'external', id: 'external', externalName: cfg.model,
          reason: 'External API', progress: 1, statusText: 'Connecting…', error: null, log: [...log],
        }));
        try {
          const status = await ctx.initializeExternal(cfg, (s) => setModel((m) => ({ ...m, statusText: s })));
          push(`✓ External model ready (${cfg.model})`);
          setModel((m) => ({
            ...m, status: 'ready', mode: 'external', id: 'external', externalName: cfg.model,
            ctxStatus: status, statusText: '', log: [...log],
          }));
        } catch (e) {
          push(`✗ External model failed: ${String(e?.message || e)}`);
          setModel((m) => ({
            ...m, status: 'error', mode: 'external', id: 'external', externalName: cfg.model,
            error: String(e?.message || e), log: [...log],
          }));
        }
        return;
      }

      const override = prefs.modelOverride;
      const rec = override
        ? { modelId: override, reason: 'Using your saved model choice.' }
        : await recommendModel();
      push(`Picked ${rec.modelId} — ${rec.reason}`);

      // Load options shared by every degrade-ladder attempt: physical-core thread
      // count (from the local helper server when available) and the manual GPU
      // offload layer count if the user pinned one in Settings.
      const host = await fetchHostInfo().catch(() => null);
      const nThreads = optimalThreads({
        physicalCores: host?.cpu?.physicalCores,
        logicalCores: host?.cpu?.logicalCores || navigator.hardwareConcurrency,
      });
      const loadOpts = { nThreads };
      if (prefs.offloadMode === 'manual' && prefs.offloadGpuLayers != null) {
        loadOpts.gpuLayers = prefs.offloadGpuLayers;
        push(`Offload: manual — starting at ${prefs.offloadGpuLayers} GPU layers · ${nThreads} CPU threads`);
      } else {
        push(`Offload: automatic (all layers on GPU, degrade to fit) · ${nThreads} CPU threads`);
      }
      setModel((m) => ({ ...m, status: 'loading', mode: 'local', externalName: null, id: rec.modelId, reason: rec.reason, progress: 0, error: null, log: [...log] }));

      let lastErr;
      let triedAny = false;
      for (const id of degradeChain(rec.modelId)) {
        const mdl = getModel(id);
        if (!isModelHosted(mdl)) {
          push(`Skipping ${mdl.name} — model file not hosted yet (placeholder URL in registry.js).`);
          continue;
        }
        triedAny = true;
        try {
          push(`Loading ${mdl.name} (${mdl.quant}, ~${formatSize(mdl.sizeBytes)})`);
          push(`  source: ${mdl.source.url}`);
          setModel((m) => ({ ...m, id, statusText: `Loading ${mdl.name}…`, progress: 0, log: [...log] }));

          // Storage preflight. Models cache in the browser's OPFS (its profile
          // directory — the app can't pick a folder), so check there's room
          // BEFORE a long multi-GB download and ask the browser to keep the
          // cache from being evicted. If space is clearly short, fail fast with
          // a clear message instead of a cryptic post-download cache error.
          const persisted = await requestPersistentStorage();
          if (persisted) push('  storage: persistent (browser won’t evict the cache under disk pressure)');
          const est = await estimateStorage();
          if (est.supported) {
            push(`  storage: ${formatSize(est.free)} free of ${formatSize(est.quota)} browser quota — need ~${formatSize(mdl.sizeBytes)}`);
            if (est.free < mdl.sizeBytes) {
              throw new Error(
                `Not enough browser storage for ${mdl.name}: ~${formatSize(mdl.sizeBytes)} needed but only ${formatSize(est.free)} free. ` +
                  'Models cache in your browser’s profile (the app can’t pick a folder) — free up space on the drive holding the browser profile, or move the browser profile to a larger drive.'
              );
            }
          }
          // Flush the preflight lines to the live log now (the next setModel that
          // carries the log is only on success/failure, which can be minutes away
          // for a multi-GB download).
          setModel((m) => ({ ...m, log: [...log] }));
          const status = await ctx.initialize(
            mdl,
            (p) => setModel((m) => ({ ...m, progress: p })),
            (s) => setModel((m) => ({ ...m, statusText: s })),
            loadOpts
          );
          // Report the *effective* offload (real layer count from GGUF metadata),
          // not the requested n_gpu_layers (99 = "offload everything").
          const offloaded =
            status.nGpuLayers > 0 && status.modelLayers != null
              ? Math.min(status.nGpuLayers, status.modelLayers + 1)
              : status.nGpuLayers;
          push(
            `✓ ${mdl.name} ready on ${status.backend}${
              status.nGpuLayers
                ? ` (${offloaded}${status.modelLayers != null ? `/${status.modelLayers + 1}` : ''} GPU layers)`
                : ''
            }`
          );
          // Warm before declaring ready: prime VRAM + the system-prompt
          // checkpoint so the first question is fast. Stay in 'loading' with
          // progress pinned to 1 — the UI shows "Warming up…" with NO progress
          // bar (see Assistant/TopBar download-vs-warming split).
          setModel((m) => ({ ...m, status: 'loading', statusText: 'Warming up…', progress: 1, ctxStatus: status, id, log: [...log] }));
          try {
            await ctx.warmup?.(buildWarmupMessages(factsRef.current));
          } catch (e) {
            console.warn('[flow] warmup failed (non-fatal)', e);
          }
          push('✓ Warmup complete — first answer will be fast.');
          setModel((m) => ({ ...m, status: 'ready', mode: 'local', externalName: null, statusText: '', ctxStatus: status, id, log: [...log] }));
          return;
        } catch (e) {
          lastErr = e;
          push(`✗ ${mdl.name} failed: ${String(e?.message || e)}`);
          setModel((m) => ({ ...m, log: [...log] }));
          console.warn(`[flow] ${id} failed to load, degrading`, e);
        }
      }
      let failMsg = triedAny
        ? String(lastErr?.message || lastErr)
        : 'No downloadable model is configured. Only the Qwen3-1.7B lite model ships with a real URL — host the larger models (see README) or pick the lite model in Details → Model override.';
      // wllama throws "Model file not found" when the GGUF didn't finish saving
      // to the browser's OPFS cache — almost always an interrupted download,
      // not enough disk space, or storage being blocked (private window).
      if (/Model file not found|not found/i.test(failMsg)) {
        failMsg =
          'The model download didn’t finish caching in the browser. Common causes: the download was interrupted, not enough free disk space for the model (~1.1 GB+), or storage is blocked (e.g. a private/incognito window). Try again on a normal window with disk space free. Original: ' +
          failMsg;
      }
      push(triedAny ? 'All candidate models failed to load.' : 'No hosted model to try.');
      setModel((m) => ({ ...m, status: 'error', error: failMsg, log: [...log] }));
    } finally {
      loadingModel.current = false;
    }
  }, [ctx]);
  loadModelRef.current = loadModel;

  // Effect-driven transitions. The AI model loads in the background (started
  // from loadCluster), so there's no blocking modelLoad stage anymore.
  useEffect(() => { if (stage === 'clusterLoad') loadCluster(); }, [stage, loadCluster]);

  // App route lands straight on the dashboard. Drop any session-only demo wallet
  // first (so a reload never auto-restores the demo dashboard), then hydrate only
  // if a real saved wallet remains; otherwise the connect/demo prompt is shown.
  useEffect(() => {
    const cluster = purgeDemoWallets();
    setCluster({ ...cluster });
    if (initialStage === 'ready' && cluster.addresses.length) loadCluster();
    if (initialStage === 'ready' && cluster.nearAccounts.length) loadNearAccounts(cluster.nearAccounts);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- NEAR accounts (public, read-only by name) ---

  const rebuildWithNear = useCallback(() => {
    setPortfolio(buildPortfolio({
      clusterData: clusterDataRef.current, enriched: enrichedRef.current,
      prices: pricesRef.current, shielded: shieldedRef.current, near: nearRef.current,
    }));
  }, []);

  // Fetch + price each account and merge it into the portfolio as it lands.
  // A failed or missing account keeps its chip with an error, contributes nothing.
  const loadNearAccounts = useCallback(async (ids) => {
    const list = [...new Set(ids.map(normalizeAccountId))];
    setNearStatus((s) => ({ ...s, ...Object.fromEntries(list.map((id) => [id, { status: 'loading', error: null }])) }));
    await Promise.all(list.map(async (id) => {
      try {
        const acct = await loadNearAccount(id);
        // Removed while loading? Don't resurrect it.
        if (!getCluster().nearAccounts.includes(id)) return;
        nearRef.current = [...nearRef.current.filter((a) => a.accountId !== id), acct];
        setNearData(nearRef.current);
        setNearStatus((s) => ({ ...s, [id]: acct.exists ? { status: 'ready', error: null } : { status: 'missing', error: 'Account not found on NEAR mainnet' } }));
      } catch (e) {
        setNearStatus((s) => ({ ...s, [id]: { status: 'error', error: String(e?.message || e) } }));
      }
      rebuildWithNear();
    }));
  }, [rebuildWithNear]);

  // Returns an error string for the input, or null on success.
  const addNearAcct = useCallback(async (raw) => {
    const id = normalizeAccountId(raw);
    if (!isNearAccountId(id)) return 'Enter a NEAR account like alice.near (or a 64-hex implicit account).';
    if (getCluster().nearAccounts.includes(id)) return 'That NEAR account is already added.';
    setCluster({ ...addNearAccount(id) });
    if (stage !== 'ready') setStage('ready');
    loadNearAccounts([id]);
    return null;
  }, [loadNearAccounts, stage]);

  const removeNearAcct = useCallback((id) => {
    setCluster({ ...removeNearAccount(id) });
    nearRef.current = nearRef.current.filter((a) => a.accountId !== id);
    setNearData(nearRef.current);
    setNearStatus((s) => { const n = { ...s }; delete n[id]; return n; });
    rebuildWithNear();
  }, [rebuildWithNear]);

  // --- public actions ---

  const connect = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const w = await connectWallet();
      setWallet(w);
      if (isKnownWallet(w.address)) {
        setCluster({ ...getCluster() });
        setStage('clusterLoad'); // returning user → load the whole cluster
      } else {
        setCluster({ ...addWallet(w.address) });
        setStage('wallets');
      }
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      setBusy(false);
    }
  }, []);

  const addAnother = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const w = await connectWallet(); // user picks a different account in their web3 wallet
      setWallet(w);
      setCluster({ ...addWallet(w.address) });
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      setBusy(false);
    }
  }, []);

  // Dashboard "Connect wallet" / "+". Opens the wallet's account chooser (so the
  // user can authorize several accounts at once), adds every authorized address
  // to the cluster, then loads chain data for the whole cluster. This is what
  // makes balances actually appear after connecting on the dashboard.
  const connectMore = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const w = await requestWalletAccounts();
      setWallet({ address: w.address, provider: w.provider, signer: w.signer, chainId: w.chainId });
      const before = new Set(getCluster().addresses.map((a) => a.toLowerCase()));
      let cl = getCluster();
      let added = 0;
      for (const a of w.accounts) {
        if (!before.has(a.toLowerCase())) added += 1;
        cl = addWallet(a);
      }
      setCluster({ ...cl });
      if (added > 0) {
        await loadCluster(); // fetch + enrich + price for the (now larger) cluster
      } else {
        // The wallet returned an account already in the cluster. Tell the user
        // how to add a *different* one instead of silently doing nothing.
        setError('That account is already connected. Pick a different account in your wallet, then click + again.');
      }
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      setBusy(false);
    }
  }, [loadCluster]);

  // Read-only "try it" mode: seed a well-known public address and run the exact
  // same public-chain pipeline as a real connect (no signer, so revoke/unlock
  // stay disabled — everything else works). Lets people see a populated
  // dashboard without connecting their own wallet.
  const loadDemo = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const DEMO_ADDRESS = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'; // vitalik.eth
      addWallet(DEMO_ADDRESS);
      let cl = persistRename(DEMO_ADDRESS, 'Demo · vitalik.eth');
      // Plus a public NEAR account (live, read-only). Skipped if the visitor
      // already added it themselves — the demo label would purge it on reload.
      const { DEMO_NEAR_ACCOUNT } = await import('../near/demoFixtures.js');
      const nearAdded = !cl.nearAccounts.includes(DEMO_NEAR_ACCOUNT);
      if (nearAdded) {
        addNearAccount(DEMO_NEAR_ACCOUNT);
        cl = persistRename(DEMO_NEAR_ACCOUNT, `Demo · ${DEMO_NEAR_ACCOUNT}`);
      }
      setCluster({ ...cl });
      if (nearAdded) loadNearAccounts([DEMO_NEAR_ACCOUNT]);
      await loadCluster();
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      setBusy(false);
    }
  }, [loadCluster, loadNearAccounts]);

  const removeFromCluster = useCallback((addr) => {
    setCluster({ ...removeWallet(addr) });
  }, []);

  const renameWallet = useCallback((addr, name) => {
    setCluster({ ...persistRename(addr, name) });
  }, []);

  const continueFromWallets = useCallback(() => setStage('clusterLoad'), []);
  const retryModel = useCallback(() => loadModel(), [loadModel]);

  // Free the loaded model: tears down the wllama instance (releasing GPU/CPU
  // memory) and resets the assistant to idle so the next question reloads it.
  const unloadModel = useCallback(async () => {
    try { await ctx.unload(); } catch (e) { console.warn('[flow] unload failed', e); }
    loadingModel.current = false;
    setModel({ status: 'idle', id: null, mode: 'local', externalName: null, reason: '', progress: 0, statusText: '', ctxStatus: null, error: null, log: [] });
  }, [ctx]);

  const chooseVoice = useCallback(async (enabled) => {
    setPrefsState(setPrefs({ voiceEnabled: enabled }));
    setStage('ready');
    if (enabled) {
      setVoiceDownload({ status: 'loading', pct: 0 });
      // The Whisper model is several files (encoder/decoder/tokenizer) that
      // download concurrently; transformers.js reports per-FILE progress, so
      // naively showing the latest event makes the % jump up and down. Track
      // every file's bytes and report one aggregate %, clamped to never go
      // backwards, so the bar moves smoothly.
      const files = new Map(); // file -> { loaded, total }
      let lastPct = 0;
      try {
        await getASR((p) => {
          if (!p || !p.file) return;
          if (p.status === 'progress' && p.total) {
            files.set(p.file, { loaded: p.loaded || 0, total: p.total });
          } else if (p.status === 'done' && files.has(p.file)) {
            const f = files.get(p.file);
            files.set(p.file, { loaded: f.total, total: f.total });
          }
          let loaded = 0;
          let total = 0;
          for (const f of files.values()) { loaded += f.loaded; total += f.total; }
          const pct = total > 0 ? Math.round((loaded / total) * 100) : 0;
          lastPct = Math.min(100, Math.max(lastPct, pct));
          setVoiceDownload({ status: 'loading', pct: lastPct });
        });
        setVoiceDownload({ status: 'ready' });
      } catch (e) {
        setVoiceDownload({ status: 'error', error: String(e.message || e) });
      }
    }
  }, []);

  const refreshNearIntentsRef = useRef(null);
  const refresh = useCallback(async () => {
    refreshNearIntentsRef.current?.();
    const { addresses, nearAccounts } = getCluster();
    if (nearAccounts.length) loadNearAccounts(nearAccounts);
    if (!addresses.length) return;
    patchRefreshing({ activity: true, holdings: true, defi: true, caps: true });
    const fresh = await fetchClusterData(addresses, {});
    setClusterData(fresh);
    setFacts(buildClusterFacts(fresh, shieldedRef.current));
    patchRefreshing({ activity: false }); // txs are final
    for (const a of addresses) if (fresh[a] && !fresh[a].error) setCachedData(a, fresh[a]);
    discoverShieldedRef.current?.(addresses);
    await enrichAndPrice(fresh);
  }, [enrichAndPrice, patchRefreshing, loadNearAccounts]);

  // Portfolio value history for the summary sparkline. Cheap to call per range.
  // Resolves once with the full series — the chart is built only when complete.
  const loadHistory = useCallback(async (range) => {
    const p = portfolio;
    // Top holdings by value only: a full registry probe yields hundreds of dust
    // holdings; charting them all makes the request/response huge (the longer
    // ranges then fail and the chart flatlines). The top ~40 cover essentially
    // all of the portfolio's value, so the curve is accurate and fast.
    const holdings = (p?.holdings || [])
      .filter((h) => h.usd != null && h.usd > 0)
      .sort((a, b) => b.usd - a.usd)
      .slice(0, 40);
    if (!holdings.length) return [];
    return fetchPortfolioHistory(
      holdings.map((h) => ({ chainId: h.chainId, address: h.address, amount: h.amount, price: h.price })),
      range
    );
  }, [portfolio]);

  // Commit a new shielded list: state, ref, LLM facts and the portfolio all move
  // together, so no consumer can observe a half-updated set.
  const commitShielded = useCallback((next) => {
    shieldedRef.current = next;
    setShielded(next);
    setFacts(buildClusterFacts(clusterDataRef.current, next));
    rebuildPortfolio(next);
  }, [rebuildPortfolio]);

  // Discover confidential-token holdings for the whole cluster. Read-only view
  // calls — no signature, no relayer contact, nothing decrypted — so this runs
  // automatically after the cluster loads and works for the read-only demo wallet
  // too. It only learns THAT a confidential balance exists, never how much.
  const discoverShieldedTokens = useCallback(async (addresses) => {
    const list = addresses?.length ? addresses : getCluster().addresses;
    if (!list.length) return;
    patchRefreshing({ shielded: true });
    try {
      const { discoverShielded } = await import('../data/shielded.js');
      const { tokens, stacks } = await discoverShielded(list);
      setShieldedStacks(stacks);
      // Carry over anything already revealed this session so a background
      // rediscovery doesn't silently re-encrypt rows the user already opened.
      const revealedByKey = new Map(
        (shieldedRef.current || [])
          .filter((t) => t.state === 'revealed')
          .map((t) => [shieldedKey(t), t])
      );
      const merged = tokens.map((t) => {
        const prev = revealedByKey.get(shieldedKey(t));
        // Only reuse the old plaintext if the ciphertext is unchanged — a new
        // handle means the balance moved on-chain and the old amount is stale.
        return prev && prev.handle === t.handle ? { ...t, state: 'revealed', amount: prev.amount } : t;
      });
      // NEAR private-shard rows are not discovered on-chain (they need a signed
      // session), so a rediscovery must keep them rather than drop them.
      merged.push(...(shieldedRef.current || []).filter((t) => t.stack === 'near-intents'));
      commitShielded(merged);
      // Price the underlyings so a reveal renders with a USD value immediately.
      if (merged.length) {
        try {
          const prices = await fetchPrices(
            holdingPriceTargets(clusterDataRef.current, enrichedRef.current, merged)
          );
          pricesRef.current = prices;
          rebuildPortfolio(merged);
        } catch (e) {
          console.warn('[flow] shielded pricing failed', e);
        }
      }
    } catch (e) {
      console.warn('[flow] shielded discovery failed', e);
    } finally {
      patchRefreshing({ shielded: false });
    }
  }, [commitShielded, patchRefreshing, rebuildPortfolio]);
  discoverShieldedRef.current = discoverShieldedTokens;

  // Decrypt ONE confidential holding, in the browser. Costs an EIP-712 signature
  // the first time a permit is needed for that token, plus a relayer round-trip.
  // Failures are recorded on the row (see data/shielded.js) rather than thrown, so
  // one declined signature never blanks the card.
  const revealShieldedToken = useCallback(async (token) => {
    if (!wallet) throw new Error('Connect a wallet to reveal confidential balances');
    const key = shieldedKey(token);
    // Optimistic 'revealing' state drives the row's spinner.
    commitShielded(shieldedRef.current.map((t) => (shieldedKey(t) === key ? { ...t, state: 'revealing', error: null } : t)));
    const { revealShielded } = await import('../data/shielded.js');
    const updated = await revealShielded(token, { provider: wallet.provider, signer: wallet.signer });
    commitShielded(shieldedRef.current.map((t) => (shieldedKey(t) === key ? updated : t)));
    return updated;
  }, [wallet, commitShielded]);

  // Reveal every still-encrypted holding, sequentially. Sequential on purpose:
  // each stack may prompt for a signature, and parallel wallet popups get
  // silently dropped by most wallets.
  const revealAllShielded = useCallback(async () => {
    const pending = (shieldedRef.current || []).filter((t) => t.state === 'encrypted');
    for (const t of pending) {
      try {
        await revealShieldedToken(t);
      } catch (e) {
        console.warn('[flow] reveal-all stopped', e);
        break; // a thrown error here means a precondition failed (e.g. no signer)
      }
    }
  }, [revealShieldedToken]);

  // Read the connected wallet's NEAR Confidential Intents balances. One ERC-191
  // signature of a no-op intent (moves nothing) → session → private balances.
  // Rows replace any previous near-intents rows; amounts stay in memory only.
  // via: 'evm' — ERC-191 from the connected EVM wallet (default)
  //      'near' — NEP-413 from a NEAR wallet (near-connect picker)
  const unlockNearIntents = useCallback(async (via = 'evm') => {
    // Demo without a wallet: show clearly-labelled SAMPLE private-shard rows
    // (no signature, no API call) so the flow can be seen end to end.
    if (via === 'evm' && !wallet && demo) {
      const { demoIntentsHoldings, DEMO_INTENTS_HISTORY, DEMO_NEAR_ACCOUNT } = await import('../near/demoFixtures.js');
      const rest = (shieldedRef.current || []).filter((t) => t.stack !== 'near-intents');
      commitShielded([...rest, ...demoIntentsHoldings(DEMO_NEAR_ACCOUNT)]); // owned by a demo wallet id, so the wallet filter keeps them
      setNearIntents({ status: 'unlocked', error: null, address: DEMO_NEAR_ACCOUNT, history: DEMO_INTENTS_HISTORY, demo: true });
      return;
    }
    if (via === 'evm' && !wallet) throw new Error('Connect a wallet to read NEAR confidential balances');
    setNearIntents((s) => ({ ...s, status: 'signing', error: null, via }));
    try {
      const ci = await import('../near/confidentialIntents.js');
      let identity;
      if (via === 'near') {
        const { connectNearWallet, nearWalletSigner } = await import('../near/nearWallet.js');
        const nw = await connectNearWallet();
        const accountId = normalizeAccountId(nw.accountId);
        // The signing account is also a public NEAR account of this user:
        // add it (read-only) so its balances and the private rows sit together.
        if (!getCluster().nearAccounts.includes(accountId)) {
          setCluster({ ...addNearAccount(accountId) });
          loadNearAccounts([accountId]);
        }
        identity = ci.nearIdentity({ accountId, signMessage: nearWalletSigner({ wallet: nw.wallet, accountId: nw.accountId }) });
      } else {
        identity = await ci.evmIdentity(wallet.signer);
      }
      const { address, tokens, history, kind } = await ci.loadConfidentialHoldings(identity);
      const rest = (shieldedRef.current || []).filter((t) => !(t.stack === 'near-intents' && t.wallet === address));
      commitShielded([...rest, ...tokens]);
      setNearIntents({ status: 'unlocked', error: null, address, history, via: kind, updatedAt: Date.now() });
    } catch (e) {
      const msg = String(e?.message || e);
      const friendly = /user rejected|rejected the request|ACTION_REJECTED|4001|cancel/i.test(msg)
        ? 'Signature declined — nothing was read.'
        : e?.status === 401
          ? 'The NEAR Intents API declined the sign-in (401). Nothing was read. If it repeats, check that this device\'s clock is correct — the sign-in nonce carries a timestamp the API checks.'
          : msg;
      console.warn('[flow] NEAR Intents unlock failed', e);
      setNearIntents((s) => ({ ...s, status: 'error', error: friendly }));
    }
  }, [wallet, commitShielded, demo, loadNearAccounts]);

  // Re-read the private-shard balances with the session from the sign-in above —
  // no wallet prompt. Runs with every Refresh (manual or the 1-minute auto-refresh). If the session is gone, the block goes back to
  // "sign in" instead of popping a signature request on its own.
  const nearIntentsRef = useRef(nearIntents);
  nearIntentsRef.current = nearIntents;
  const nearRefreshing = useRef(false);
  const refreshNearIntents = useCallback(async () => {
    const ni = nearIntentsRef.current;
    if (ni.status !== 'unlocked' || ni.demo || !ni.address || nearRefreshing.current) return;
    nearRefreshing.current = true;
    try {
      const ci = await import('../near/confidentialIntents.js');
      const kind = ni.via || 'evm';
      if (!ci.hasIntentsSession(kind, ni.address)) throw Object.assign(new Error('expired'), { code: ci.SESSION_EXPIRED });
      const { address, tokens, history } = await ci.refreshConfidentialHoldings(kind, ni.address);
      if (nearIntentsRef.current.address !== address) return; // user switched account meanwhile
      const rest = (shieldedRef.current || []).filter((t) => !(t.stack === 'near-intents' && t.wallet === address));
      commitShielded([...rest, ...tokens]);
      setNearIntents((s) => ({ ...s, history: history ?? s.history, updatedAt: Date.now(), refreshError: null }));
    } catch (e) {
      if (e?.code === 'SESSION_EXPIRED') {
        setNearIntents((s) => ({ ...s, status: 'idle', error: null, expired: true }));
      } else {
        console.warn('[flow] NEAR Intents refresh failed', e);
        setNearIntents((s) => ({ ...s, refreshError: String(e?.message || e) }));
      }
    } finally {
      nearRefreshing.current = false;
    }
  }, [commitShielded]);
  refreshNearIntentsRef.current = refreshNearIntents;

  // Every balance (public chains, NEAR accounts, private shard) refreshes once a
  // minute while the dashboard is visible, and when the tab comes back.
  const refreshRef = useRef(null);
  refreshRef.current = refresh;
  useEffect(() => {
    if (stage !== 'ready') return undefined;
    let last = Date.now();
    let running = false; // a slow refresh (many chains, rate-limited APIs) must not stack up
    const tick = (force) => {
      if (running || document.visibilityState !== 'visible') return;
      if (!force && Date.now() - last < 55_000) return;
      last = Date.now();
      running = true;
      Promise.resolve(refreshRef.current?.())
        .catch((e) => console.warn('[flow] auto-refresh failed', e))
        .finally(() => { running = false; });
    };
    const id = setInterval(() => tick(true), 60_000);
    const onVis = () => tick(false);
    document.addEventListener('visibilitychange', onVis);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', onVis); };
  }, [stage]);

  // Revoke a token approval (approve(spender, 0)). Switches the wallet to the
  // approval's chain first if needed.
  const revoke = useCallback(async (approval) => {
    // `wallet` lives only in memory: after a reload the cluster is restored but
    // no signer exists yet. Connect on demand instead of failing.
    let w = wallet;
    if (!w) {
      w = await connectWallet();
      setWallet(w);
    }
    const signerAddr = (await (await w.provider.getSigner()).getAddress()).toLowerCase();
    if (approval.owner && approval.owner.toLowerCase() !== signerAddr) {
      throw new Error(`Switch your wallet to account ${approval.owner.slice(0, 6)}…${approval.owner.slice(-4)} to revoke this approval`);
    }
    const net = await w.provider.getNetwork();
    if (Number(net.chainId) !== Number(approval.chainId)) {
      try {
        await w.provider.send('wallet_switchEthereumChain', [
          { chainId: '0x' + Number(approval.chainId).toString(16) },
        ]);
      } catch (e) {
        throw new Error(`Switch your wallet to ${approval.chainName} to revoke (${e.message || e})`);
      }
    }
    // Fresh provider after a chain switch (ethers' BrowserProvider pins the network).
    const { BrowserProvider } = await import('ethers');
    const signer = await new BrowserProvider(window.ethereum).getSigner();
    const hash = await revokeApproval(approval.token, approval.spender, signer);
    // optimistic: drop it from the portfolio view
    setPortfolio((p) =>
      p
        ? {
            ...p,
            approvals: p.approvals.filter(
              (a) => !(a.token === approval.token && a.spender === approval.spender)
            ),
          }
        : p
    );
    return hash;
  }, [wallet]);

  const updatePref = useCallback((patch) => {
    setPrefsState(setPrefs(patch));
  }, []);

  return {
    stage, cluster, wallet, clusterData, facts, portfolio, pricing, refreshing,
    shielded, shieldedStacks, nearIntents, nearStatus, nearData, addNearAcct, removeNearAcct, demo,
    model, prefs, voiceDownload, error, busy,
    connect, addAnother, connectMore, loadDemo, removeFromCluster, renameWallet, continueFromWallets,
    rebuildView, startModel: loadModel, retryModel, unloadModel, chooseVoice, refresh, loadHistory, revoke, updatePref,
    discoverShieldedTokens, revealShieldedToken, revealAllShielded, unlockNearIntents, refreshNearIntents,
  };
}
