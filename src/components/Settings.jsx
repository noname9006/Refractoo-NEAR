import { useEffect, useMemo, useState } from 'react';
import { MODELS, formatSize, getModel, getModelArch } from '../models/registry.js';
import { describeOffload } from '../utils/offload-planner.js';
import { probeGGUFArch } from '../utils/gguf-probe.js';
import { recommendModel } from '../utils/resource-detector.js';
import { applyEffects } from '../utils/theme.js';
import { hotKey, effectiveHotlist, TIER_LABELS } from '../models/hotlist.js';
import {
  listConfidentialModels, providerLabel, NEARAI_DEFAULT_MODEL, REASONING_BUDGETS, DEFAULT_REASONING_BUDGET, ANSWER_TOKENS, outputTokenLimit,
} from '../near/nearAiContext.js';
import {
  detectResources, measureStorage, clearCategory, fmtBytes, fmtBytesBin, STORAGE_CATEGORIES,
  fetchHostInfo, listCachedModels, deleteCachedModels,
} from '../utils/system-info.js';
import {
  IClose, IGear, ITrash, IDatabase, ICpu, IImage, IChat, IClock, IPower, IDownload,
  IChevDown,
} from './dashboard/icons.jsx';

const ICONS = { IGear, IDatabase, ICpu, IImage, IChat, IClock };

// Donut ("circle diagram") of on-device storage by category.
const SEG_COLORS = ['#36a3e6', '#56b04a', '#f5972b', '#8a5bd0', '#ea3a3a', '#13b5a6', '#9aa3ad'];
function Donut({ byId, order }) {
  // Color index is keyed to `order` (the same STORAGE_CATEGORIES array the
  // legend below iterates), so a category's dot and its donut sector are
  // always the same color.
  const segs = order.map((c, i) => ({ id: c.id, label: c.label, value: byId[c.id] || 0, color: SEG_COLORS[i % SEG_COLORS.length] }))
    .filter((s) => s.value > 0);
  const total = segs.reduce((a, s) => a + s.value, 0);
  const R = 52, C = 2 * Math.PI * R;
  // One dominant category (e.g. AI models) can be >99% of the total, shrinking
  // every other sector to an invisible sliver. Give each sector a minimum
  // visible length, then scale the rest down proportionally so the strokes
  // still sum to the full circumference — this keeps the chart legibly made
  // of distinct sectors instead of looking like one solid ring.
  const MIN_LEN = segs.length > 1 ? 4 : 0;
  const rawLens = segs.map((s) => Math.max(MIN_LEN, total > 0 ? (s.value / total) * C : 0));
  const sumRaw = rawLens.reduce((a, b) => a + b, 0);
  const scale = sumRaw > 0 ? C / sumRaw : 1;
  let offset = 0;
  return (
    <div className="donut">
      <svg viewBox="0 0 140 140" width="140" height="140">
        <circle cx="70" cy="70" r={R} fill="none" stroke="var(--surface-inset)" strokeWidth="16" />
        {total > 0 && segs.map((s, i) => {
          const len = rawLens[i] * scale;
          const el = (
            <circle key={s.id} cx="70" cy="70" r={R} fill="none" stroke={s.color} strokeWidth="16"
              strokeDasharray={`${len} ${C - len}`} strokeDashoffset={-offset}
              transform="rotate(-90 70 70)" strokeLinecap="butt" />
          );
          offset += len;
          return el;
        })}
        <text x="70" y="66" textAnchor="middle" className="donut-total">{fmtBytes(total)}</text>
        <text x="70" y="82" textAnchor="middle" className="donut-sub">on device</text>
      </svg>
    </div>
  );
}

export default function Settings({ flow, onClose, section = null }) {
  const { model, prefs } = flow;
  const [res, setRes] = useState(null);
  const [host, setHost] = useState(null);
  const [store, setStore] = useState(null);
  const [models, setModels] = useState(null); // cached AI models (basic + voice)
  const [modelsOpen, setModelsOpen] = useState(false);
  const [selModels, setSelModels] = useState(() => new Set());
  const [selected, setSelected] = useState(() => new Set());
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [threshold, setThreshold] = useState(prefs.smallBalanceUsd ?? 0.02);
  // Inference location: 'local' (on-device) vs 'external' (OpenAI-compatible API).
  const [infer, setInfer] = useState(prefs.inference || 'nearai');
  const [ext, setExt] = useState(() => ({ baseUrl: '', apiKey: '', model: '', ...(prefs.externalApi || {}) }));
  // NEAR AI TEE tier config + the list of attested models (fetched once, public).
  const [nai, setNai] = useState(() => ({ apiKey: '', model: '', ...(prefs.nearAi || {}) }));
  const [naiModels, setNaiModels] = useState(null); // null = not loaded, [] = none
  const [naiListErr, setNaiListErr] = useState('');
  // Also feeds the model hotlist picker, so it loads whichever tier is selected.
  useEffect(() => {
    if (naiModels) return undefined;
    let live = true;
    listConfidentialModels()
      .then((list) => { if (live) setNaiModels(list); })
      .catch((e) => { if (live) setNaiListErr(String(e?.message || e)); });
    return () => { live = false; };
  }, [naiModels]);

  // Opened from the Assistant ("Settings" / model list) → land on AI model.
  useEffect(() => {
    if (section === 'ai') document.getElementById('set-ai-model')?.scrollIntoView({ block: 'start' });
  }, [section]);

  // Hotlist: the models offered by the Assistant header's model switcher.
  const hotList = Array.isArray(prefs.hotModels) ? prefs.hotModels : effectiveHotlist(prefs, model.mode === 'local' && model.status === 'ready' ? model.id : null);
  const toggleHot = (key) => {
    const next = hotList.includes(key) ? hotList.filter((k) => k !== key) : [...hotList, key];
    flow.updatePref({ hotModels: next });
  };
  // GPU/CPU offload planning for local inference.
  const [offloadMode, setOffloadMode] = useState(prefs.offloadMode || 'auto');
  const [gpuLayers, setGpuLayers] = useState(prefs.offloadGpuLayers); // null = all
  const [recId, setRecId] = useState(null); // auto-recommended model id (for "Auto" estimates)
  const [probedArch, setProbedArch] = useState(null); // arch params from GGUF header probe

  const remeasure = () => measureStorage().then(setStore);
  const reloadModels = () => listCachedModels().then(setModels);
  useEffect(() => {
    detectResources().then(setRes);
    fetchHostInfo().then(setHost);
    remeasure();
    reloadModels();
    // Resolve the auto-recommended model so the offload estimate has a concrete
    // model to size against even when the user hasn't picked an override.
    recommendModel().then((r) => setRecId(r.modelId)).catch(() => {});
  }, []);

  // RAM/VRAM are live system figures (unlike CPU model or disk quota, which
  // don't change while the panel is open) — keep them fresh while the user has
  // Settings open instead of showing a stale snapshot from when it was opened.
  useEffect(() => {
    const id = setInterval(() => { fetchHostInfo().then(setHost); }, 30000);
    return () => clearInterval(id);
  }, []);

  // Esc to close
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const onOverride = (e) => {
    const id = e.target.value || null;
    flow.updatePref({ modelOverride: id });
  };

  // Switch inference location. Persists via flow.updatePref so flow.prefs (and
  // therefore the privacy light everywhere) updates live, and unloads whatever
  // was active. The newly-selected backend does NOT auto-load — the user starts
  // it explicitly with the "Load model" button.
  // Every tier switch is remembered immediately (not only after Connect), so the
  // last tier the user picked is the one used next time. NEAR AI is the default
  // only until they choose otherwise (storage/local.js DEFAULT_PREFS).
  const chooseTier = async (id) => {
    setInfer(id);
    if ((prefs.inference || 'nearai') === id) return;
    flow.updatePref({ inference: id });
    await flow.unloadModel();
  };
  const chooseLocal = () => chooseTier('local');
  // Reasoning budget: saved immediately (read per request, no reconnect).
  const naiBudget = prefs.nearAi?.reasoningBudget ?? DEFAULT_REASONING_BUDGET;
  const chooseBudget = (b) => flow.updatePref({ nearAi: { ...(prefs.nearAi || {}), reasoningBudget: b } });
  const naiOutPrice = (naiModels || []).find((x) => x.id === (nai.model || NEARAI_DEFAULT_MODEL))?.outUsdPerM;
  const naiLimit = outputTokenLimit(true, naiBudget);
  const budgetNote = naiLimit == null
    ? 'No cap: the model may think up to its context window. A runaway answer can take many minutes and cost much more — use Stop.'
    : `Up to ${naiLimit.toLocaleString()} output tokens per answer (reasoning + ${ANSWER_TOKENS.toLocaleString()} for the answer)` +
      (naiOutPrice != null ? ` · worst-case output cost ≈ $${((naiLimit * naiOutPrice) / 1e6).toFixed(3)}` : '') +
      '. With Think off the model does not reason.';
  const connectNearAi = async () => {
    // Key/model come from the form; reasoningBudget from live prefs (it's saved
    // on change, and `nai` holds a stale copy from when Settings opened).
    const cfg = {
      ...(prefs.nearAi || {}),
      apiKey: nai.apiKey.trim(),
      model: nai.model || NEARAI_DEFAULT_MODEL,
    };
    if (!cfg.apiKey) return;
    setNai(cfg);
    flow.updatePref({ inference: 'nearai', nearAi: cfg });
    await flow.unloadModel();
    flow.startModel();
  };
  const connectExternal = async () => {
    const cfg = { baseUrl: ext.baseUrl.trim(), apiKey: ext.apiKey.trim(), model: ext.model.trim() };
    if (!cfg.baseUrl || !cfg.model) return;
    setExt(cfg);
    flow.updatePref({ inference: 'external', externalApi: cfg });
    await flow.unloadModel();
  };
  const onEffects = (e) => { applyEffects(e.target.checked); flow.updatePref({ reduceEffects: e.target.checked }); };

  // Offload mode toggle. Entering manual with no pinned layer count defaults to
  // "all on GPU" (the same starting point Automatic uses) so the slider begins
  // from the fastest config. Takes effect on the next model load.
  const chooseOffloadMode = (mode, slots) => {
    setOffloadMode(mode);
    const patch = { offloadMode: mode };
    if (mode === 'manual' && gpuLayers == null && slots) {
      setGpuLayers(slots);
      patch.offloadGpuLayers = slots;
    }
    flow.updatePref(patch);
  };
  const commitLayers = (v, slots) => {
    const n = Math.max(0, Math.min(slots, Math.round(Number(v) || 0)));
    setGpuLayers(n);
    flow.updatePref({ offloadGpuLayers: n });
  };
  const commitThreshold = (v) => {
    const n = Math.max(0, Number(v) || 0);
    setThreshold(n);
    flow.updatePref({ smallBalanceUsd: n });
  };

  const toggle = (id) => setSelected((s) => {
    const n = new Set(s);
    if (n.has(id)) { n.delete(id); if (id === 'models') { setModelsOpen(false); setSelModels(new Set()); } }
    else { n.add(id); if (id === 'models') setModelsOpen(true); }
    setConfirming(false);
    return n;
  });

  // A model sub-checkbox refines which models get deleted; it also pulls the
  // parent "AI model files" category into the deletion set. With no sub-models
  // checked but the parent on, the whole category is deleted (legacy behaviour).
  const toggleModel = (key) => {
    setSelModels((s) => { const n = new Set(s); n.has(key) ? n.delete(key) : n.add(key); return n; });
    setSelected((s) => (s.has('models') ? s : new Set(s).add('models')));
    setConfirming(false);
  };

  const deleteSelected = async () => {
    if (!selected.size) return;
    if (!confirming) { setConfirming(true); return; }
    setBusy(true);
    for (const id of selected) {
      if (id === 'models') {
        const list = models || [];
        const toDelete = selModels.size ? list.filter((m) => selModels.has(m.key)) : list;
        await deleteCachedModels(toDelete);
      } else {
        await clearCategory(id);
      }
    }
    setSelected(new Set());
    setSelModels(new Set());
    setModelsOpen(false);
    setConfirming(false);
    await Promise.all([remeasure(), reloadModels()]);
    setBusy(false);
  };

  const disk = res?.disk;
  // navigator.storage.estimate() can lag behind a large OPFS/Cache write that
  // just completed (a known Chromium quirk), reporting a usage figure lower
  // than what's actually on disk. We already walk every store ourselves for
  // the category breakdown below (store.total) — that's ground truth, so take
  // whichever of the two is bigger instead of showing two contradictory numbers.
  const measuredTotal = store?.total ?? 0;
  const diskUsage = disk ? Math.max(disk.usage, measuredTotal) : (store ? measuredTotal : null);
  const diskFree = disk ? Math.max(0, disk.quota - diskUsage) : null;
  const usedPct = disk && disk.quota ? Math.min(100, Math.round((diskUsage / disk.quota) * 100)) : 0;
  // Host-reported memory + the active (primary/discrete) GPU, for "This device".
  const ram = host?.memory?.total ? host.memory : null;
  const ramPct = ram ? Math.min(100, Math.round(((ram.total - ram.free) / ram.total) * 100)) : 0;
  const gpu = host?.gpus?.find((g) => g.primary) || host?.gpus?.[0] || null;
  const gpuPct = gpu?.vramTotal && gpu.vramFree != null
    ? Math.min(100, Math.round(((gpu.vramTotal - gpu.vramFree) / gpu.vramTotal) * 100)) : 0;

  // ── Offload estimation ──
  // A usable GPU = WebGPU present and not the software fallback adapter. Without
  // one, everything runs on CPU and the GPU slider is meaningless.
  const gpuUsable = !!(res?.gpu?.hasWebGPU && !res.gpu.isFallbackAdapter);
  // Model the estimate sizes against: the user's override, else the currently
  // loaded local model, else the auto recommendation.
  const selModelId = prefs.modelOverride || (model.mode === 'local' ? model.id : null) || recId;
  const selModel = getModel(selModelId);

  // Probe GGUF header for real arch params (nLayer, nHeadKv, headDim) before the
  // model is loaded. Fires whenever the selected model changes; result is cached
  // so switching back to a model is instant. Silently falls back to null on error.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  useEffect(() => {
    const url = selModel?.source?.url;
    if (!url) { setProbedArch(null); return; }
    let cancelled = false;
    probeGGUFArch(url).then((arch) => { if (!cancelled) setProbedArch(arch); });
    return () => { cancelled = true; };
  }, [selModelId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Real layer count from GGUF metadata when this exact model is loaded — highest
  // priority; overrides both registry hints and the probed arch.
  const loadedLayers = model.mode === 'local' && model.status === 'ready' && model.id === selModelId
    ? model.ctxStatus?.modelLayers : null;
  const offloadArch = selModel ? getModelArch(selModel, loadedLayers, probedArch) : null;
  const layersKnown = offloadArch?.nLayer != null;
  const offloadTotal = layersKnown ? offloadArch.nLayer + 1 : 0; // slots incl. output layer
  const manualLayers = gpuLayers == null ? offloadTotal : Math.min(gpuLayers, offloadTotal);
  const effLayers = !gpuUsable ? 0 : offloadMode === 'manual' ? manualLayers : offloadTotal;
  const offloadPlan = selModel
    ? describeOffload({ model: selModel, gpuLayers: effLayers, loadedLayers, probedArch })
    : null;
  const vramTotal = gpu?.vramTotal || null;
  const ramTotal = ram?.total || null;
  // Speed headline vs 100%-GPU baseline.
  let offSpeedLabel = '—';
  let offSpeedSub = '';
  if (offloadPlan) {
    if (!gpuUsable) { offSpeedLabel = 'CPU only'; offSpeedSub = 'No compatible GPU'; }
    else if (offloadPlan.gpuLayers >= offloadTotal) { offSpeedLabel = 'Full GPU'; offSpeedSub = 'Fastest — baseline'; }
    else {
      offSpeedLabel = `~${offloadPlan.speed.slowerX.toFixed(1)}× slower`;
      offSpeedSub = offloadPlan.gpuLayers === 0
        ? 'CPU only vs full GPU'
        : `~${offloadPlan.speed.slowerPct}% less throughput`;
    }
  }
  const selectedBytes = useMemo(() => {
    if (!store) return 0;
    let n = 0;
    for (const id of selected) {
      if (id === 'models') {
        n += selModels.size
          ? (models || []).filter((m) => selModels.has(m.key)).reduce((a, m) => a + (m.size || 0), 0)
          : (store.byId.models || 0);
      } else {
        n += store.byId[id] || 0;
      }
    }
    return n;
  }, [selected, store, selModels, models]);

  return (
    <div className="modal-scrim" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal settings-modal" role="dialog" aria-label="Settings">
        <div className="settings-head">
          <span className="badge-accent"><IGear /> Settings</span>
          <span className="spacer" />
          <button className="icon-btn" title="Close" onClick={onClose}><IClose /></button>
        </div>

        <div className="settings-body">
          {/* ── Token holdings ── */}
          <section className="set-sec">
            <h3>Token holdings</h3>
            <div className="set-row">
              <div className="set-label">
                <strong>Hide small balances below</strong>
                <span className="muted">Tokens under this USD value (and unpriced tokens) are hidden by default in Token holdings.</span>
              </div>
              <div className="thresh">
                <span className="cur">$</span>
                <input type="number" min="0" step="0.01" value={threshold}
                  onChange={(e) => setThreshold(e.target.value)}
                  onBlur={(e) => commitThreshold(e.target.value)} />
              </div>
            </div>
            <input className="thresh-range" type="range" min="0" max="10" step="0.01"
              value={Math.min(10, threshold)} onChange={(e) => commitThreshold(e.target.value)} />
          </section>

          {/* ── AI model ── */}
          <section className="set-sec" id="set-ai-model">
            <h3>AI model</h3>

            <div className="set-row">
              <div className="set-label">
                <strong>Run inference</strong>
                <span className="muted">NEAR AI TEE is the recommended default. On device gives maximum privacy; an external API sends everything to its provider.</span>
              </div>
              <div className="seg" role="tablist" aria-label="Inference location">
                <button className={infer === 'nearai' ? 'on' : ''} role="tab" aria-selected={infer === 'nearai'}
                  onClick={() => chooseTier('nearai')}>NEAR AI TEE · Recommended</button>
                <button className={infer === 'local' ? 'on' : ''} role="tab" aria-selected={infer === 'local'}
                  onClick={chooseLocal}>On device</button>
                <button className={infer === 'external' ? 'on' : ''} role="tab" aria-selected={infer === 'external'}
                  onClick={() => chooseTier('external')}>External API</button>
              </div>
            </div>
            <div className="ext-cfg">
              {infer === 'nearai' ? (
                <div className="ext-warn tee">
                  <strong>Recommended — the balance of speed, convenience and privacy.</strong> Fast, capable models with
                  no download and no load on your machine; privacy is enforced by a hardware enclave this browser verifies.
                </div>
              ) : infer === 'local' ? (
                <div className="ext-warn tee">
                  <strong>Maximum privacy — the model and your data never leave this machine.</strong> Trade-offs: answers
                  can be slow, local models are less capable, and inference uses this computer's GPU/CPU and memory —
                  expect freezes and slowdowns while it runs, plus a one-time multi-GB download.
                </div>
              ) : (
                <div className="ext-warn">
                  <strong>Warning: everything is sent to the inference provider.</strong> Your question and wallet facts go
                  to whoever operates the endpoint, with no verification of how they are handled.
                </div>
              )}
            </div>

            {infer === 'local' ? (
              <>
              <div className="set-row">
                <div className="set-label">
                  <strong>Model</strong>
                  <span className="muted">
                    {model.mode === 'external' ? 'External API selected — switch back to load a local model'
                      : model.status === 'ready' ? `Loaded · ${model.ctxStatus?.backend || 'on device'}${model.ctxStatus?.nThreads ? ` · ${model.ctxStatus.nThreads} CPU threads` : ''}`
                      : model.status === 'loading' ? 'Loading…'
                      : model.status === 'error' ? 'Failed to load' : 'Not loaded'}
                  </span>
                </div>
                <select value={prefs.modelOverride || ''} onChange={onOverride} style={{ width: 'auto' }}>
                  <option value="">Auto (by device)</option>
                  {MODELS.map((m) => <option key={m.id} value={m.id}>{m.name} — {formatSize(m.sizeBytes)}</option>)}
                </select>
              </div>

              {selModel && (
                <div className="offload">
                  <div className="set-row">
                    <div className="set-label">
                      <strong>GPU offload</strong>
                      <span className="muted">
                        {layersKnown
                          ? <>How many of {selModel.name}&apos;s {offloadTotal} layers run on the GPU.{' '}
                              {gpuUsable
                                ? 'More on the GPU is faster but needs more VRAM.'
                                : 'No compatible GPU detected — inference runs entirely on CPU.'}</>
                          : 'Layer count is read from the model file — available once the model loads or its header is fetched.'}
                      </span>
                    </div>
                    <div className="seg" role="tablist" aria-label="Offload mode">
                      <button className={offloadMode === 'auto' ? 'on' : ''} role="tab" aria-selected={offloadMode === 'auto'}
                        onClick={() => chooseOffloadMode('auto', offloadTotal)}>Automatic</button>
                      <button className={offloadMode === 'manual' ? 'on' : ''} role="tab" aria-selected={offloadMode === 'manual'}
                        disabled={!gpuUsable || !layersKnown}
                        onClick={() => chooseOffloadMode('manual', offloadTotal)}>Manual</button>
                    </div>
                  </div>

                  {offloadMode === 'manual' && gpuUsable && (
                    <div className="offload-slider">
                      <div className="offload-slider-head">
                        <span>Layers on GPU</span>
                        <span className="offload-count">
                          {layersKnown ? effLayers : '—'} <em>/ {layersKnown ? offloadTotal : '—'}</em>
                        </span>
                      </div>
                      <input type="range" className="thresh-range" min="0" max={offloadTotal || 1} step="1"
                        value={layersKnown ? effLayers : 0}
                        disabled={!layersKnown}
                        onChange={(e) => commitLayers(e.target.value, offloadTotal)} />
                      <div className="offload-slider-ends"><span>CPU only</span><span>All on GPU</span></div>
                    </div>
                  )}

                  {offloadPlan ? (
                    <>
                    <div className="offload-est">
                      <div className="oe-tile">
                        <span className="rk">VRAM needed</span>
                        <span className={`rv${vramTotal && offloadPlan.vram > vramTotal ? ' over' : ''}`}>{fmtBytesBin(offloadPlan.vram)}</span>
                        <span className="rn">{vramTotal ? `of ${fmtBytesBin(vramTotal)} VRAM` : 'VRAM not reported by WebGPU'}</span>
                      </div>
                      <div className="oe-tile">
                        <span className="rk">System RAM needed</span>
                        <span className={`rv${ramTotal && offloadPlan.ram > ramTotal ? ' over' : ''}`}>{fmtBytesBin(offloadPlan.ram)}</span>
                        <span className="rn">{ramTotal ? `of ${fmtBytesBin(ramTotal)} RAM` : ''}</span>
                      </div>
                      <div className="oe-tile">
                        <span className="rk">Speed</span>
                        <span className="rv">{offSpeedLabel}</span>
                        <span className="rn">{offSpeedSub}</span>
                      </div>
                    </div>
                    <span className="muted offload-note">
                      Estimated at {(offloadPlan.nCtx || selModel.nCtx).toLocaleString()}-token max context (KV cache included).
                      Figures are approximate; changes apply the next time the model loads.
                    </span>
                    </>
                  ) : (
                    <span className="muted offload-note">
                      Memory and speed estimates will appear once the layer count is known.
                    </span>
                  )}
                </div>
              )}
              </>
            ) : infer === 'nearai' ? (
              <div className="ext-cfg">
                <div className="ext-warn tee">
                  <strong>Private by verification, not by locality.</strong> Your question and wallet facts leave this
                  device, end-to-end encrypted to a model running inside an Intel TDX + NVIDIA confidential-computing
                  enclave. This browser checks the enclave's attestation before the session and its signature after
                  every answer. Only NEAR-operated attested models are offered — relayed "Incognito" models (OpenAI,
                  Anthropic, Gemini) run outside a TEE and are refused.
                </div>
                <label className="ext-field">
                  <span>NEAR AI API key <em>(cloud.near.ai — stored only in this browser)</em></span>
                  <input type="password" spellCheck={false} autoComplete="off" placeholder="sk-…"
                    value={nai.apiKey} onChange={(e) => setNai((x) => ({ ...x, apiKey: e.target.value }))} />
                </label>
                <label className="ext-field">
                  <span>Model <em>(attested NEAR AI models only)</em></span>
                  <select value={nai.model || NEARAI_DEFAULT_MODEL}
                    onChange={(e) => setNai((x) => ({ ...x, model: e.target.value }))}>
                    {/* Always include the current choice so the select never
                        displays one model while Connect would use another. */}
                    {(() => {
                      const opt = (mm) => (
                        <option key={mm.id} value={mm.id}>
                          {mm.name}{mm.tier === '3p' ? ` (${providerLabel(mm.provider)})` : ''}{mm.outUsdPerM != null && mm.inUsdPerM != null ? ` · $${mm.inUsdPerM.toFixed(2)} / $${mm.outUsdPerM.toFixed(2)} per M tok` : ''}
                        </option>
                      );
                      const list = naiModels || [];
                      const cur = nai.model || NEARAI_DEFAULT_MODEL;
                      const own = list.filter((x) => x.tier !== '3p');
                      const tp = list.filter((x) => x.tier === '3p');
                      return (
                        <>
                          {!list.some((x) => x.id === cur) && opt({ id: cur, name: `${cur}${naiModels ? ' (not in current list)' : ''}` })}
                          {own.length > 0 && <optgroup label="NEAR TEE — fully verified in this browser">{own.map(opt)}</optgroup>}
                          {tp.length > 0 && <optgroup label="3P TEE — gateway-verified, no E2EE to model">{tp.map(opt)}</optgroup>}
                        </>
                      );
                    })()}
                  </select>
                </label>
                {naiModels?.find((x) => x.id === (nai.model || NEARAI_DEFAULT_MODEL))?.tier === '3p' && (
                  <div className="ext-status muted">
                    3P TEE: a third-party confidential provider runs this model. This browser verifies NEAR’s gateway enclave and
                    encrypts the request to it (OHTTP); the provider’s own TEE evidence is checked by the gateway, not here, and
                    there is no end-to-end encryption to the model.
                  </div>
                )}
                {naiListErr && <div className="ext-status muted">Model list unavailable ({naiListErr}) — using the default.</div>}
                <label className="ext-field">
                  <span>Reasoning budget <em>(when “Think” is on — applies to the next question)</em></span>
                  <select value={String(naiBudget)} onChange={(e) => chooseBudget(Number(e.target.value))}>
                    {REASONING_BUDGETS.map((b) => (
                      <option key={b} value={String(b)}>{b === 0 ? 'Unlimited' : `${b / 1024}k tokens`}</option>
                    ))}
                  </select>
                </label>
                <div className="ext-status muted">{budgetNote}</div>
                <div className="ext-status muted">
                  {model.mode === 'nearai' && model.status === 'ready' ? `Verified · ${model.externalName}`
                    : model.mode === 'nearai' && model.status === 'loading' ? (model.statusText || 'Verifying attestation…')
                    : model.mode === 'nearai' && model.status === 'error' ? `Failed: ${model.error || 'see console'}`
                    : 'Not connected'}
                </div>
                <div className="set-actions end">
                  <button className="btn sm" disabled={!nai.apiKey.trim() || (model.mode === 'nearai' && model.status === 'loading')} onClick={connectNearAi}>
                    <IDownload /> {model.mode === 'nearai' && model.status === 'ready' ? 'Re-verify' : 'Verify & connect'}
                  </button>
                </div>
              </div>
            ) : (
              <div className="ext-cfg">
                <div className="ext-warn">
                  <strong>Recommended only for self-hosted models.</strong> Use an external API only if it runs on
                  your own machine or your own server. If you point this at a third-party provider, your wallet data
                  leaves this device and is exposed to whoever operates that endpoint.
                </div>
                <label className="ext-field">
                  <span>Base URL</span>
                  <input type="text" spellCheck={false} placeholder="http://localhost:8080/v1"
                    value={ext.baseUrl} onChange={(e) => setExt((x) => ({ ...x, baseUrl: e.target.value }))} />
                </label>
                <label className="ext-field">
                  <span>API key <em>(optional — blank for most local servers)</em></span>
                  <input type="password" spellCheck={false} placeholder="sk-…"
                    value={ext.apiKey} onChange={(e) => setExt((x) => ({ ...x, apiKey: e.target.value }))} />
                </label>
                <label className="ext-field">
                  <span>Model name</span>
                  <input type="text" spellCheck={false} placeholder="e.g. qwen2.5-7b-instruct"
                    value={ext.model} onChange={(e) => setExt((x) => ({ ...x, model: e.target.value }))} />
                </label>
                <div className="ext-status muted">
                  {model.mode === 'external' && model.status === 'ready' ? `Connected · ${model.externalName || ext.model}`
                    : model.mode === 'external' && model.status === 'loading' ? 'Connecting…'
                    : model.mode === 'external' && model.status === 'error' ? `Failed: ${model.error || 'see console'}`
                    : 'Not connected'}
                </div>
                <div className="set-actions end">
                  <button className="btn sm" disabled={!ext.baseUrl.trim() || !ext.model.trim()} onClick={connectExternal}>
                    <IDownload /> {model.mode === 'external' && model.status === 'ready' ? 'Reconnect' : 'Connect'}
                  </button>
                </div>
              </div>
            )}

            <div className="hotlist">
              <div className="set-label">
                <strong>Quick-switch models</strong>
                <span className="muted">
                  Tick the models you want in the list that opens when you click the model name in the Wallet Assistant.
                  Choosing one there switches to it in one click.
                </span>
              </div>
              {[
                { t: 'nearai', items: (naiModels || []).map((x) => ({ key: hotKey('nearai', x.id), name: x.name, note: x.tier === '3p' ? `3P TEE · ${providerLabel(x.provider)}` : 'NEAR TEE' })) },
                { t: 'local', items: MODELS.map((x) => ({ key: hotKey('local', x.id), name: x.name, note: formatSize(x.sizeBytes) })) },
                { t: 'external', items: prefs.externalApi?.model ? [{ key: hotKey('external', prefs.externalApi.model), name: prefs.externalApi.model, note: 'your endpoint' }] : [] },
              ].map((g) => (
                <div key={g.t} className="hot-group">
                  <div className="hot-tier">{TIER_LABELS[g.t]}</div>
                  {g.t === 'nearai' && !naiModels && !naiListErr && <div className="muted hot-empty">Loading NEAR AI models…</div>}
                  {g.t === 'nearai' && naiListErr && <div className="muted hot-empty">NEAR AI model list unavailable ({naiListErr}).</div>}
                  {g.t === 'external' && !g.items.length && <div className="muted hot-empty">Configure an external API above to list its model here.</div>}
                  {g.items.map((it) => (
                    <label key={it.key} className="check hot-row">
                      <input type="checkbox" checked={hotList.includes(it.key)} onChange={() => toggleHot(it.key)} />
                      <span className="hot-name">{it.name}</span>
                      <span className="muted hot-note">{it.note}</span>
                    </label>
                  ))}
                </div>
              ))}
            </div>

            <div className="set-actions">
              {model.status === 'ready' ? (
                <button className="btn ghost sm" onClick={() => flow.unloadModel()}><IPower /> Unload model</button>
              ) : model.status === 'error' && infer === 'local' ? (
                <button className="btn sm" onClick={() => flow.retryModel()}><IDownload /> Retry load</button>
              ) : model.status === 'idle' && infer === 'local' ? (
                <button className="btn sm" onClick={() => flow.startModel()}><IDownload /> Load model</button>
              ) : null}
              <label className="check">
                <input type="checkbox" checked={!!prefs.reduceEffects} onChange={onEffects} />
                Reduce visual effects
              </label>
            </div>
          </section>

          {/* ── Device resources ── */}
          <section className="set-sec">
            <h3>This device</h3>
            <div className="res-grid">
              <div className="res-tile wide">
                <span className="rk">Processor (CPU)</span>
                <span className="rv">{host?.cpu?.model || '—'}</span>
                <span className="rn">
                  {host?.cpu?.physicalCores
                    ? `${host.cpu.physicalCores} cores`
                    : host?.cpu?.logicalCores ? `${host.cpu.logicalCores} threads` : (res?.cores ? `${res.cores} threads` : '')}
                  {host?.cpu?.physicalCores && host?.cpu?.logicalCores ? ` · ${host.cpu.logicalCores} threads` : ''}
                </span>
              </div>
              <div className="res-tile">
                <span className="rk">Memory (RAM)</span>
                <span className="rv">
                  {ram ? `${fmtBytesBin(ram.free)} free` : res?.ram ? `~${res.ram} GB` : '—'}
                </span>
                {ram ? (
                  <>
                    <div className="bar"><i style={{ width: `${ramPct}%` }} /></div>
                    <span className="rn">{fmtBytesBin(ram.total - ram.free)} used of {fmtBytesBin(ram.total)} total</span>
                  </>
                ) : (
                  <span className="rn">{res?.cores ? `${res.cores} logical cores` : ''}</span>
                )}
              </div>
              <div className="res-tile">
                <span className="rk">GPU</span>
                <span className="rv">
                  {gpu?.name || (res ? (res.gpu.hasWebGPU ? (res.gpu.vendor || 'WebGPU') : 'No WebGPU') : '—')}
                </span>
                {gpu?.vramTotal ? (
                  <>
                    {gpu.vramFree != null && (
                      <div className="bar"><i style={{ width: `${gpuPct}%` }} /></div>
                    )}
                    <span className="rn">
                      {gpu.vramFree != null
                        ? `${fmtBytesBin(gpu.vramFree)} free of ${fmtBytesBin(gpu.vramTotal)} VRAM`
                        : `${fmtBytesBin(gpu.vramTotal)} VRAM`}
                      {res?.gpu.hasWebGPU ? ' · WebGPU active' : ''}
                    </span>
                  </>
                ) : (
                  <span className="rn">
                    {res?.gpu.architecture || ''}
                    {res?.gpu.maxBuffer ? ` · max buffer ${fmtBytes(res.gpu.maxBuffer)}` : ''}
                    {res ? ' · VRAM not exposed by WebGPU' : ''}
                  </span>
                )}
              </div>
              <div className="res-tile wide">
                <span className="rk">Browser storage (disk)</span>
                <span className="rv">
                  {diskUsage != null ? `${fmtBytes(diskUsage)} used${diskFree != null ? ` · ${fmtBytes(diskFree)} free` : ''}` : '—'}
                </span>
                {disk && (
                  <>
                    <div className="bar"><i style={{ width: `${usedPct}%` }} /></div>
                    <span className="rn">{fmtBytes(disk.quota)} quota for this site · this app uses {fmtBytes(diskUsage)}</span>
                  </>
                )}
              </div>
            </div>
          </section>

          {/* ── On-device storage / data ── */}
          <section className="set-sec">
            <h3>On-device data</h3>
            <div className="storage-wrap">
              <Donut byId={store?.byId || {}} order={STORAGE_CATEGORIES} />
              <div className="cat-list">
                {STORAGE_CATEGORIES.map((c, i) => {
                  const Icon = ICONS[c.icon] || IDatabase;
                  const size = store?.byId[c.id] ?? null;
                  const empty = !size;
                  const isModels = c.id === 'models';
                  const open = isModels && modelsOpen && !empty;
                  return (
                    <div key={c.id} className="cat-group">
                      <label className={`cat-row${empty ? ' empty' : ''}`}>
                        <input type="checkbox" disabled={empty} checked={selected.has(c.id)}
                          ref={isModels ? (el) => {
                            if (!el) return;
                            // Partial sub-selection (some but not all models picked) shows the
                            // native indeterminate (box/dash) state instead of a full checkmark,
                            // so it's visually clear this isn't "delete everything".
                            el.indeterminate = selModels.size > 0 && models != null && selModels.size < models.length;
                          } : undefined}
                          onChange={() => toggle(c.id)} />
                        <span className="dotc" style={{ background: SEG_COLORS[i % SEG_COLORS.length] }} />
                        <span className="cat-ic"><Icon /></span>
                        <span className="cat-meta">
                          <span className="cat-name">{c.label}</span>
                          <span className="cat-note">{c.note}</span>
                        </span>
                        <span className="cat-size">{store ? (size ? fmtBytes(size) : (c.id === 'prices' ? 'live' : '—')) : '…'}</span>
                        {isModels && !empty && (
                          <button type="button" className={`cat-caret${open ? ' open' : ''}`}
                            title={open ? 'Hide models' : 'Show models'}
                            onClick={(e) => { e.preventDefault(); setModelsOpen((v) => !v); }}>
                            <IChevDown />
                          </button>
                        )}
                      </label>

                      {open && (
                        <div className="submodel-list">
                          {models == null ? (
                            <div className="submodel-empty">Loading models…</div>
                          ) : models.length === 0 ? (
                            <div className="submodel-empty">No model files cached yet.</div>
                          ) : (
                            <>
                              {models.map((m) => (
                                <label key={m.key} className="submodel-row">
                                  <input type="checkbox" checked={selModels.has(m.key)} onChange={() => toggleModel(m.key)} />
                                  <span className="cat-ic"><ICpu /></span>
                                  <span className="cat-meta">
                                    <span className="cat-name">{m.name}</span>
                                    <span className="cat-note">{m.role}</span>
                                  </span>
                                  <span className="cat-size">{m.size != null ? fmtBytes(m.size) : '—'}</span>
                                </label>
                              ))}
                              <div className="submodel-hint">
                                {selModels.size
                                  ? `${selModels.size} model${selModels.size > 1 ? 's' : ''} selected`
                                  : 'No models picked — deleting will remove all of them.'}
                              </div>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {confirming && (
              <div className="purge-warn">
                <ITrash />
                <span>
                  This permanently deletes the selected data ({fmtBytes(selectedBytes)}) from <strong>this device</strong>.
                  The action is <strong>irreversible</strong>. Cached models can be downloaded again later.
                </span>
              </div>
            )}
            <div className="set-actions end">
              {confirming && <button className="btn ghost sm" disabled={busy} onClick={() => setConfirming(false)}>Cancel</button>}
              <button className={`btn sm${confirming ? ' danger' : ''}`} disabled={!selected.size || busy} onClick={deleteSelected}>
                <ITrash /> {busy ? 'Deleting…' : confirming ? `Confirm delete (${fmtBytes(selectedBytes)})` : `Delete selected${selected.size ? ` (${selected.size})` : ''}`}
              </button>
            </div>
          </section>

          <p className="modal-fine"><IGear /> Everything here lives on your device. Nothing is uploaded.</p>
        </div>
      </div>
    </div>
  );
}
