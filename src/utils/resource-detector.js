// Recommends a model tier from device signals. WebGPU does NOT expose VRAM, so
// this is a heuristic over navigator.deviceMemory (approx RAM, often capped at
// 8), hardwareConcurrency (logical cores), and the WebGPU adapter. The loader
// auto-degrades on failure, so an optimistic pick is safe.

import { detectGPU } from './gpu-detector.js';
import { MODELS, isModelHosted } from '../models/registry.js';

// Ordered strongest → weakest, derived from the registry (largest sizeBytes
// first) rather than a hand-maintained id list — a hardcoded list silently
// drifts out of sync whenever registry.js is restructured (it did: the old
// tiers 'qwen3.5-9b-mtp'/'qwen3.5-4b' no longer exist). Un-hosted models
// (placeholder URLs) are excluded; they can't be loaded anyway.
export function getTierOrder() {
  return MODELS
    .filter(isModelHosted)
    .slice()
    .sort((a, b) => b.sizeBytes - a.sizeBytes)
    .map((m) => m.id);
}

export async function recommendModel() {
  const gpu = await detectGPU();
  const ram = navigator.deviceMemory || 4; // GiB (approx, may be capped)
  const cores = navigator.hardwareConcurrency || 4;
  const tiers = getTierOrder();
  const strongest = tiers[0];
  const lite = tiers[tiers.length - 1]; // smallest hosted model — CPU fallback
  const middle = tiers[Math.floor((tiers.length - 1) / 2)] ?? strongest;

  let modelId;
  let reason;

  if (!gpu.hasWebGPU || gpu.isFallbackAdapter) {
    modelId = lite;
    reason = gpu.hasWebGPU
      ? 'No hardware GPU detected — using the lightweight model on CPU.'
      : 'WebGPU unavailable — using the lightweight model on CPU.';
  } else if (ram >= 8 && cores >= 8) {
    modelId = strongest;
    reason = 'Capable GPU and ample memory — using the full base model.';
  } else {
    modelId = middle;
    reason = 'GPU available with moderate memory — using the balanced model.';
  }

  return { modelId, reason, gpu, ram, cores };
}

// Returns the tiers to try starting at `startId`, in descending size order.
// If `startId` is a model that isn't one of the standard tiers (e.g. a custom
// base model chosen via the override), try it FIRST and then fall through the
// whole tier ladder as backups — otherwise an override outside the tier order
// was silently dropped and the loader skipped straight to the tier list.
export function degradeChain(startId) {
  const tiers = getTierOrder();
  const idx = tiers.indexOf(startId);
  if (idx !== -1) return tiers.slice(idx);
  return startId ? [startId, ...tiers] : tiers;
}
