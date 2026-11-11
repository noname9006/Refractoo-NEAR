// Voice-input orchestrator. Two interchangeable engines behind one flow:
//   - WHISPER:   transformers.js Whisper STT (works with any analysis model)
//   - MULTIMODAL: send audio to a loaded wllama audio model (e.g. Gemma 4)
// Both share the same capture → RNNoise → resample front-end.

import { startRecording, blobToFloat32, resample, encodeWav } from './capture.js';
import { denoise48k } from './rnnoise.js';
import { transcribe as whisperTranscribe, getASR } from './whisper.js';

export const VOICE_ENGINES = {
  WHISPER: 'whisper',
  MULTIMODAL: 'multimodal',
};

export { startRecording, getASR };

async function preprocess(blob, useRnnoise) {
  const f48 = await blobToFloat32(blob, 48000);
  const denoised = useRnnoise ? await denoise48k(f48) : f48;
  return resample(denoised, 48000, 16000); // 16k mono for both engines
}

// Scenario 2: dedicated Whisper STT.
export async function transcribeWhisper(blob, { useRnnoise = true } = {}, onProgress) {
  const f16 = await preprocess(blob, useRnnoise);
  return whisperTranscribe(f16, onProgress);
}

// Scenario 1: multimodal model transcribes via wllama's audio path.
export async function transcribeMultimodal(blob, wllamaCtx, { useRnnoise = true } = {}) {
  const f16 = await preprocess(blob, useRnnoise);
  const wav = encodeWav(f16, 16000);
  return wllamaCtx.transcribe(wav);
}
