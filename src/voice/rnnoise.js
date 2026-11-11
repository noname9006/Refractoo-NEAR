// RNNoise denoising via @jitsi/rnnoise-wasm.
//
// RNNoise operates on 480-sample frames at 48kHz, expecting samples scaled to
// int16 magnitude (±32768) rather than normalized [-1,1]. Degrades gracefully:
// if the wasm fails to load, returns the input unchanged.

import { createRNNWasmModule } from '@jitsi/rnnoise-wasm';
import wasmUrl from '@jitsi/rnnoise-wasm/dist/rnnoise.wasm?url';

const FRAME = 480;
const SCALE = 0x8000;
let _modPromise = null;

function getModule() {
  if (!_modPromise) {
    _modPromise = createRNNWasmModule({ locateFile: () => wasmUrl });
  }
  return _modPromise;
}

// input48k: mono Float32 at 48kHz. Returns denoised Float32 of equal length.
export async function denoise48k(input48k) {
  let mod;
  try {
    mod = await getModule();
  } catch (err) {
    console.warn('[rnnoise] wasm load failed — skipping denoise:', err);
    return input48k;
  }
  if (typeof mod._rnnoise_create !== 'function') {
    console.warn('[rnnoise] unexpected module shape — skipping denoise');
    return input48k;
  }

  const ctx = mod._rnnoise_create(0);
  const ptr = mod._malloc(FRAME * 4);
  const base = ptr >> 2;
  const out = new Float32Array(input48k.length);
  const tmp = new Float32Array(FRAME);

  for (let off = 0; off + FRAME <= input48k.length; off += FRAME) {
    for (let i = 0; i < FRAME; i++) tmp[i] = input48k[off + i] * SCALE;
    // Re-read the heap view each frame in case the buffer was reallocated
    mod.HEAPF32.set(tmp, base);
    mod._rnnoise_process_frame(ctx, ptr, ptr);
    const heap = mod.HEAPF32;
    for (let i = 0; i < FRAME; i++) out[off + i] = heap[base + i] / SCALE;
  }

  // Copy any sub-frame remainder through unprocessed
  const rem = input48k.length % FRAME;
  if (rem) out.set(input48k.subarray(input48k.length - rem), input48k.length - rem);

  mod._free(ptr);
  mod._rnnoise_destroy(ctx);
  return out;
}
