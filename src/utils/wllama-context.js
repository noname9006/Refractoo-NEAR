import { Wllama } from '@wllama/wllama';
import wasmUrl from '@wllama/wllama/esm/wasm/wllama.wasm?url';
// Compat build: Asyncify instead of JSPI, no MEMORY64, no WebGPU. Used as a
// fallback on browsers that lack JSPI or MEMORY64 (otherwise the default build
// traps with "operation does not support unaligned accesses" at startup). The
// worker JS must be imported as ?raw (inlined), not ?url — see the
// @wllama/wllama-compat README. Assets are local; the CDN copies 404 for some
// versions.
import compatWasmUrl from '@wllama/wllama-compat/wasm/wllama.wasm?url';
import compatWorkerCode from '@wllama/wllama-compat/wasm/wllama.js?raw';
import { detectGPU, initialGpuLayers, markGpuBroken, needsCompat } from './gpu-detector.js';
import { resolveSampling } from '../models/registry.js';
import { describeResources } from './resource-monitor.js';
import { optimalThreads } from './offload-planner.js';

// wllama v3.1+ ships a single unified WASM build (single/multi-thread and
// WebGPU are toggled at runtime).
const CONFIG_PATHS = { default: wasmUrl };
const COMPAT_CONFIG = { wasm: compatWasmUrl, worker: { code: compatWorkerCode } };

// A WASM trap inside wllama's worker (e.g. "operation does not support
// unaligned accesses") surfaces as an *uncaught* promise rejection on the
// window and never settles the call we're awaiting — so the UI hangs silently.
// Run `op` while watching for such a rejection and reject our promise with it,
// so callers' try/catch can report a real error instead of hanging forever.
function withWorkerCrashGuard(op) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const onReject = (ev) => {
      const reason = ev.reason;
      const msg = String(reason?.message || reason || '');
      // Only intercept WASM-level traps; let unrelated rejections bubble.
      if (reason instanceof WebAssembly.RuntimeError || /wasm|unaligned|wllama/i.test(msg)) {
        ev.preventDefault();
        if (settled) return;
        settled = true;
        cleanup();
        reject(reason instanceof Error ? reason : new Error(msg || 'wllama worker crashed'));
      }
    };
    const cleanup = () => globalThis.removeEventListener?.('unhandledrejection', onReject);
    globalThis.addEventListener?.('unhandledrejection', onReject);
    Promise.resolve()
      .then(op)
      .then(
        (v) => { if (!settled) { settled = true; cleanup(); resolve(v); } },
        (e) => { if (!settled) { settled = true; cleanup(); reject(e); } }
      );
  });
}

// The wasm trap that aborts a failed load (caught as a generic "(ABORT)"
// RuntimeError by withWorkerCrashGuard) carries no detail about *why* —
// the actual cause (e.g. Dawn rejecting WGSL subgroup builtins this
// adapter doesn't support) is only visible in separate console.error
// lines the worker forwards to the main thread. Temporarily wrap
// console.error while `op` runs so we can tell a shader-compile failure
// (fatal at any nonzero n_gpu_layers) from a true OOM (worth halving for).
//
// We also watch for *fatal load errors*: when the model's buffers can't be
// allocated (e.g. a ~6GB CPU buffer on a memory-starved tab), llama.cpp logs
// "failed to load model" / "unable to allocate" and bails — but
// loadModelFromUrl's promise still RESOLVES, so we'd wrongly report the model
// "ready". The next inference then traps on a null chat_templates. Catch the
// failure here and throw, so the load is treated as failed (ladder continues,
// or a clear error surfaces) instead of a cryptic mid-inference abort later.
const FATAL_LOAD_RE =
  /error loading model|failed to load model|unable to allocate|insufficient memory|alloc_tensor_range|failed to allocate (?:CPU |compute )?buffer|load_model: failed/i;

function logPerf(label, durationMs, data = {}) {
  if (!Number.isFinite(durationMs) || durationMs < 12) return;
  console.info(`[perf] ${label}: ${durationMs.toFixed(1)}ms`, data);
}

async function runDetectingShaderError(op) {
  const original = console.error;
  let sawShaderError = false;
  let fatalLoadMsg = null;
  console.error = (...args) => {
    const joined = args.join(' ');
    if (/WGSL|ShaderModule|ComputePipeline|CreateBindGroup/i.test(joined)) {
      sawShaderError = true;
    }
    if (!fatalLoadMsg && FATAL_LOAD_RE.test(joined)) fatalLoadMsg = joined;
    original.apply(console, args);
  };
  try {
    const result = await op();
    // op resolved, but the worker logged a fatal allocation/load failure —
    // the "loaded" model is unusable. Surface it as a real error.
    if (fatalLoadMsg) {
      const err = new Error(`Model failed to load: ${fatalLoadMsg.trim()}`);
      err.isFatalLoadError = true;
      throw err;
    }
    return result;
  } catch (err) {
    if (sawShaderError && err instanceof Error) err.isShaderCompileError = true;
    if (fatalLoadMsg && err instanceof Error && !err.isFatalLoadError) {
      err.isFatalLoadError = true;
    }
    throw err;
  } finally {
    console.error = original;
  }
}

export class WllamaContext {
  constructor() {
    this.wllama = null;
    this.model = null;
    this.gpuInfo = null;
    this.modelLoaded = false;
    this.actualGpuLayers = 0;
    this.modelLayers = null;       // real layer count from GGUF metadata (block_count)
    this.nThreads = null;          // physical-core thread count used for this load
    this.mtpStatus = 'unavailable';
    this.supportsAudio = false;
    this._abort = null;
    this._userStopped = false;
  }

  // Loads `model` (a registry entry). Strategy: try full GPU offload, halve
  // n_gpu_layers on failure, end at 0 (CPU). Reports the layer count that
  // actually succeeded — WebGPU gives us no way to know VRAM up front.
  //
  // loadOpts:
  //   nThreads  – CPU threads for llama.cpp (logical threads − 2; computed by the
  //               caller from host sysinfo). Falls back to a local estimate.
  //   gpuLayers – starting n_gpu_layers for MANUAL offload. When set, we begin the
  //               ladder at the user's chosen count instead of "all" (99), but
  //               still degrade on allocation failure so the load can't get stuck.
  async initialize(model, onProgress, onStatus = () => {}, loadOpts = {}) {
    console.info(`[wllama] Starting load: ${model.id} (${model.quant}, ~${(model.sizeBytes / 1e9).toFixed(2)}GB)`);
    const startedAt = performance.now();
    this.gpuInfo = await detectGPU();
    console.info('[wllama] GPU detection:', this.gpuInfo);
    this.model = model;
    // Thread count (logical threads − 2): prefer the caller's value (from
    // /api/sysinfo), else estimate from navigator. Reused across every attempt.
    this.nThreads = loadOpts.nThreads || optimalThreads({ logicalCores: navigator.hardwareConcurrency });

    // The environment ceiling on GPU offload: 0 when there's no usable WebGPU
    // (software adapter, compat build, blocklisted GPU), else "all" (99).
    const envMaxGpu = initialGpuLayers(this.gpuInfo);
    // Manual offload starts at the user's chosen layer count, but never above
    // what the environment can actually do (forced to CPU when there's no GPU).
    let nGpuLayers = loadOpts.gpuLayers != null
      ? Math.min(Math.max(0, Math.round(loadOpts.gpuLayers)), envMaxGpu)
      : envMaxGpu;
    console.info(`[wllama] threads=${this.nThreads}, starting n_gpu_layers=${nGpuLayers}` +
      (loadOpts.gpuLayers != null ? ` (manual offload; env max ${envMaxGpu})` : ''));
    let lastError = null;
    let gpuAttempts = 0;

    // CPU short-circuit. When we're forced onto CPU (no usable GPU, or this
    // adapter was already blocklisted after a compute hang) a multi-GB model
    // can't get a contiguous WASM buffer — it OOMs after a long download for
    // nothing. Bail before downloading so the caller's degrade ladder drops
    // straight to a CPU-viable (smaller) model. ~4.2GB is a safe ceiling for
    // browser WASM heaps in practice. GPU loads are unaffected.
    const CPU_MAX_BYTES = 4.2e9;
    if (nGpuLayers === 0 && (model.sizeBytes || 0) > CPU_MAX_BYTES) {
      onStatus('Ready'); // clear any transient status before bubbling up
      throw new Error(
        `${model.name} (~${(model.sizeBytes / 1e9).toFixed(1)} GB) is too large to run on CPU in the browser, ` +
          'and no working GPU is available on this device. Falling back to a smaller model.'
      );
    }

    while (true) {
      // Keep the user-facing message stable: don't surface the internal
      // n_gpu_layers fallback ladder (99 → … → 0), which reads like the GPU
      // is being "switched off" as it retries. Just say what backend we're on.
      onStatus(nGpuLayers > 0 ? 'Loading with GPU acceleration…' : 'Loading on CPU…');
      console.info(`[wllama] Attempting load at n_gpu_layers=${nGpuLayers}`);
      try {
        await runDetectingShaderError(() => this._loadOnce(model, nGpuLayers, onProgress, loadOpts.nCtx));
        this.actualGpuLayers = nGpuLayers;
        this.modelLoaded = true;
        this.mtpStatus = this._probeMTPSupport(model);
        this.supportsAudio = this.wllama.supportInputModality?.('audio') ?? false;
        // Real layer count from the GGUF (block_count), not the n_gpu_layers we
        // *requested* — 99 just means "offload everything", so the effective
        // offload is min(requested, modelLayers + 1) including the output layer.
        try {
          this.modelLayers = this.wllama.getModelMetadata?.()?.hparams?.nLayer ?? null;
        } catch {
          this.modelLayers = null;
        }
        const secs = ((performance.now() - startedAt) / 1000).toFixed(1);
        const offload = this.modelLayers != null
          ? `${Math.min(this.actualGpuLayers, this.modelLayers + 1)}/${this.modelLayers + 1} layers on GPU`
          : `n_gpu_layers=${this.actualGpuLayers}`;
        console.info(
          `[wllama] Model ready in ${secs}s — backend=${this.actualGpuLayers > 0 ? 'WebGPU' : 'CPU'}, ${offload}`
        );
        onStatus('Ready');
        return this.getStatus();
      } catch (err) {
        lastError = err;
        console.warn(`[wllama] load failed at n_gpu_layers=${nGpuLayers}:`, err);
        await this._teardown();
        if (nGpuLayers === 0) break; // CPU also failed — give up
        gpuAttempts++;
        // A WGSL/shader-compile failure (e.g. this GPU's WebGPU implementation
        // lacking subgroup builtins wllama's compute kernels rely on) is fatal
        // at any nonzero n_gpu_layers, not just the current one — halving would
        // just repeat the same failure. isShaderCompileError detection is
        // unreliable (the underlying console.error lines are logged inside the
        // worker's own realm, invisible to our main-thread console patch), so
        // also hard-cap at 2 GPU attempts: a real OOM would usually succeed on
        // the first halving, while a shader/driver incompatibility fails at
        // every layer count and was previously burning 8 retries (and a wall
        // of console spam) before ever reaching CPU.
        if (err.isShaderCompileError || gpuAttempts >= 2) {
          markGpuBroken(this.gpuInfo); // skip the GPU ladder entirely next time
          nGpuLayers = 0;
        } else {
          nGpuLayers = nGpuLayers > 8 ? Math.floor(nGpuLayers / 2) : 0;
        }
      }
    }
    throw new Error(`Model load failed (including CPU fallback): ${lastError?.message}`);
  }

  async _loadOnce(model, nGpuLayers, onProgress, nCtx) {
    this.wllama = new Wllama(CONFIG_PATHS);
    // Choose the WASM build by browser capability. The default build needs JSPI
    // *and* MEMORY64; on a browser missing either, it traps at startup
    // ("operation does not support unaligned accesses") while probing WebGPU.
    // When that's the case, point wllama at our locally-bundled compat assets
    // (it would otherwise fetch them from a CDN that 404s). When the browser is
    // fully capable, disable compat so we get the fast WebGPU build.
    if (needsCompat()) {
      console.warn(
        '[wllama] Browser lacks JSPI/MEMORY64 — using compat (CPU) WASM build. ' +
          'Enable chrome://flags #enable-experimental-webassembly-jspi and ' +
          '#enable-webassembly-memory64 for the faster WebGPU build.'
      );
      this.wllama.setCompat(COMPAT_CONFIG);
    } else {
      this.wllama.setCompat(null);
    }
    // Multimodal models pass the mmproj projector alongside the main GGUF
    const source = model.source.mmprojUrl
      ? { url: model.source.url, mmprojUrl: model.source.mmprojUrl }
      : model.source.url;
    // Log every 10% (not every callback — these fire constantly) so the
    // console shows download/cache progress without spamming.
    let lastLoggedPct = -1;
    await withWorkerCrashGuard(() =>
      this.wllama.loadModelFromUrl(source, {
        n_ctx: nCtx || model.nCtx,
        n_gpu_layers: nGpuLayers,
        // Bigger prompt-eval chunks (helps the CPU/WASM fallback path; harmless
        // on GPU). n_threads = logical threads − 2 (set in initialize), leaving
        // two for the UI/main thread so the GUI stays responsive on CPU.
        n_batch: 512,
        n_threads: this.nThreads || Math.max(1, (navigator.hardwareConcurrency || 4) - 2),
        // Keep <think> tags inline in content — the UI's think-parser splits
        // them; streamed chunk deltas don't carry a separate reasoning field.
        reasoning_format: 'none',
        progressCallback: ({ loaded, total }) => {
          const p = total > 0 ? loaded / total : 0;
          const pct = Math.floor(p * 100);
          if (pct >= lastLoggedPct + 10 || (pct === 100 && lastLoggedPct !== 100)) {
            lastLoggedPct = pct;
            console.info(`[wllama] Downloaded ${(loaded / 1e6).toFixed(0)}MB / ${(total / 1e6).toFixed(0)}MB (${pct}%)`);
          }
          onProgress(p);
        },
      })
    );
  }

  // wllama 3.5 exposes spec_draft_* load params (separate-draft-model
  // speculative decoding) but no spec-type switch for self-drafting MTP
  // heads yet. Flip this probe when LoadModelParams grows a spec_type field.
  _probeMTPSupport(model) {
    if (!model.supportsMTP) return 'n/a';
    return 'running as plain model (MTP pending wllama support)';
  }

  // Streams a chat completion. onStream(visibleText, thinkText, isThinking,
  // tokPerSec) receives output already split around <think> blocks; tokPerSec
  // comes from llama.cpp's own timings, not a UI-side guess.
  async analyze(messages, onStream, thinkParserFactory, { thinking = true } = {}) {
    if (!this.modelLoaded) throw new Error('Model not loaded');
    this._abort = new AbortController();
    this._userStopped = false; // distinguishes a user Stop from a real crash/abort
    let text = '';
    let finishReason = null;
    let needsReload = false;
    // First token can take a while (prompt eval on a long context, especially
    // on CPU) with no streamed output at all during that window — log it so
    // "stuck" vs "still evaluating the prompt" is visible in the console.
    const startedAt = performance.now();
    let firstTokenAt = null;
    console.info('[wllama] Starting inference…');

    // Throttle UI updates to ~15 Hz. Each emit re-parses <think> tags over the
    // whole accumulated text and re-renders the entire markdown subtree; doing
    // that per token lets a fast (WebGPU) stream post tokens faster than the
    // main thread can render, backing up the event loop until the UI freezes
    // (the elapsed-time interval included). Coalescing caps that work no matter
    // the token rate. lastTps carries llama.cpp's own tok/s between throttled
    // emits so the rate readout still reflects the latest chunk.
    const THROTTLE_MS = 128;
    let lastEmitAt = 0;
    let lastTps = null;
    const streamParser =
      thinking && typeof thinkParserFactory === 'function'
        ? thinkParserFactory()
        : null;
    const emit = () => {
      const emitStartedAt = performance.now();
      lastEmitAt = performance.now();
      // #region debug-point A:emit-cost
      const parseStartedAt = performance.now();
      const parsed = streamParser
        ? streamParser.snapshot()
        : { visible: text.trim(), think: '', isThinking: false, thinkPreview: [] };
      const parseMs = performance.now() - parseStartedAt;
      const streamStartedAt = performance.now();
      // #endregion
      onStream(parsed.visible, parsed.think, parsed.isThinking, lastTps, parsed.thinkPreview);
      // #region debug-point B:onstream-cost
      logPerf('wllama emit', performance.now() - emitStartedAt, {
        parseMs: Number(parseMs.toFixed(1)),
        onStreamMs: Number((performance.now() - streamStartedAt).toFixed(1)),
        chars: text.length,
      });
      // #endregion
    };

    // Throughput logging. `lastTps` is llama.cpp's own cumulative average
    // (predicted_per_second). We also derive an *instantaneous* rate from the
    // tokens seen since the previous log tick so the console shows both the
    // current speed and the running average without spamming a line per token.
    // Logged at half the previous rate (was 2000) to keep the console quieter;
    // each line now also carries RAM/VRAM + the GPU/CPU layer split.
    const TPS_LOG_MS = 4000;
    let tokenCount = 0;
    let lastTpsLogAt = 0;
    let lastTpsLogTokens = 0;
    const logTps = (final = false) => {
      const now = performance.now();
      const dt = (now - lastTpsLogAt) / 1000;
      const inst = dt > 0 ? (tokenCount - lastTpsLogTokens) / dt : 0;
      const avg =
        typeof lastTps === 'number'
          ? lastTps
          : firstTokenAt != null
            ? tokenCount / Math.max(0.001, (now - firstTokenAt) / 1000)
            : 0;
      lastTpsLogAt = now;
      lastTpsLogTokens = tokenCount;
      // GPU/CPU layer split. Show how many of the model's *actual* layers were
      // offloaded (modelLayers+1 includes the output layer) rather than the raw
      // requested n_gpu_layers (99 = "all"). 0 means the model ran CPU-only.
      const layers = this.actualGpuLayers > 0
        ? this.modelLayers != null
          ? `${Math.min(this.actualGpuLayers, this.modelLayers + 1)}/${this.modelLayers + 1} layers on GPU`
          : `${this.actualGpuLayers} GPU layers`
        : 'CPU-only';
      const res = describeResources(); // system-wide RAM/VRAM from the shared 15s snapshot
      console.info(
        `[wllama] ${final ? 'final ' : ''}throughput: ${inst.toFixed(1)} tok/s (current), ${avg.toFixed(1)} tok/s (avg) — ${tokenCount} tokens | ${layers}${res ? ` | ${res}` : ''}`
      );
    };

    // Stall watchdog: if the worker goes silent, abort so the UI can recover
    // instead of showing "Processing…" forever. Prompt eval before the first
    // token can legitimately take minutes on CPU, so give it a generous budget;
    // once tokens are flowing, a long inter-token gap means something wedged.
    const FIRST_TOKEN_TIMEOUT_MS = 180000;
    const STALL_TIMEOUT_MS = 30000;
    let watchdogTimer = null;
    let watchdogFired = false;
    const kickWatchdog = (ms) => {
      if (watchdogTimer) clearTimeout(watchdogTimer);
      watchdogTimer = setTimeout(() => {
        watchdogFired = true;
        console.warn(`[wllama] No output for ${(ms / 1000).toFixed(0)}s — aborting (stall watchdog)`);
        // #region debug-point D:stall-watchdog
        logPerf('wllama stall watchdog', ms, {
          tokenCount,
          chars: text.length,
          sawFirstToken: firstTokenAt !== null,
        });
        // #endregion
        this._abort?.abort();
      }, ms);
    };

    try {
      // Effective sampling = shared defaults + this model's overrides, named the
      // way llama.cpp's own flags are (temperature, presence_penalty,
      // repetition_penalty, ...). Map them onto wllama's createChatCompletion
      // field names (ChatCompletionParams extends SamplingParams) below.
      const s = resolveSampling(this.model);
      kickWatchdog(FIRST_TOKEN_TIMEOUT_MS);
      // Reasoning models spend a large, variable budget inside <think> before the
      // answer; a tight cap (was 2048) gets fully consumed by the trace, so the
      // closing </think> and the actual answer never stream. Give generation
      // most of the context window (leaving room for the prompt) so the model
      // can finish thinking AND answer. wllama/llama.cpp clamps to what fits.
      const ctxRoom = Math.max(2048, (this.model?.nCtx || 8192) - 4096);
      const maxTokens = Math.min(8192, ctxRoom);
      await withWorkerCrashGuard(() => this.wllama.createChatCompletion({
        messages,
        // Qwen3/Qwen3.5 chat templates gate the <think> trace on this kwarg.
        // The in-prompt /no_think switch isn't honored by all Qwen3.5 builds,
        // so drive it through the template directly. Harmless for non-Qwen
        // templates (they ignore unknown kwargs).
        chat_template_kwargs: { enable_thinking: thinking },
        max_tokens: maxTokens,
        temp: s.temperature,
        top_p: s.top_p,
        top_k: s.top_k,
        min_p: s.min_p,
        penalty_repeat: s.repetition_penalty,
        penalty_present: s.presence_penalty,
        penalty_freq: s.penalty_freq,
        penalty_last_n: s.penalty_last_n,
        stream: true,
        timings_per_token: true,
        abortSignal: this._abort.signal,
        onData: (chunk) => {
          const tps = chunk.timings?.predicted_per_second;
          if (typeof tps === 'number') lastTps = tps;
          const fr = chunk.choices?.[0]?.finish_reason;
          if (fr) finishReason = fr;
          const delta = chunk.choices?.[0]?.delta?.content;
          if (!delta) return; // skip role-only / timings-only chunks — nothing to render
          if (firstTokenAt === null) {
            firstTokenAt = performance.now();
            lastTpsLogAt = firstTokenAt;
            console.info(`[wllama] First token after ${((firstTokenAt - startedAt) / 1000).toFixed(1)}s (prompt eval)`);
          }
          text += delta;
          if (streamParser) streamParser.push(delta);
          tokenCount++;
          kickWatchdog(STALL_TIMEOUT_MS); // a token arrived — reset the inter-token timer
          if (performance.now() - lastEmitAt >= THROTTLE_MS) emit();
          if (performance.now() - lastTpsLogAt >= TPS_LOG_MS) logTps();
        },
      }));
      if (streamParser) streamParser.finish();
      emit(); // flush the trailing tokens the throttle may have withheld
      if (tokenCount > 0) logTps(true);
      console.info(`[wllama] Inference done in ${((performance.now() - startedAt) / 1000).toFixed(1)}s total, ${text.length} chars, finish_reason=${finishReason || 'n/a'}`);
    } catch (err) {
      const msg = String(err?.message || err || '');
      const isAbortError =
        this._userStopped ||
        err?.name === 'WllamaAbortError' ||
        err?.name === 'AbortError' ||
        this._abort?.signal?.aborted;

      // Order matters. A user-initiated Stop (or our own watchdog abort) can
      // surface as a WASM trap ("(ABORT)"/"unreachable"/RuntimeError) when it
      // interrupts a WebGPU compute — which looks identical to a genuine GPU
      // self-abort. So decide on intent FIRST: if WE aborted on purpose, it is
      // never a "broken GPU".
      if (this._userStopped) {
        console.info('[wllama] Inference stopped by user');
        emit(); // show whatever streamed before the stop
      } else if (watchdogFired) {
        // A watchdog abort surfaces as an abort error; turn it into a real
        // timeout the UI can report, rather than a silent "stopped by user".
        needsReload = true;
        const timeoutErr = new Error('The model stopped responding (timed out). The local AI was reset; send the prompt again to reload it.');
        timeoutErr.requiresReload = true;
        throw timeoutErr;
      } else if (
        this.actualGpuLayers > 0 &&
        (/ABORT|unreachable|webgpu|Queue wait timed out/i.test(msg) ||
          err instanceof WebAssembly.RuntimeError)
      ) {
        // A WebGPU compute abort during inference: ggml's WebGPU backend
        // self-aborts a graph compute after its hardcoded 30s *per-submit*
        // queue-wait timeout ("ggml_webgpu: Queue wait timed out" → "(ABORT)").
        // This is TRANSIENT, not a broken adapter — the same GPU runs this model
        // fine on other runs; a heavy first compute (large prompt eval) just
        // occasionally trips the 30s ceiling. So do NOT blocklist the GPU
        // (that would wrongly force CPU forever). The WASM instance is dead once
        // it traps, so the model must be reloaded — but the next load should try
        // the GPU again. Tell the user it's a retry, not a downgrade.
        console.warn('[wllama] WebGPU compute timed out during inference (transient 30s queue-wait limit) — not blocklisting the GPU.');
        needsReload = true;
        const gpuErr = new Error(
          'The GPU timed out on this request. The local AI was reset; send the prompt again to reload it. ' +
            'This is usually transient and your GPU will still be used.'
        );
        gpuErr.requiresReload = true;
        throw gpuErr;
      } else if (isAbortError) {
        // Aborted for some other reason but not a real crash — treat as a stop.
        console.info('[wllama] Inference aborted');
        emit();
      } else {
        throw err;
      }
    } finally {
      if (watchdogTimer) clearTimeout(watchdogTimer);
      if (needsReload) {
        // #region debug-point C:recover-after-stall
        const teardownStartedAt = performance.now();
        // #endregion
        await this._teardown();
        // #region debug-point D:recover-after-stall
        logPerf('wllama recover teardown', performance.now() - teardownStartedAt, {
          hadModel: this.model != null,
          tokenCount,
        });
        // #endregion
      }
    }
    // finish_reason === 'length' means generation hit max_tokens. For a
    // reasoning model that can mean the whole budget went to <think> and no
    // answer was emitted — the caller surfaces that to the user.
    const truncated = finishReason === 'length';
    return { text, finishReason, truncated, stopped: this._userStopped };
  }

  stop() {
    this._userStopped = true;
    this._abort?.abort();
  }

  // Re-prime the GPU after a (re)load. A throwaway 1-token generation that pages
  // the model weights back into VRAM, compiles the WebGPU compute pipelines, and
  // rebuilds llama.cpp's prefix checkpoint for the shared system prompt — so the
  // user's first real question restores from checkpoint (fast first token)
  // instead of a full prompt eval (slow). `messages` MUST always carry the
  // system prompt (see buildWarmupMessages); including the current FACTS makes
  // the cached prefix match the next real prompt. Non-fatal: a failed warmup
  // just means the first prompt runs cold, not that anything is broken.
  async warmup(messages) {
    if (!this.modelLoaded || !messages?.length) return;
    const startedAt = performance.now();
    console.info('[wllama] Warming up (priming VRAM + system-prompt checkpoint)…');
    try {
      await withWorkerCrashGuard(() => this.wllama.createChatCompletion({
        messages,
        // Thinking off for warmup: the system+FACTS prefix that gets checkpointed
        // is identical regardless, and we don't want the model to spend the warmup
        // generating a reasoning trace.
        chat_template_kwargs: { enable_thinking: false },
        max_tokens: 1,
        temp: 0,
        stream: false,
      }));
      console.info(`[wllama] Warmup done in ${((performance.now() - startedAt) / 1000).toFixed(1)}s`);
    } catch (err) {
      console.warn('[wllama] Warmup failed (non-fatal):', err);
    }
  }

  // Multimodal voice engine: feed recorded audio (WAV ArrayBuffer) to the
  // loaded audio-capable model and ask for a verbatim transcript.
  async transcribe(audioArrayBuffer) {
    if (!this.modelLoaded) throw new Error('Model not loaded');
    if (!this.supportsAudio) {
      throw new Error(
        'The loaded model has no audio input. Select a multimodal (Gemma-4 audio) model, or use the Whisper engine.'
      );
    }
    const res = await this.wllama.createChatCompletion({
      messages: [
        {
          role: 'user',
          content: [
            { type: 'audio', data: audioArrayBuffer },
            {
              type: 'text',
              text: 'Transcribe the spoken audio verbatim. Output only the transcription text, nothing else.',
            },
          ],
        },
      ],
      max_tokens: 256,
      temp: 0,
    });
    return (res?.choices?.[0]?.message?.content || '').trim();
  }

  async _teardown() {
    try {
      await this.wllama?.exit();
    } catch {
      /* instance may already be dead */
    }
    this.wllama = null;
    this.modelLoaded = false;
  }

  async unload() {
    await this._teardown();
    this.model = null;
    this.actualGpuLayers = 0;
    this.modelLayers = null;
    this.nThreads = null;
    this.mtpStatus = 'unavailable';
    this.supportsAudio = false;
  }

  getStatus() {
    return {
      modelLoaded: this.modelLoaded,
      modelId: this.model?.id ?? null,
      gpuInfo: this.gpuInfo,
      nGpuLayers: this.actualGpuLayers,
      modelLayers: this.modelLayers,
      nThreads: this.nThreads,
      backend: this.actualGpuLayers > 0 ? 'WebGPU' : 'CPU (WASM)',
      mtpStatus: this.mtpStatus,
      supportsAudio: this.supportsAudio,
    };
  }
}
