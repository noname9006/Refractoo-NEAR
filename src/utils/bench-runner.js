// /bench sweep engine. Builds the cartesian-product combination matrix and
// runs it sequentially against one shared WllamaContext, persisting each
// result as soon as it's ready. No React/UI here — Bench.jsx drives this via
// callbacks and owns all rendering state.
//
// Each combination is timed with wllama's RAW completion API (not the chat
// path used elsewhere in the app): fixed-length generation with
// `ignore_eos: true`, llama-bench style, so every run produces the same
// number of tokens and results are comparable across configs. `timings` on
// each streamed chunk (prompt_ms, prompt_per_second, predicted_n,
// predicted_ms, predicted_per_second) come straight from llama.cpp.

import { WllamaContext } from './wllama-context.js';
import { getModel } from '../models/registry.js';
import { offloadSlots } from './offload-planner.js';
import { addSweep, updateSweep, addRun, getAllRuns } from '../storage/benchStore.js';

// ~500 tokens of fixed, neutral filler text (llama-bench's default pp size is
// 512) so prompt-processing speed is comparable across every run in every
// sweep. Content is irrelevant — only timing is measured, generation output
// is discarded. The "short" and "long" workload presets below are a prefix
// of, and a multiple of, this same text — varying prefill length without
// needing separately-authored prose.
export const BENCH_PROMPT = `Distributed systems trade one set of guarantees for another. A single
machine offers a simple story: operations happen in some order, and that
order is visible to everyone at once. Add a second machine and that story
breaks down immediately, because two machines can each believe they are
right while disagreeing with each other, and there is no way to find out
who is correct without sending a message — and messages can be delayed,
duplicated, reordered, or lost. Most of the hard problems in distributed
computing trace back to this single fact: a network is not a wire, it is a
queue with unpredictable delay, sitting between two computers that each
have their own private, possibly-wrong idea of what is true right now.

Consensus protocols exist to paper over this gap. They let a group of
machines agree on a single sequence of decisions even when some of them
crash, restart, or are temporarily unreachable, as long as a majority stays
reachable for long enough to vote. The cost of that agreement is latency:
every decision needs at least one round trip to a quorum before it can be
considered durable, and that round trip is bounded by the slowest machine
in the quorum, not the fastest. Systems that need low latency more than
they need strict agreement often relax this requirement instead, accepting
that two replicas might briefly disagree and resolving the disagreement
later, after the fact, using timestamps, version vectors, or simple
last-write-wins rules.

Caching adds another layer of the same trade-off. A cache is a bet that the
near future will look like the recent past, and the bet pays off often
enough that almost every system at scale relies on it somewhere — in the
browser, at the edge, in front of the database, inside the database itself.
The hard part is never reading from the cache; it is knowing when an entry
has gone stale and deciding what to do about it, whether that means
evicting it immediately, serving it anyway while a refresh happens in the
background, or accepting a short window where some readers see old data and
others see new data. None of these choices is free, and the right one
depends entirely on what the data is used for downstream.

Storage engines face a related tension between write speed and read speed.
Appending to the end of a log is the fastest possible way to persist
something to disk, because it never requires seeking, but a log on its own
is useless for lookups — finding a single record means scanning everything
that came before it. Indexes fix that, at the cost of extra writes every
time the underlying data changes. Log-structured merge trees split the
difference by buffering writes in memory, flushing them to disk in sorted
batches, and merging those batches together later, trading some read
latency and background I/O for write throughput that stays roughly constant
no matter how much data has already been stored.`;

// Short, content-irrelevant prompt for the optional warmup pass (primes
// VRAM / compiles WebGPU pipelines before the timed iterations begin).
const WARMUP_PROMPT = 'The quick brown fox jumps over the lazy dog.';

// Workload (prompt-size) presets — a sweepable dimension alongside threads/
// context/GPU-layers/warmup, closer to llama-bench's pp512/pp4096 convention
// of testing prefill speed at different prompt lengths. "short" is just
// BENCH_PROMPT's first paragraph; "long" repeats the whole text 3x. Only the
// PROMPT changes between presets — `targetTokens` (generation length) is a
// separate, single setting, matching llama-bench's independent pp/tg axes.
const BENCH_PROMPT_SHORT = BENCH_PROMPT.split('\n\n')[0];
const BENCH_PROMPT_LONG = [BENCH_PROMPT, BENCH_PROMPT, BENCH_PROMPT].join('\n\n');

export const PROMPT_PRESETS = [
  { id: 'short', label: 'Short (~128 tok)', prompt: BENCH_PROMPT_SHORT },
  { id: 'medium', label: 'Medium (~512 tok)', prompt: BENCH_PROMPT },
  { id: 'long', label: 'Long (~1500 tok)', prompt: BENCH_PROMPT_LONG },
];

function resolvePrompt(presetId) {
  return PROMPT_PRESETS.find((p) => p.id === presetId)?.prompt || BENCH_PROMPT;
}

// Discrete value list from a stepped range, e.g. (2, 8, 2) -> [2, 4, 6, 8].
// Degenerates to [min] when max/step are missing or non-positive.
export function stepRange(min, max, step) {
  const lo = Math.round(Number(min));
  const hi = Math.round(Number(max));
  const st = Math.round(Number(step));
  if (!Number.isFinite(lo)) return [];
  if (!Number.isFinite(hi) || hi <= lo) return [lo];
  if (!Number.isFinite(st) || st <= 0) return [lo];
  const out = [];
  for (let v = lo; v <= hi; v += st) out.push(v);
  return out;
}

function dedupe(arr) {
  return [...new Set(arr)];
}

// Parses a free-form "0, 8, 16, 24" (comma/whitespace separated) list into a
// sorted, deduplicated, non-negative integer array. Backs the GPU-layers
// "Custom" mode as an alternative to a stepped range.
export function parseCustomList(text) {
  return dedupe(
    String(text || '')
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter(Boolean)
      .map(Number)
      .filter((n) => Number.isFinite(n) && n >= 0)
      .map((n) => Math.round(n))
  ).sort((a, b) => a - b);
}

// Context-size test points, as a fraction of each model's own max context
// (registry nCtx) — e.g. a 32768-ctx model tests 32768, 16384, 8192, 4096,
// 2048, 1024. Resolved per-model (not a shared range), since models in the
// registry can have very different nCtx ceilings.
export const CONTEXT_FRACTIONS = [
  { label: '1', value: 1 },
  { label: '1/2', value: 1 / 2 },
  { label: '1/4', value: 1 / 4 },
  { label: '1/8', value: 1 / 8 },
  { label: '1/16', value: 1 / 16 },
  { label: '1/32', value: 1 / 32 },
];

// config = {
//   modelIds: string[],                              // registry ids, OPFS-cached subset
//   modelArchs: { [modelId]: Arch | null },           // from probeGGUFArch, for GPU-layer clamping
//   threads: { min, max, step },
//   ctxFractions: number[],                           // subset of CONTEXT_FRACTIONS' values
//   gpuLayers: { mode: 'range'|'custom', min, max, step, customText },
//   warmup: 'off' | 'on' | 'both',
//   promptPresets: string[],                          // subset of PROMPT_PRESETS' ids; defaults to ['medium']
// }
// Returns [{ modelId, threads, nCtx, gpuLayers, warmup, promptPreset }],
// deduplicated — per-model clamping (GPU layers capped at the model's
// offload slot count; context derived from that model's own nCtx) can make
// different requested values collapse onto the same combination.
export function buildCombinations(config) {
  const threadValues = stepRange(config.threads.min, config.threads.max, config.threads.step);
  const warmupValues = config.warmup === 'both' ? [false, true] : [config.warmup === 'on'];
  const promptValues = config.promptPresets?.length ? config.promptPresets : ['medium'];
  const combos = [];
  const seen = new Set();

  for (const modelId of config.modelIds || []) {
    const model = getModel(modelId);
    if (!model) continue;
    const arch = config.modelArchs?.[modelId] || null;
    const slots = arch ? offloadSlots(arch) : null;
    const gpuCeil = slots != null ? slots : config.gpuLayers.max;

    const ctxValues = dedupe(
      (config.ctxFractions || [1]).map((f) => Math.max(1, Math.round((model.nCtx || 0) * f)))
    );
    const rawGpuValues = config.gpuLayers.mode === 'custom'
      ? parseCustomList(config.gpuLayers.customText)
      : stepRange(config.gpuLayers.min, config.gpuLayers.max, config.gpuLayers.step);
    const gpuValues = dedupe(rawGpuValues.map((v) => Math.min(Math.max(0, v), gpuCeil)));

    for (const threads of threadValues) {
      for (const nCtx of ctxValues) {
        for (const gpuLayers of gpuValues) {
          for (const warmup of warmupValues) {
            for (const promptPreset of promptValues) {
              const key = `${modelId}|${threads}|${nCtx}|${gpuLayers}|${warmup}|${promptPreset}`;
              if (seen.has(key)) continue;
              seen.add(key);
              combos.push({ modelId, threads, nCtx, gpuLayers, warmup, promptPreset });
            }
          }
        }
      }
    }
  }
  return combos;
}

const avg = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : null);
const minOf = (a) => (a.length ? Math.min(...a) : null);
const maxOf = (a) => (a.length ? Math.max(...a) : null);

function aggregateIterations(iterations) {
  const ttfts = iterations.map((r) => r.ttftMs).filter(Number.isFinite);
  const tps = iterations.map((r) => r.genTokPerSec).filter(Number.isFinite);
  return {
    ttftMsAvg: avg(ttfts), ttftMsMin: minOf(ttfts), ttftMsMax: maxOf(ttfts),
    genTokPerSecAvg: avg(tps), genTokPerSecMin: minOf(tps), genTokPerSecMax: maxOf(tps),
  };
}

// One timed generation: raw completion, fixed token count, EOS ignored.
// `timings` is only ever carried on streamed chunks (the streaming overload
// of createCompletion resolves to void), so the last chunk's timings are the
// authoritative final figures for this iteration.
async function runOneIteration(ctx, promptPreset, targetTokens, signal, onLive) {
  let ttftMs = null;
  let lastTimings = null;
  let tokenCount = 0;
  const callStart = performance.now();
  let lastLiveAt = 0;

  await ctx.wllama.createCompletion({
    prompt: resolvePrompt(promptPreset),
    max_tokens: targetTokens,
    ignore_eos: true,
    stream: true,
    abortSignal: signal,
    onData: (chunk) => {
      if (chunk.timings) lastTimings = chunk.timings;
      const text = chunk.choices?.[0]?.text;
      if (text) tokenCount++;
      if (ttftMs === null && text) {
        ttftMs = performance.now() - callStart;
        console.info(`[bench-runner] First token after ${(ttftMs / 1000).toFixed(1)}s (prompt eval)`);
      }
      const now = performance.now();
      if (onLive && now - lastLiveAt >= 150) {
        lastLiveAt = now;
        onLive({ ttftMs, tokenCount, tokPerSec: lastTimings?.predicted_per_second ?? null });
      }
    },
  });

  console.info(
    `[bench-runner] Iteration done in ${((performance.now() - callStart) / 1000).toFixed(1)}s total, ` +
      `${lastTimings?.predicted_n ?? tokenCount} tokens, ${(lastTimings?.predicted_per_second ?? 0).toFixed(1)} tok/s`
  );

  return {
    ttftMs,
    promptMs: lastTimings?.prompt_ms ?? null,
    promptTokPerSec: lastTimings?.prompt_per_second ?? null,
    predictedN: lastTimings?.predicted_n ?? tokenCount,
    predictedMs: lastTimings?.predicted_ms ?? null,
    genTokPerSec: lastTimings?.predicted_per_second ?? null,
  };
}

async function runOneCombination(ctx, combo, config, sweepId, signal, onLive) {
  const model = getModel(combo.modelId);
  const startedAt = Date.now();
  console.info(
    `[bench-runner] Combination: ${model?.name || combo.modelId} · threads=${combo.threads} · ` +
      `nCtx=${combo.nCtx} · gpuLayers=${combo.gpuLayers} · warmup=${combo.warmup ? 'on' : 'off'} · prompt=${combo.promptPreset || 'medium'}`
  );
  const run = {
    sweepId, modelId: combo.modelId,
    threads: combo.threads, nCtx: combo.nCtx, gpuLayers: combo.gpuLayers, warmup: combo.warmup,
    promptPreset: combo.promptPreset || 'medium',
    status: 'ok', error: null,
    loadMs: null, iterations: [], aggregate: null,
    startedAt, finishedAt: null,
  };

  try {
    await ctx.unload(); // safe no-op if nothing is loaded yet
    const loadStart = performance.now();
    await ctx.initialize(model, () => {}, () => {}, {
      nThreads: combo.threads,
      gpuLayers: combo.gpuLayers,
      nCtx: combo.nCtx,
    });
    run.loadMs = performance.now() - loadStart;
  } catch (err) {
    run.status = 'error';
    run.error = `load failed: ${err?.message || err}`;
    run.finishedAt = Date.now();
    return run;
  }

  if (combo.warmup) {
    console.info('[bench-runner] Warming up…');
    try {
      const warmupStart = performance.now();
      await ctx.wllama.createCompletion({ prompt: WARMUP_PROMPT, max_tokens: 1, stream: false });
      console.info(`[bench-runner] Warmup done in ${((performance.now() - warmupStart) / 1000).toFixed(1)}s`);
    } catch (err) {
      console.warn('[bench-runner] warmup failed (non-fatal):', err);
    }
  }

  for (let i = 0; i < config.iterations; i++) {
    if (signal?.aborted) break;
    console.info(`[bench-runner] Starting iteration ${i + 1}/${config.iterations}…`);
    try {
      const result = await runOneIteration(ctx, run.promptPreset, config.targetTokens, signal, onLive);
      run.iterations.push(result);
    } catch (err) {
      console.warn('[bench-runner] iteration failed (continuing):', err);
    }
  }

  if (run.iterations.length === 0) {
    run.status = 'error';
    run.error = run.error || 'no iterations completed';
  } else {
    run.aggregate = aggregateIterations(run.iterations);
  }
  run.finishedAt = Date.now();
  console.info(
    `[bench-runner] Combination ${run.status === 'error' ? 'failed' : 'done'} in ` +
      `${((run.finishedAt - run.startedAt) / 1000).toFixed(1)}s` +
      (run.status === 'error' ? ` — ${run.error}` : ` — ${run.aggregate?.genTokPerSecAvg?.toFixed(1) ?? '—'} tok/s avg`)
  );
  return run;
}

// Runs the full sweep sequentially against one shared WllamaContext (threads/
// context/GPU-layers are all load-time params in llama.cpp, so every
// combination needs its own load — concurrent contexts would also compete
// for the one GPU/WASM heap and corrupt the timing measurements). Each run is
// persisted immediately so cancelling or crashing mid-sweep keeps whatever
// finished. Combination-level failures (OOM, etc.) are recorded as
// status:'error' and the sweep continues.
//
// callbacks = {
//   onProgress({ index, total, combo }),
//   onLiveMetric({ ttftMs, tokenCount, tokPerSec }),   // throttled, during the in-flight iteration
//   onCombinationResult(run),
//   signal: AbortSignal,
// }
// presetCombos, when given, is used verbatim instead of buildCombinations(config)
// — backs "retry failed combinations" (the exact failed parameter sets,
// reconstructed from their stored run rows) without needing modelArchs/
// ranges/fractions to rebuild them. config still supplies iterations/
// targetTokens either way.
export async function runSweep(config, hardwareSnapshot, callbacks = {}, presetCombos = null) {
  const { onProgress, onLiveMetric, onCombinationResult, signal } = callbacks;
  const combos = presetCombos || buildCombinations(config);
  console.info(`[bench-runner] Starting sweep: ${combos.length} combination(s), ${config.iterations} iteration(s) each`);
  const sweepStartedAt = performance.now();

  const sweepId = await addSweep({
    startedAt: Date.now(),
    finishedAt: null,
    status: 'running',
    config: {
      modelIds: config.modelIds,
      threads: config.threads,
      ctxFractions: config.ctxFractions,
      gpuLayers: config.gpuLayers,
      warmup: config.warmup,
      promptPresets: config.promptPresets,
      iterations: config.iterations,
      targetTokens: config.targetTokens,
      retryOf: config.retryOf || null,
    },
    totalCombinations: combos.length,
    hardware: hardwareSnapshot,
  });

  const ctx = new WllamaContext();
  let cancelled = false;

  for (let i = 0; i < combos.length; i++) {
    if (signal?.aborted) { cancelled = true; break; }
    const combo = combos[i];
    onProgress?.({ index: i, total: combos.length, combo });
    const run = await runOneCombination(ctx, combo, config, sweepId, signal, onLiveMetric);
    await addRun(run);
    onCombinationResult?.(run);
    if (signal?.aborted) { cancelled = true; break; }
  }

  try { await ctx.unload(); } catch { /* best-effort cleanup */ }

  await updateSweep(sweepId, { status: cancelled ? 'cancelled' : 'done', finishedAt: Date.now() });
  console.info(
    `[bench-runner] Sweep ${cancelled ? 'cancelled' : 'done'} in ${((performance.now() - sweepStartedAt) / 1000).toFixed(1)}s`
  );
  return sweepId;
}

function median(arr) {
  if (!arr.length) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// Per-model median load time / generation speed from every past completed
// run, used to calibrate the setup screen's time estimate once real history
// exists. Returns {} when there's no completed history yet — callers fall
// back to a rough constant in that case.
export async function getHistoricalStats() {
  const allRuns = await getAllRuns();
  const byModel = {};
  for (const run of allRuns) {
    if (run.status !== 'ok' || !run.aggregate) continue;
    const bucket = (byModel[run.modelId] ||= { loads: [], tps: [] });
    if (Number.isFinite(run.loadMs)) bucket.loads.push(run.loadMs);
    if (Number.isFinite(run.aggregate.genTokPerSecAvg)) bucket.tps.push(run.aggregate.genTokPerSecAvg);
  }
  const stats = {};
  for (const [modelId, { loads, tps }] of Object.entries(byModel)) {
    stats[modelId] = { loadMsMedian: median(loads), tokPerSecMedian: median(tps) };
  }
  return stats;
}
