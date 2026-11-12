// Middle inference tier: NEAR AI Cloud, private-by-attestation.
//
// The model runs on NEAR AI's own GPUs inside Intel TDX + NVIDIA Confidential
// Computing. Everything that makes that claim checkable happens in THIS browser
// through @nearai/inference-sdk — there is no server of ours in the path:
//
//   before a request   gateway TDX quote, model TDX quote(s), NVIDIA GPU
//                      evidence and fresh client nonces are verified; the model's
//                      quote-bound public key is selected for E2EE
//   during             prompt + answer are end-to-end encrypted to that key
//                      (X25519 / XChaCha20-Poly1305); the gateway relays
//                      ciphertext it cannot read
//   after              the response signature is checked against the exact
//                      request/response bytes and the attested model signer
//
// Only NEAR-operated vLLM models with model attestation are accepted. "Incognito"
// models (OpenAI/Anthropic/Gemini relayed through the TEE gateway) run OUTSIDE a
// TEE; e2ee:true makes the SDK reject them before any chat is sent, and
// listConfidentialModels() never offers them.
//
// Public surface mirrors WllamaContext / ExternalContext so InferenceRouter and
// the assistant treat all three backends the same. analyze() additionally
// returns `verification`, a JSON-safe receipt the UI renders as "Verified".

// Verifier (and jose) load lazily with the SDK, keeping both out of the entry chunk.
export const CLOCK_TOLERANCE_S = 120;

export const NEARAI_BASE_URL = 'https://cloud-api.near.ai/v1';
export const NEARAI_DEFAULT_MODEL = 'z-ai/glm-5.3-flash';

// Non-chat models that still advertise attestation.
const NON_CHAT = /embedding|reranker|whisper|flux|privacy-filter|-vl-/i;
// Commercial APIs NEAR relays through its gateway ("Incognito": outside a TEE).
const RELAYED_PREFIX = /^(openai|anthropic|google|x-ai)\//i;

// A model qualifies for the TEE tier only if NEAR runs it in its own attested
// vLLM deployment. Pure function, exported for tests.
export function isConfidentialModel(meta) {
  const m = meta?.metadata || {};
  return (
    m.providerType === 'vllm' &&
    m.attestationSupported === true &&
    String(m.ownedBy || '').toLowerCase() === 'nearai' &&
    !NON_CHAT.test(String(meta?.modelId || ''))
  );
}

let modelListPromise = null;

// Lists chat models eligible for the TEE tier. Public endpoints, no key needed.
// [{ id, name, contextLength, inUsdPerM, outUsdPerM }]
export function listConfidentialModels({ fetchImpl = (...a) => fetch(...a) } = {}) {
  if (!modelListPromise) {
    modelListPromise = (async () => {
      const r = await fetchImpl(`${NEARAI_BASE_URL}/models`);
      if (!r.ok) throw new Error(`NEAR AI model list failed (${r.status})`);
      const ids = ((await r.json())?.data || [])
        .map((m) => m.id)
        // Skip relayed commercial providers up front (~2/3 of the catalog) to
        // save requests; every remaining id is still checked via metadata.
        .filter((id) => typeof id === 'string' && !NON_CHAT.test(id) && !RELAYED_PREFIX.test(id));
      const out = [];
      // Small pool: one metadata GET per model, 6 at a time.
      let i = 0;
      const worker = async () => {
        while (i < ids.length) {
          const id = ids[i++];
          try {
            const res = await fetchImpl(`${NEARAI_BASE_URL}/model/${encodeURIComponent(id)}`);
            if (!res.ok) continue;
            const meta = await res.json();
            if (!isConfidentialModel(meta)) continue;
            const perM = (c) => (c && Number.isFinite(c.amount) ? (c.amount / 10 ** (c.scale ?? 9)) * 1e6 : null);
            out.push({
              id,
              name: meta.metadata?.modelDisplayName || id,
              contextLength: meta.metadata?.contextLength || null,
              inUsdPerM: perM(meta.inputCostPerToken),
              outUsdPerM: perM(meta.outputCostPerToken),
            });
          } catch { /* skip one bad entry */ }
        }
      };
      await Promise.all(Array.from({ length: 6 }, worker));
      // Empty almost certainly means the metadata calls failed, not that NEAR
      // has no attested models — throw so it isn't cached and the UI says so.
      if (!out.length) throw new Error('no attested models returned');
      return out.sort((a, b) => a.name.localeCompare(b.name));
    })().catch((e) => { modelListPromise = null; throw e; });
  }
  return modelListPromise;
}

const short = (s, n = 10) => (typeof s === 'string' && s.length > n * 2 ? `${s.slice(0, n)}…${s.slice(-6)}` : s || '');

// SDK attestation result → small JSON-safe summary (no quotes/event logs).
export function summarizeAttestation(att, model) {
  return {
    model,
    verifiedAt: att.verifiedAt,
    gateway: {
      tcbStatus: att.gateway?.tcbStatus,
      advisoryIds: [...(att.gateway?.advisoryIds || [])],
      signer: short(att.gateway?.signer?.signingAddress),
      tlsBinding: att.gateway?.tlsBinding?.kind || 'none',
    },
    models: (att.models || []).map((m) => ({
      tcbStatus: m.tcbStatus,
      advisoryIds: [...(m.advisoryIds || [])],
      gpuEvidence: m.gpuEvidence,
      signer: short(m.signer?.signingAddress),
      algo: m.signer?.signingAlgo,
    })),
  };
}

// Receipt → ordered list of checks for the "Verified" panel. Pure, testable.
// Each: { id, label, ok: true|false|null (null = not applicable/pending), detail }
export function verificationChecks(receipt) {
  const a = receipt?.attestation;
  const r = receipt?.response;
  const models = a?.models || [];
  // The SDK also accepts OutOfDate / TDRelaunchAdvised (genuine enclave, platform
  // patches pending). We still send in that case but don't show a green ✓ —
  // the panel reads "Not fully verified" with the status in the detail line.
  const tcbOk = (s) => s === 'UpToDate';
  const gpuAll = models.length > 0 && models.every((m) => m.gpuEvidence === 'verified');
  return [
    {
      id: 'gateway',
      label: 'Gateway runs in an Intel TDX enclave',
      ok: !!a && tcbOk(a.gateway?.tcbStatus),
      detail: a ? `TDX quote · TCB ${a.gateway?.tcbStatus}` : 'not checked',
    },
    {
      id: 'model',
      label: 'Model runs in an Intel TDX enclave',
      ok: models.length > 0 && models.every((m) => tcbOk(m.tcbStatus)),
      detail: models.length ? `${models.length} quote${models.length > 1 ? 's' : ''} · TCB ${[...new Set(models.map((m) => m.tcbStatus))].join(', ')}` : 'no model attestation',
    },
    {
      id: 'gpu',
      label: 'GPU in NVIDIA confidential-computing mode',
      ok: models.length ? gpuAll : false,
      detail: gpuAll ? `NVIDIA NRAS verdict verified (clock tolerance ±${CLOCK_TOLERANCE_S}s)` : 'GPU evidence not provided',
    },
    {
      id: 'fresh',
      label: 'Evidence is fresh (bound to this browser’s nonce)',
      ok: !!a?.verifiedAt,
      detail: a?.verifiedAt ? `verified ${new Date(a.verifiedAt).toLocaleTimeString()}` : 'not checked',
    },
    {
      id: 'e2ee',
      label: 'Prompt and answer end-to-end encrypted to the model',
      ok: receipt?.e2ee === true,
      detail: receipt?.e2ee ? 'X25519 + XChaCha20-Poly1305 to the attested model key' : 'off',
    },
    {
      id: 'signature',
      label: 'Answer signed inside the model enclave',
      ok: r ? r.ok === true && r.kind === 'provider_tee' : null,
      detail: !r ? 'pending' : r.ok ? `${r.kind} signature over exact request/response bytes` : `failed: ${r.error || 'unknown'}`,
    },
  ];
}

export function receiptVerified(receipt) {
  return verificationChecks(receipt).every((c) => c.ok === true);
}

// --- Reasoning budget --------------------------------------------------------
// Reasoning and answer share one max_tokens. With Think off the model doesn't
// reason, so ANSWER_TOKENS is the whole limit; with Think on the limit is the
// user's reasoning budget plus room for the answer. 0 = no limit at all.
export const ANSWER_TOKENS = 4096;
export const DEFAULT_REASONING_BUDGET = 32768;
export const REASONING_BUDGETS = [8192, 16384, 32768, 65536, 131072, 0];

// Pure, exported for tests and the Settings cost estimate.
// → number of output tokens, or null for "no max_tokens".
export function outputTokenLimit(thinking, budget) {
  if (!thinking) return ANSWER_TOKENS;
  if (budget === 0) return null;
  const b = Number(budget);
  return (Number.isFinite(b) && b > 0 ? Math.round(b) : DEFAULT_REASONING_BUDGET) + ANSWER_TOKENS;
}

// Turns SDK errors into something a user can act on.
function explain(err) {
  const code = err?.failure?.code || err?.code || '';
  const reason = err?.failure?.details?.reason || err?.reason || '';
  const msg = String(err?.message || err);
  if (/401|unauthor|invalid api key/i.test(msg)) return 'NEAR AI rejected the API key (401). Check it in Settings → AI model.';
  if (/402|insufficient|credit|balance/i.test(msg)) return 'NEAR AI account has no credits left (402).';
  if (code === 'policy.model_attestation_required') return 'This model has no TEE attestation (Incognito) — not allowed in the TEE tier.';
  if (reason === 'not_yet_valid' || reason === 'expired') return `Attestation token time check failed (${reason}). Your system clock may be off by more than ${CLOCK_TOLERANCE_S}s — sync it and retry.`;
  if (/failed to fetch|networkerror|connection error/i.test(msg)) return 'Could not reach NEAR AI Cloud (network/CORS).';
  return code ? `${code}${reason ? ` (${reason})` : ''}: ${msg}` : msg;
}

export class NearAiContext {
  constructor() {
    this.client = null;
    this.config = null; // { apiKey, model }
    this.modelLoaded = false;
    this.attestation = null;
    this._abort = null;
    this._userStopped = false;
  }

  async initialize(config, onStatus = () => {}) {
    const apiKey = String(config?.apiKey || '').trim();
    const model = String(config?.model || '').trim() || NEARAI_DEFAULT_MODEL;
    if (!apiKey) throw new Error('NEAR AI API key is required.');
    onStatus('Loading verifier…');
    // Lazy: the SDK (+ dcap-qvl wasm, sigstore) never touches the entry chunk.
    const [{ InferenceClient }, { createSkewTolerantGpuVerifier }] = await Promise.all([
      import('@nearai/inference-sdk'),
      import('./nrasVerifier.js'),
    ]);
    this.client = new InferenceClient({
      apiKey,
      e2ee: true,
      modelVerification: { verifiers: { gpuEvidence: createSkewTolerantGpuVerifier() } },
    });
    onStatus('Verifying TEE attestation…');
    try {
      const att = await this.client.verify(model);
      if (!att.models?.length) throw Object.assign(new Error('model has no TEE attestation'), { code: 'policy.model_attestation_required' });
      this.attestation = summarizeAttestation(att, model);
    } catch (e) {
      this.client = null;
      throw new Error(explain(e));
    }
    this.config = { apiKey, model };
    this.modelLoaded = true;
    onStatus('Ready');
    return this.getStatus();
  }

  async warmup() {}

  // reasoningBudget: tokens the model may spend thinking when `thinking` is on
  // (0 = unlimited, undefined = DEFAULT_REASONING_BUDGET). Read per request so a
  // Settings change applies without reconnecting.
  async analyze(messages, onStream, thinkParserFactory, { thinking = true, reasoningBudget } = {}) {
    if (!this.modelLoaded || !this.client) throw new Error('NEAR AI model not connected');
    const maxTokens = outputTokenLimit(thinking, reasoningBudget);
    const client = this.client; // stable for this request even if unload() runs
    const { model } = this.config;
    this._abort = new AbortController();
    this._userStopped = false;
    const startedAt = performance.now();

    // Re-verify (served from the SDK's 60-min cache when fresh) so the receipt
    // reflects the evidence actually used for this request.
    try {
      this.attestation = summarizeAttestation(await client.verify(model), model);
    } catch (e) {
      throw new Error(explain(e));
    }

    const parser = thinking && typeof thinkParserFactory === 'function' ? thinkParserFactory() : null;
    let text = '';
    let inThink = false;
    let finishReason = null;
    let completionId = null;
    let lastEmitAt = 0;
    let chunks = 0;
    let firstAt = null;
    let tps = null;
    const emit = () => {
      lastEmitAt = performance.now();
      const p = parser ? parser.snapshot() : { visible: text.trim(), think: '', isThinking: false, thinkPreview: [] };
      onStream(p.visible, p.think, p.isThinking, tps, p.thinkPreview);
    };
    const pushThink = (s) => { if (!parser) return; if (!inThink) { parser.push('<think>'); inThink = true; } parser.push(s); };
    const pushText = (s) => { text += s; if (parser) { if (inThink) { parser.push('</think>'); inThink = false; } parser.push(s); } };

    console.info(`[nearai] E2EE request → ${model}`);
    try {
      const stream = await client.chat.completions.create(
        {
          model, messages, stream: true, temperature: 0.7, top_p: 0.8,
          // Reasoning models otherwise think by default; with the toggle off the
          // trace is hidden anyway, and on a full wallet-facts prompt Qwen 3.8
          // spent the entire 4096-token budget thinking (2+ min, no answer).
          // vLLM honours this chat-template switch; E2EE leaves it intact.
          chat_template_kwargs: { enable_thinking: !!thinking },
          // Omitted (unlimited) → vLLM allows up to the rest of the context window.
          ...(maxTokens != null ? { max_tokens: maxTokens } : {}),
        },
        { signal: this._abort.signal }
      );
      for await (const chunk of stream) {
        if (chunk?.id) completionId = chunk.id;
        const choice = chunk?.choices?.[0];
        if (choice?.finish_reason) finishReason = choice.finish_reason;
        const d = choice?.delta || {};
        const reasoning = d.reasoning_content ?? d.reasoning ?? '';
        if (reasoning) pushThink(reasoning);
        if (d.content) pushText(d.content);
        if (reasoning || d.content) {
          chunks++;
          if (firstAt === null) firstAt = performance.now();
          const el = (performance.now() - firstAt) / 1000;
          if (el > 0) tps = chunks / el;
          if (performance.now() - lastEmitAt >= 128) emit();
        }
      }
      if (parser) { if (inThink) parser.push('</think>'); parser.finish(); }
      emit();
    } catch (err) {
      const aborted = this._userStopped || err?.name === 'AbortError' || this._abort?.signal?.aborted;
      if (!aborted) throw new Error(explain(err));
      console.info('[nearai] stopped');
      if (parser) parser.finish();
      emit();
    }

    // Signature check over the exact bytes. A stopped stream has no complete
    // body to verify.
    // Hold the client this request used: unload() may null this.client mid-run.
    let response = null;
    const aborted = this._userStopped || this._abort?.signal?.aborted;
    if (completionId && !aborted && client) {
      try {
        const v = await client.verifyResponse(completionId);
        response = { ok: true, kind: v.signatureKind, id: v.id };
      } catch (e) {
        response = { ok: false, kind: null, id: completionId, error: e?.failure?.code || String(e?.message || e) };
      }
    } else if (completionId) {
      response = { ok: false, kind: null, id: completionId, error: 'stopped before completion — nothing to verify' };
    }

    const verification = {
      provider: 'NEAR AI Cloud',
      tier: 'tee',
      e2ee: true,
      attestation: this.attestation,
      response,
    };
    console.info(`[nearai] done in ${((performance.now() - startedAt) / 1000).toFixed(1)}s, signature=${response?.ok ? response.kind : 'unverified'}`);
    return { text, finishReason, truncated: finishReason === 'length', stopped: this._userStopped, verification };
  }

  stop() {
    this._userStopped = true;
    this._abort?.abort();
  }

  async unload() {
    this._abort?.abort();
    this.client?.clearResponseCache?.();
    this.client = null;
    this.modelLoaded = false;
  }

  getStatus() {
    return {
      modelLoaded: !!this.modelLoaded,
      modelId: 'nearai',
      mode: 'nearai',
      backend: 'NEAR AI Cloud (TEE)',
      externalName: this.config?.model || null,
      attestation: this.attestation,
      nGpuLayers: 0,
      mtpStatus: 'n/a',
      supportsAudio: false,
    };
  }
}
