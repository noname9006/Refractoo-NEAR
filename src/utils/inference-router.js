// Single inference handle the whole app holds (App.jsx). Delegates to one of two
// interchangeable backends — the on-device wllama model or an external
// OpenAI-compatible API — chosen at load time from prefs. The active backend is
// switched by initialize() (local) vs initializeExternal() (external); every
// other call forwards to whichever is active, so the assistant UI never has to
// know which one is running.

import { WllamaContext } from './wllama-context.js';
import { ExternalContext } from './external-context.js';

export class InferenceRouter {
  constructor() {
    this.local = new WllamaContext();
    this.external = new ExternalContext();
    this.active = this.local;
  }

  // Load the on-device model (wllama). Mirrors WllamaContext.initialize.
  // loadOpts carries the physical-core thread count and any manual GPU-offload
  // layer count derived from prefs + host sysinfo (see useAppFlow).
  async initialize(model, onProgress, onStatus, loadOpts) {
    this.active = this.local;
    return this.local.initialize(model, onProgress, onStatus, loadOpts);
  }

  // "Load" the external endpoint: validate + store config (no download).
  async initializeExternal(config, onStatus) {
    this.active = this.external;
    return this.external.initialize(config, onStatus);
  }

  analyze(...args) {
    return this.active.analyze(...args);
  }

  warmup(...args) {
    return this.active.warmup?.(...args);
  }

  stop() {
    return this.active.stop?.();
  }

  async unload() {
    try {
      await this.active.unload?.();
    } finally {
      this.active = this.local; // fall back to local as the default
    }
  }

  // Multimodal audio transcription is an on-device-only capability.
  transcribe(...args) {
    return this.local.transcribe(...args);
  }

  getStatus() {
    return this.active.getStatus();
  }
}
