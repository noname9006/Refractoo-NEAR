// External inference backend: streams from an OpenAI-compatible Chat Completions
// API (self-hosted llama.cpp/Ollama/LM Studio/vLLM, or a commercial provider).
//
// Requests go through the local helper server's /api/llm proxy rather than
// straight to the endpoint. That avoids browser CORS (commercial APIs refuse
// cross-origin browser calls by design) and keeps the API key out of the page's
// network tab — the key travels as a request header the local proxy forwards.
//
// The public surface mirrors WllamaContext (initialize/analyze/stop/unload/
// warmup/getStatus) so the assistant UI and the InferenceRouter treat both
// backends identically.

const PROXY_URL = '/api/llm';

export class ExternalContext {
  constructor() {
    this.config = null; // { baseUrl, apiKey, model }
    this.modelLoaded = false;
    this._abort = null;
    this._userStopped = false;
  }

  // "Loading" an external model is just validating + storing config — there's no
  // download. We deliberately don't probe the endpoint here: a probe can false-
  // negative on servers that gate /models or differ in shape, and the first real
  // request surfaces any genuine error clearly anyway.
  async initialize(config, onStatus = () => {}) {
    const cfg = {
      baseUrl: String(config?.baseUrl || '').trim(),
      apiKey: String(config?.apiKey || '').trim(),
      model: String(config?.model || '').trim(),
    };
    if (!cfg.baseUrl) throw new Error('External API base URL is required.');
    if (!cfg.model) throw new Error('External model name is required.');
    this.config = cfg;
    this.modelLoaded = true;
    onStatus('Ready');
    return this.getStatus();
  }

  // No-op: there's no local VRAM/checkpoint to warm for a remote endpoint. Kept
  // so the router can call warmup() uniformly.
  async warmup() {}

  async analyze(messages, onStream, thinkParserFactory, { thinking = true } = {}) {
    if (!this.modelLoaded || !this.config) throw new Error('External model not configured');
    this._abort = new AbortController();
    this._userStopped = false;
    let text = '';
    let finishReason = null;
    const startedAt = performance.now();
    let firstTokenAt = null;
    console.info(`[external] Starting inference… (${this.config.model})`);

    const THROTTLE_MS = 128;
    let lastEmitAt = 0;
    let lastTps = null;
    const streamParser =
      thinking && typeof thinkParserFactory === 'function' ? thinkParserFactory() : null;
    const emit = () => {
      lastEmitAt = performance.now();
      const parsed = streamParser
        ? streamParser.snapshot()
        : { visible: text.trim(), think: '', isThinking: false, thinkPreview: [] };
      onStream(parsed.visible, parsed.think, parsed.isThinking, lastTps, parsed.thinkPreview);
    };

    const TPS_LOG_MS = 4000;
    let tokenCount = 0;
    let lastTpsLogAt = 0;
    let lastTpsLogTokens = 0;
    const logTps = (final = false) => {
      const now = performance.now();
      const dt = (now - lastTpsLogAt) / 1000;
      const inst = dt > 0 ? (tokenCount - lastTpsLogTokens) / dt : 0;
      lastTpsLogAt = now;
      lastTpsLogTokens = tokenCount;
      console.info(
        `[external] ${final ? 'final ' : ''}throughput: ${inst.toFixed(1)} tok/s — ${tokenCount} chunks | remote (${this.config.model})`
      );
    };

    try {
      const res = await fetch(PROXY_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-llm-base-url': this.config.baseUrl,
          'x-llm-api-key': this.config.apiKey,
        },
        body: JSON.stringify({
          model: this.config.model,
          messages,
          stream: true,
          temperature: 0.7,
          top_p: 0.8,
          max_tokens: 4096,
        }),
        signal: this._abort.signal,
      });
      if (!res.ok || !res.body) {
        const detail = await res.text().catch(() => '');
        throw new Error(
          `External API error ${res.status} ${res.statusText}${detail ? ` — ${detail.slice(0, 300)}` : ''}`
        );
      }

      // Parse the Server-Sent-Events stream: lines of `data: {json}` ending with
      // `data: [DONE]`. Buffer across reads since a chunk can split mid-line.
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() || '';
        for (const line of lines) {
          const t = line.trim();
          if (!t.startsWith('data:')) continue;
          const data = t.slice(5).trim();
          if (data === '[DONE]') { finishReason = finishReason || 'stop'; continue; }
          let json;
          try { json = JSON.parse(data); } catch { continue; }
          const choice = json.choices?.[0];
          if (choice?.finish_reason) finishReason = choice.finish_reason;
          const delta = choice?.delta?.content ?? choice?.text ?? '';
          if (!delta) continue;
          if (firstTokenAt === null) {
            firstTokenAt = performance.now();
            lastTpsLogAt = firstTokenAt;
            console.info(`[external] First token after ${((firstTokenAt - startedAt) / 1000).toFixed(1)}s`);
          }
          text += delta;
          if (streamParser) streamParser.push(delta);
          tokenCount++;
          const el = (performance.now() - firstTokenAt) / 1000;
          if (el > 0) lastTps = tokenCount / el;
          if (performance.now() - lastEmitAt >= THROTTLE_MS) emit();
          if (performance.now() - lastTpsLogAt >= TPS_LOG_MS) logTps();
        }
      }
      if (streamParser) streamParser.finish();
      emit();
      if (tokenCount > 0) logTps(true);
      console.info(`[external] Inference done in ${((performance.now() - startedAt) / 1000).toFixed(1)}s, ${text.length} chars, finish_reason=${finishReason || 'n/a'}`);
    } catch (err) {
      const isAbort =
        this._userStopped || err?.name === 'AbortError' || this._abort?.signal?.aborted;
      if (isAbort) {
        console.info('[external] Inference stopped');
        emit();
      } else {
        console.warn('[external] analyze failed:', err);
        throw err;
      }
    }

    const truncated = finishReason === 'length';
    return { text, finishReason, truncated, stopped: this._userStopped };
  }

  stop() {
    this._userStopped = true;
    this._abort?.abort();
  }

  async unload() {
    this._abort?.abort();
    this.modelLoaded = false;
  }

  getStatus() {
    return {
      modelLoaded: !!this.modelLoaded,
      modelId: 'external',
      mode: 'external',
      backend: 'External API',
      externalName: this.config?.model || null,
      nGpuLayers: 0,
      mtpStatus: 'n/a',
      supportsAudio: false,
    };
  }
}
