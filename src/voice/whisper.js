// Whisper speech-to-text via transformers.js (ONNX Runtime Web).
// Tries WebGPU first, falls back to WASM. base.en is English-only and tiny
// (~75-150MB depending on dtype); cached after first download.

// transformers.js (+ onnxruntime) is large and only needed once voice is used,
// so it's dynamically imported here to keep it out of the initial bundle.

const MODEL_ID = 'onnx-community/whisper-base.en';
let _asrPromise = null;

async function initASR(onProgress) {
  const { pipeline, env } = await import('@huggingface/transformers');
  env.allowLocalModels = false; // fetch the model from the HF hub
  try {
    return await pipeline('automatic-speech-recognition', MODEL_ID, {
      device: 'webgpu',
      dtype: 'fp32',
      progress_callback: onProgress,
    });
  } catch (err) {
    console.warn('[whisper] WebGPU init failed, falling back to WASM:', err);
    return pipeline('automatic-speech-recognition', MODEL_ID, {
      device: 'wasm',
      dtype: 'q8',
      progress_callback: onProgress,
    });
  }
}

export function getASR(onProgress) {
  if (!_asrPromise) _asrPromise = initASR(onProgress);
  return _asrPromise;
}

// float16k: mono Float32 at 16kHz. Returns the transcribed text.
export async function transcribe(float16k, onProgress) {
  const asr = await getASR(onProgress);
  const out = await asr(float16k, { chunk_length_s: 30, stride_length_s: 5 });
  return (out?.text || '').trim();
}
