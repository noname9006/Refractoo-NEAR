// Local-inference resource planner. Two jobs:
//   1. Pick how many CPU threads llama.cpp should use (physical cores only).
//   2. Estimate the RAM / VRAM a given GPU/CPU layer split needs at the model's
//      max context, and the rough speed cost of offloading fewer layers to GPU.
//
// Everything is a best-effort estimate. The browser hides true VRAM, and we
// can't read a GGUF's full architecture without loading it, so the numbers are
// derived from the model's on-disk size plus per-model architecture hints
// (registry `arch`), refined with the real block_count once a model is loaded.
// They're meant to be in the right ballpark for sizing a manual offload, not
// exact allocator figures — label them as estimates in the UI.

import { getModelArch } from '../models/registry.js';

// ── Thread count ───────────────────────────────────────────────────────────────
// llama.cpp threads = logical threads − 2, leaving two for the UI/main thread
// and OS background work so the browser stays responsive during CPU inference.
// (We experimented with physical-core-only sizing but reverted to this simpler
// logical-thread rule.)
//
// logicalCores comes from the local helper server (/api/sysinfo, os.cpus()) or
// navigator.hardwareConcurrency — both report logical threads. physicalCores is
// only a fallback (assume 2-way SMT) if a logical count somehow isn't available.
export function optimalThreads({ physicalCores, logicalCores } = {}) {
  let logical = Number(logicalCores) || 0;
  if (!logical && physicalCores) logical = Number(physicalCores) * 2; // assume 2-way SMT
  if (!logical) logical = 4; // last-resort default
  return Math.max(1, logical - 2);
}

// ── Memory model ───────────────────────────────────────────────────────────────
const KV_BYTES_PER_ELEM = 2;       // fp16 KV cache (llama.cpp default)
const RAM_BASE_OVERHEAD = 0.5e9;   // WASM runtime + context scratch on the CPU side
const GPU_COMPUTE_BUFFER = 0.35e9; // graph compute buffer kept in VRAM when offloading

// KV-cache bytes across ALL transformer layers at `nCtx` tokens.
//   per token, per layer: K + V = 2 × (n_head_kv × head_dim) × bytes
function kvTotalBytes(arch, nCtx) {
  const nEmbdKv = (arch.nHeadKv || 0) * (arch.headDim || 0);
  return nCtx * arch.nLayer * 2 * nEmbdKv * KV_BYTES_PER_ELEM;
}

// Number of offload "slots" for a model: one per transformer block plus a final
// slot lumping the output projection + token embeddings (this is the +1 that
// `n_gpu_layers = nLayer + 1` offloads — matching llama.cpp's "offload
// everything" behaviour and the layer accounting elsewhere in wllama-context).
// Returns null when arch is unknown.
export function offloadSlots(arch) {
  if (!arch?.nLayer) return null;
  return arch.nLayer + 1;
}

// Estimate RAM + VRAM for putting `gpuLayers` of the model on the GPU at `nCtx`
// context. Weights split per-slot; the KV cache for a layer lives on the same
// device as that layer (the output slot carries no KV). Returns a breakdown so
// the UI can show the dominant components.
export function planOffload({ model, arch, gpuLayers, nCtx }) {
  const slots = offloadSlots(arch);
  const L = arch.nLayer || 1;
  const g = Math.max(0, Math.min(Math.round(gpuLayers), slots));

  const perSlotWeight = (model?.sizeBytes || 0) / slots;
  const weightVram = g * perSlotWeight;
  const weightRam = (slots - g) * perSlotWeight;

  const kvTotal = kvTotalBytes(arch, nCtx);
  const gpuTxLayers = Math.min(g, L); // the output slot has no KV cache
  const kvVram = L > 0 ? (gpuTxLayers / L) * kvTotal : 0;
  const kvRam = kvTotal - kvVram;

  const onGpu = g > 0;
  const vram = weightVram + kvVram + (onGpu ? GPU_COMPUTE_BUFFER : 0);
  const ram = weightRam + kvRam + RAM_BASE_OVERHEAD;

  return { slots, gpuLayers: g, vram, ram, weightVram, weightRam, kvVram, kvRam, kvTotal };
}

// ── Speed model ────────────────────────────────────────────────────────────────
// Generation reads every layer's weights once per token. A layer left on the CPU
// is read at system-RAM bandwidth instead of VRAM bandwidth — on consumer
// hardware a CPU layer takes very roughly this many times longer than a GPU one.
// It's a deliberately simple, clearly-labelled "assumed" constant; real ratios
// vary with the specific CPU/GPU, but this captures the shape (each layer pulled
// off the GPU costs a predictable slice of throughput).
const CPU_LAYER_RATIO = 7;

// Relative speed of `gpuLayers`-on-GPU vs ALL-on-GPU (1.0 = full GPU speed).
// time/token ∝ frac_on_gpu·1 + frac_on_cpu·CPU_LAYER_RATIO, normalised so full
// offload = 1. Returns the speed fraction plus friendly "× slower" / "% slower".
export function estimateSpeed(gpuLayers, slots) {
  const g = Math.max(0, Math.min(Math.round(gpuLayers), slots));
  const frac = slots > 0 ? g / slots : 0;
  const rel = frac + (1 - frac) * CPU_LAYER_RATIO; // ≥ 1 (time multiplier)
  const speed = 1 / rel;
  return {
    speed,                                    // fraction of full-GPU throughput
    slowerX: rel,                             // e.g. 2.4 → "2.4× slower"
    slowerPct: Math.round((1 - speed) * 100), // e.g. 58 → "~58% slower"
  };
}

// Convenience: full plan (memory + speed + arch) for a model at a layer split.
// Returns null when arch is still unknown (probe pending / failed / not loaded).
export function describeOffload({ model, gpuLayers, loadedLayers, probedArch } = {}) {
  if (!model) return null;
  const arch = getModelArch(model, loadedLayers, probedArch);
  if (!arch) return null;
  const slots = offloadSlots(arch);
  const g = gpuLayers == null ? slots : Math.max(0, Math.min(Math.round(gpuLayers), slots));
  const mem = planOffload({ model, arch, gpuLayers: g, nCtx: model.nCtx || 8192 });
  const speed = estimateSpeed(g, slots);
  return { arch, slots, gpuLayers: g, nCtx: model.nCtx || 8192, ...mem, speed };
}
