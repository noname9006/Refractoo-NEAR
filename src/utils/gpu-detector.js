// WebGPU capability detection.
//
// WebGPU deliberately does NOT expose VRAM size. adapter.limits.maxBufferSize
// is a per-buffer binding cap, not memory size — never derive n_gpu_layers
// from it. Instead we report weak hints (vendor/architecture/fallback flag)
// and the loader uses a try-full-offload → halve-on-failure strategy.

// wllama's default WASM is built with JSPI + MEMORY64. When the browser lacks
// either, running that build is unsafe: MEMORY64 absence in particular surfaces
// as a hard "operation does not support unaligned accesses" trap the moment the
// WASM touches WebGPU at startup. These mirror wllama's own internal checks
// (utils.ts: isSupportJSPI / isSupportMem64) so we can decide up front whether
// the default build is viable or we must fall back to the compat (Asyncify,
// no-MEMORY64, no-WebGPU) build.
export function hasJSPI() {
  return typeof WebAssembly !== 'undefined' && !!WebAssembly.Suspending;
}

export function hasMemory64() {
  try {
    // 1 page (64 KiB). Throws on engines without the memory64 proposal.
    new WebAssembly.Memory({ address: 'i64', initial: 1n });
    return true;
  } catch {
    return false;
  }
}

// True when wllama would need its compat build (matches utils.ts needCompat()).
export function needsCompat() {
  return !hasJSPI() || !hasMemory64();
}

export async function detectGPU() {
  const result = {
    hasWebGPU: false,
    vendor: null,
    architecture: null,
    isFallbackAdapter: false,
    crossOriginIsolated: globalThis.crossOriginIsolated === true,
    hasSharedArrayBuffer: typeof SharedArrayBuffer !== 'undefined',
    hasJSPI: hasJSPI(),
    hasMemory64: hasMemory64(),
    needsCompat: needsCompat(),
  };

  if (!('gpu' in navigator)) return result;

  try {
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) return result;

    result.hasWebGPU = true;
    // adapter.info is the current spec; requestAdapterInfo() the older one.
    const info =
      adapter.info ??
      (adapter.requestAdapterInfo ? await adapter.requestAdapterInfo() : {});
    result.vendor = info.vendor || null;
    result.architecture = info.architecture || null;
    result.isFallbackAdapter =
      info.isFallbackAdapter ?? adapter.isFallbackAdapter ?? false;
  } catch (err) {
    console.warn('[gpu-detector] WebGPU probe failed:', err);
  }

  return result;
}

// Initial n_gpu_layers attempt. The loader halves this on allocation failure
// until the model fits, ending at 0 (pure CPU).
export function initialGpuLayers(gpuInfo) {
  if (!gpuInfo.hasWebGPU) return 0;
  if (gpuInfo.isFallbackAdapter) return 0; // software renderer — not worth it
  // The compat WASM (used when JSPI/MEMORY64 are missing) has no WebGPU backend
  // at all, so offloading layers there is meaningless and the default build
  // would trap. Stay on CPU in that case.
  if (gpuInfo.needsCompat) return 0;
  if (isGpuKnownBroken(gpuInfo)) return 0; // this adapter already failed to compute before
  return 99; // "all layers"; wllama clamps to the model's actual layer count
}

// v2: v1 over-blocklisted — a single transient inference-time queue-wait
// timeout used to persist here and permanently force CPU on GPUs that actually
// run the model fine. v2 is written ONLY for genuine load-time shader-compile
// failures; bumping the key also discards any stale v1 entries so a wrongly
// blocklisted GPU is retried.
const BROKEN_GPU_KEY = 'wllama_gpu_broken_v2';

// A given GPU+browser+driver combo either can or can't COMPILE wllama's compute
// shaders — that's fixed. If a load fails with a shader-compile error, remember
// the adapter signature so later sessions skip straight to CPU instead of
// repeating the same doomed GPU attempts. (Compute *timeouts* are transient and
// are deliberately NOT recorded here.)
function gpuSignature(gpuInfo) {
  return `${gpuInfo.vendor || '?'}:${gpuInfo.architecture || '?'}`;
}

export function isGpuKnownBroken(gpuInfo) {
  try {
    const list = JSON.parse(localStorage.getItem(BROKEN_GPU_KEY) || '[]');
    return list.includes(gpuSignature(gpuInfo));
  } catch {
    return false;
  }
}

export function markGpuBroken(gpuInfo) {
  try {
    const sig = gpuSignature(gpuInfo);
    const list = JSON.parse(localStorage.getItem(BROKEN_GPU_KEY) || '[]');
    if (!list.includes(sig)) localStorage.setItem(BROKEN_GPU_KEY, JSON.stringify([...list, sig]));
  } catch {
    /* localStorage unavailable (e.g. private mode) — just retry next time */
  }
}
