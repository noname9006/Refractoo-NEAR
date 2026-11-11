// Microphone capture + audio DSP helpers shared by both voice engines.
//
// Browser noise suppression is tuned for telephony and measurably degrades
// ASR accuracy, so we disable it here and (optionally) run RNNoise instead.

export async function startRecording() {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      noiseSuppression: false, // per design — RNNoise handles denoise instead
      echoCancellation: false,
      autoGainControl: false,
      channelCount: 1,
    },
  });
  const rec = new MediaRecorder(stream);
  const chunks = [];
  rec.ondataavailable = (e) => e.data.size > 0 && chunks.push(e.data);
  const stopped = new Promise((res) => (rec.onstop = res));
  rec.start();

  return {
    stop: async () => {
      rec.stop();
      await stopped;
      stream.getTracks().forEach((t) => t.stop());
      return new Blob(chunks, { type: rec.mimeType || 'audio/webm' });
    },
  };
}

// Decodes a recorded blob to mono Float32 at `targetRate`.
export async function blobToFloat32(blob, targetRate) {
  const arrayBuf = await blob.arrayBuffer();
  const Ctx = window.AudioContext || window.webkitAudioContext;
  const ctx = new Ctx();
  try {
    const audioBuf = await ctx.decodeAudioData(arrayBuf);
    return resample(audioBuf.getChannelData(0), audioBuf.sampleRate, targetRate);
  } finally {
    ctx.close();
  }
}

// Linear-interpolation resampler. Fine for speech-band ASR pre-processing.
export function resample(input, inRate, outRate) {
  if (inRate === outRate) return Float32Array.from(input);
  const ratio = inRate / outRate;
  const outLen = Math.floor(input.length / ratio);
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const idx = i * ratio;
    const i0 = Math.floor(idx);
    const frac = idx - i0;
    out[i] = (input[i0] || 0) * (1 - frac) + (input[i0 + 1] || 0) * frac;
  }
  return out;
}

// 16-bit PCM mono WAV — the container wllama's audio input path expects.
export function encodeWav(float32, sampleRate) {
  const buffer = new ArrayBuffer(44 + float32.length * 2);
  const view = new DataView(buffer);
  const writeStr = (off, s) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  };
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + float32.length * 2, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, float32.length * 2, true);
  let off = 44;
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    off += 2;
  }
  return buffer;
}
