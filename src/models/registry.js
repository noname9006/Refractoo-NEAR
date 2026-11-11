// Model registry. Each entry describes a GGUF the app can load via wllama.
//
// wllama cannot load a single file >2GB (ArrayBuffer limit). Models above that
// must be pre-split with `llama-gguf-split --split-max-size 512M` and hosted
// (own HF repo or static CDN); `source.url` then points at the FIRST shard and
// wllama auto-loads the rest.
//
// `supportsMTP` means the GGUF ships MTP (multi-token prediction) draft heads.
// wllama does not currently expose self-drafting speculative decoding, so MTP
// models run as plain models until it does — see _probeMTPSupport in
// wllama-context. We already point the base model at the MTP GGUF so that the
// day wllama adds support, no re-host/re-split is needed. 

export const MODELS = [
 {
    id: 'Qwen3.5-4B-UD-Q6_K_XL',
    name: 'Qwen3.5-4B-UD-Q6_K_XL',
    role: '0',
    quant: 'UD-Q6_K_XL',
    sizeBytes: 4.1455e9,
    source: {
      type: 'url',
      url: 'https://57.128.253.193:8443/splits/unsloth/Qwen3.5-4B-UD-Q6_K_XL/Qwen3.5-4B-UD-Q6_K_XL-00001-of-00009.gguf',
  },
    nCtx: 32768,
    sampling: { temperature: 0.7, top_p: 0.8, top_k: 20, min_p: 0.0, presence_penalty: 1.5, repetition_penalty: 1.0 },
    reasoning: true,
    supportsMTP: false,
    needsSplit: true,
  },
    {
    id: 'Qwopus3.5-4B-v3-think',
    name: 'Qwopus3.5-4B-v3-think',
    role: '1',
    quant: 'Q6_K',
    sizeBytes: 3.46e9,
    source: {
      type: 'url',
      url: 'https://57.128.253.193:8443/splits/Jackrong/Qwen3.5-4B.Q6_K/Qwen3.5-4B.Q6_K-00001-of-00008.gguf',
  },
    nCtx: 32768,
    sampling: { temperature: 0.7, top_p: 0.8, top_k: 20, min_p: 0.0, presence_penalty: 1.5, repetition_penalty: 1.0 },
    reasoning: true,
    supportsMTP: false,
    needsSplit: true,
  },
    {
    id: 'Qwopus3.5-4B-v3-nothink',
    name: 'Qwopus3.5-4B-v3-nothink',
    role: '2',
    quant: 'Q6_K',
    sizeBytes: 3.46e9,
    source: {
      type: 'url',
      url: 'https://57.128.253.193:8443/splits/Jackrong/Qwen3.5-4B.Q6_K/Qwen3.5-4B.Q6_K-00001-of-00008.gguf',
    },
    nCtx: 32768,
    sampling: { temperature: 0.7, top_p: 0.8, top_k: 20, min_p: 0.0, presence_penalty: 1.5, repetition_penalty: 1.0 },
    reasoning: false,
    supportsMTP: false,
    needsSplit: true,
  },
  {
    id: 'gemma-4-e4b-audio',
    name: 'Gemma 4 E4B (multimodal · audio)',
    role: 'Voice (multimodal)',
    quant: 'Q4_K_M',
    sizeBytes: 4.0e9, // model + mmproj, approximate — verify when hosting
    // Audio-capable multimodal model for the MULTIMODAL voice engine and/or
    // as the analysis model (Scenario 1: "Gemma for everything"). Needs BOTH
    // the main GGUF (split) AND the audio mmproj projector. From
    // unsloth/gemma-4-E4B-it-GGUF (+ its mmproj). Host and point both URLs.
    source: {
      type: 'url',
      url: 'https://YOUR-CDN-OR-HF-REPO/gemma-4-E4B-it-Q4_K_M-00001-of-00009.gguf',
      mmprojUrl: 'https://YOUR-CDN-OR-HF-REPO/gemma-4-E4B-mmproj.gguf',
    },
    nCtx: 8192,
    sampling: { temperature: 0.7, top_p: 0.8, top_k: 20, min_p: 0.0, presence_penalty: 1.5, repetition_penalty: 1.0 },
    reasoning: false,
    supportsMTP: false,
    needsSplit: true,
    audioInput: true,
  },
  {
    id: 'qwen3-1.7b-lite',
    name: 'Qwen3-1.7B (lite, for testing)',
    role: 'Pipeline test',
    quant: 'Q4_K_M',
    sizeBytes: 1.11e9,
    // Under 2GB → loads directly from HuggingFace, no splitting needed. Lets
    // you verify the whole pipeline (CP1/CP2) before hosting shards for the
    // base/backup models.
    source: {
      type: 'url',
      url: 'https://huggingface.co/unsloth/Qwen3-1.7B-GGUF/resolve/main/Qwen3-1.7B-Q4_K_M.gguf',
    },
    nCtx: 8192,
    sampling: { temperature: 0.7, top_p: 0.8, top_k: 20, min_p: 0.0, presence_penalty: 1.5, repetition_penalty: 1.0 },
    reasoning: true,
    supportsMTP: false,
    needsSplit: false,
  },
];

// Future MTP swaps (enable once wllama supports self-drafting speculative
// decoding): unsloth/Qwen3.5-9B-MTP-GGUF (already the base source) and
// unsloth/Qwen3.5-4B-MTP-GGUF (swap into the backup entry).

// Shared sampling defaults, named the way llama.cpp's own CLI/server flags
// are (temperature, presence_penalty, repetition_penalty, ...) rather than
// wllama's internal SamplingParams names. resolveSampling() is the single
// place inference should read sampling from; wllama-context.js maps these
// names onto wllama's createChatCompletion fields at the call site. Any
// model's own `sampling` block overrides these per-field — so a model can set
// its own temperature AND its own penalties.
//
//   repetition_penalty – 1.0 = off; >1 discourages verbatim repetition (1.1 typical)
//   presence_penalty    – 0.0 = off; flat penalty once a token has appeared. Qwen3
//                     recommends 0–2 to curb runaway repetition; high values can
//                     cause language-mixing, so raise this cautiously.
//   penalty_freq    – 0.0 = off; scales with how OFTEN a token has appeared
//   penalty_last_n  – window of recent tokens the penalties look back over
//                     (-1 = whole context, 0 = disable)
export const DEFAULT_SAMPLING = {
  temperature: 0.7,
  top_p: 0.8,
  top_k: 20,
  min_p: 0.0,
  repetition_penalty: 1.0,
  presence_penalty: 1.5,
  penalty_freq: 0.0,
  penalty_last_n: 64,
};

// Effective sampling config for a model: defaults with the model's overrides on
// top. This is the single place inference should read sampling from.
export function resolveSampling(model) {
  return { ...DEFAULT_SAMPLING, ...(model?.sampling || {}) };
}

export function getModel(id) {
  return MODELS.find((m) => m.id === id);
}

// Resolved architecture for resource estimation. Sources in priority order:
//   1. loadedLayers — real block_count from wllama metadata after the model loads
//   2. probedArch   — values parsed from the GGUF header via a partial Range fetch
// Returns null when neither source is available yet (probe pending / failed).
export function getModelArch(model, loadedLayers, probedArch) {
  let a = null;
  if (probedArch?.nLayer != null) {
    a = {};
    if (probedArch.nLayer  != null) a.nLayer  = probedArch.nLayer;
    if (probedArch.nHeadKv != null) a.nHeadKv = probedArch.nHeadKv;
    if (probedArch.headDim != null) a.headDim = probedArch.headDim;
    if (probedArch.nEmbd   != null) a.nEmbd   = probedArch.nEmbd;
  }
  if (Number(loadedLayers) > 0) {
    a = a ?? {};
    a.nLayer = Number(loadedLayers);
  }
  return a; // null → layer count unknown; UI should show N/A
}

// Human-readable GGUF size, e.g. "1.11 GB". Surfaced in the model picker and the
// load/progress UI so a user sees the download (and disk) cost before committing.
export function formatSize(bytes) {
  if (!bytes) return '—';
  return `${(bytes / 1e9).toFixed(2)} GB`;
}

// True when the model's GGUF is actually downloadable. The big base/backup
// models ship with placeholder URLs until you split + host their shards (see
// the header note); the loader skips un-hosted models so it doesn't waste a
// failed attempt on a URL that can't resolve.
export function isModelHosted(model) {
  return !!model && !/YOUR-CDN-OR-HF-REPO/.test(model?.source?.url || '');
}