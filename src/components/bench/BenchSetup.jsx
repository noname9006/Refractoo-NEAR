import { useEffect, useMemo, useRef, useState } from 'react';
import { listCachedModels } from '../../utils/system-info.js';
import { MODELS, getModel } from '../../models/registry.js';
import { probeGGUFArch } from '../../utils/gguf-probe.js';
import { optimalThreads } from '../../utils/offload-planner.js';
import { detectGPU, initialGpuLayers } from '../../utils/gpu-detector.js';
import {
  buildCombinations, stepRange, parseCustomList, getHistoricalStats, CONTEXT_FRACTIONS, PROMPT_PRESETS,
} from '../../utils/bench-runner.js';

const ROUGH_LOAD_MS = 8000;       // per-combination load estimate when a model has no run history yet
const ROUGH_TOK_PER_SEC = 15;     // generation-speed estimate when a model has no run history yet
const HARD_CEILING = 2000;        // Start is blocked above this many total runs
const WARN_THRESHOLD = 200;       // total runs above which a warning banner shows

function fmtDuration(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return '—';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

function RangeRow({ label, hint, value, onChange, disabled, suffix }) {
  const set = (patch) => onChange({ ...value, ...patch });
  const values = disabled ? [] : stepRange(value.min, value.max, value.step);
  return (
    <div className="bench-range-row">
      <div className="bench-range-label">
        <strong>{label}</strong>
        {hint ? <span className="muted">{hint}</span> : null}
      </div>
      <div className="bench-range-inputs">
        <label>Min<input type="number" value={value.min} disabled={disabled}
          onChange={(e) => set({ min: Number(e.target.value) })} /></label>
        <label>Max<input type="number" value={value.max} disabled={disabled}
          onChange={(e) => set({ max: Number(e.target.value) })} /></label>
        <label>Step<input type="number" value={value.step} disabled={disabled}
          onChange={(e) => set({ step: Number(e.target.value) })} /></label>
      </div>
      <div className="bench-chip-list">
        {disabled
          ? <span className="muted">n/a on this device</span>
          : values.map((v) => <span className="bench-chip" key={v}>{v}{suffix || ''}</span>)}
      </div>
    </div>
  );
}

function GpuLayersRow({ value, onChange, disabled }) {
  const setMode = (mode) => onChange({ ...value, mode });
  const setField = (patch) => onChange({ ...value, ...patch });
  const isCustom = value.mode === 'custom';
  const values = disabled
    ? []
    : isCustom
      ? parseCustomList(value.customText)
      : stepRange(value.min, value.max, value.step);

  return (
    <div className="bench-range-row">
      <div className="bench-range-label">
        <strong>GPU offload layers</strong>
        <div className="seg" role="tablist" aria-label="GPU layers mode">
          <button type="button" role="tab" aria-selected={!isCustom} disabled={disabled}
            className={!isCustom ? 'on' : ''} onClick={() => setMode('range')}>Range</button>
          <button type="button" role="tab" aria-selected={isCustom} disabled={disabled}
            className={isCustom ? 'on' : ''} onClick={() => setMode('custom')}>Custom</button>
        </div>
      </div>

      {isCustom ? (
        <input type="text" className="bench-custom-input" placeholder="e.g. 0, 8, 16, 24, 32" disabled={disabled}
          value={value.customText || ''} onChange={(e) => setField({ customText: e.target.value })} />
      ) : (
        <div className="bench-range-inputs">
          <label>Min<input type="number" value={value.min} disabled={disabled}
            onChange={(e) => setField({ min: Number(e.target.value) })} /></label>
          <label>Max<input type="number" value={value.max} disabled={disabled}
            onChange={(e) => setField({ max: Number(e.target.value) })} /></label>
          <label>Step<input type="number" value={value.step} disabled={disabled}
            onChange={(e) => setField({ step: Number(e.target.value) })} /></label>
        </div>
      )}

      <div className="bench-chip-list">
        {disabled
          ? <span className="muted">n/a on this device</span>
          : values.length
            ? values.map((v) => <span className="bench-chip" key={v}>{v}</span>)
            : <span className="muted">no values</span>}
      </div>
    </div>
  );
}

function ContextFractionsRow({ selectedFractions, onChange, models }) {
  const toggle = (value) => {
    onChange(
      selectedFractions.includes(value)
        ? selectedFractions.filter((v) => v !== value)
        : [...selectedFractions, value]
    );
  };
  return (
    <div className="bench-range-row">
      <div className="bench-range-label">
        <strong>Context</strong>
        <span className="muted">fraction of each model's max context</span>
      </div>
      <div className="bench-fraction-list">
        {CONTEXT_FRACTIONS.map(({ label, value }) => (
          <label key={label} className="bench-fraction-chip">
            <input type="checkbox" checked={selectedFractions.includes(value)} onChange={() => toggle(value)} />
            {label}
          </label>
        ))}
      </div>
      {models.length > 0 && (
        <div className="bench-fraction-preview">
          {models.map((m) => {
            const values = [...new Set(selectedFractions.map((f) => Math.max(1, Math.round(m.nCtx * f))))]
              .sort((a, b) => a - b);
            return (
              <div className="bench-fraction-preview-row" key={m.id}>
                <span className="muted">{m.name}</span>
                <span>{values.length ? values.join(', ') : '—'}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function PromptPresetsRow({ selected, onChange }) {
  const toggle = (id) => {
    onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  };
  return (
    <div className="bench-range-row">
      <div className="bench-range-label">
        <strong>Prompt size</strong>
        <span className="muted">prefill workload to test</span>
      </div>
      <div className="bench-fraction-list">
        {PROMPT_PRESETS.map((p) => (
          <label key={p.id} className="bench-fraction-chip">
            <input type="checkbox" checked={selected.includes(p.id)} onChange={() => toggle(p.id)} />
            {p.label}
          </label>
        ))}
      </div>
    </div>
  );
}

// onStart(config) — config shape consumed by bench-runner's buildCombinations/runSweep.
export default function BenchSetup({ onStart }) {
  const [cachedModels, setCachedModels] = useState(null); // null = loading; [] = none cached
  const [selectedIds, setSelectedIds] = useState([]);
  const [modelArchs, setModelArchs] = useState({});
  const probedRef = useRef(new Set());

  const [gpuUsable, setGpuUsable] = useState(true); // optimistic until detected

  const [threads, setThreads] = useState({ min: 2, max: 4, step: 2 });
  const [ctxFractions, setCtxFractions] = useState(CONTEXT_FRACTIONS.map((f) => f.value));
  const [gpuLayers, setGpuLayers] = useState({ mode: 'range', min: 0, max: 32, step: 8, customText: '0, 8, 16, 24, 32' });
  const [warmup, setWarmup] = useState('off');
  const [promptPresets, setPromptPresets] = useState(['medium']);
  const [iterations, setIterations] = useState(3);
  const [targetTokens, setTargetTokens] = useState(128);
  const [history, setHistory] = useState({}); // { [modelId]: { loadMsMedian, tokPerSecMedian } }

  // OPFS-cached wllama models, joined back to their full registry entry by
  // source URL (listCachedModels() keys items by download URL, not registry id).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const list = await listCachedModels();
      if (cancelled) return;
      const resolved = list
        .filter((m) => m.kind === 'wllama')
        .map((m) => {
          const reg = MODELS.find((r) => r.source?.url === m.key);
          return reg ? { id: reg.id, name: reg.name, sizeBytes: m.size ?? reg.sizeBytes, nCtx: reg.nCtx } : null;
        })
        .filter(Boolean);
      setCachedModels(resolved);
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const stats = await getHistoricalStats();
      if (!cancelled) setHistory(stats);
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const gpuInfo = await detectGPU();
      if (cancelled) return;
      const usable = initialGpuLayers(gpuInfo) > 0;
      setGpuUsable(usable);
      if (!usable) setGpuLayers({ mode: 'range', min: 0, max: 0, step: 1, customText: '0' });
      const threadDefault = optimalThreads({ logicalCores: navigator.hardwareConcurrency });
      setThreads({ min: Math.max(1, threadDefault - 2), max: threadDefault, step: 2 });
    })();
    return () => { cancelled = true; };
  }, []);

  // Probe each newly-selected model's GGUF header for its layer count, so the
  // GPU-layers range can be clamped to that model's real offload ceiling.
  useEffect(() => {
    let cancelled = false;
    const toProbe = selectedIds.filter((id) => !probedRef.current.has(id));
    toProbe.forEach((id) => probedRef.current.add(id));
    if (!toProbe.length) return;
    (async () => {
      for (const id of toProbe) {
        const model = getModel(id);
        if (!model) continue;
        let arch = null;
        try { arch = await probeGGUFArch(model.source.url); } catch { /* fall back to unknown arch */ }
        if (!cancelled) setModelArchs((prev) => ({ ...prev, [id]: arch }));
      }
    })();
    return () => { cancelled = true; };
  }, [selectedIds]);

  const toggleModel = (id) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const config = useMemo(() => ({
    modelIds: selectedIds, modelArchs, threads, ctxFractions, gpuLayers, warmup, promptPresets, iterations, targetTokens,
  }), [selectedIds, modelArchs, threads, ctxFractions, gpuLayers, warmup, promptPresets, iterations, targetTokens]);

  const combos = useMemo(() => buildCombinations(config), [config]);
  const totalRuns = combos.length * Math.max(1, Number(iterations) || 1);
  const estMs = useMemo(() => combos.reduce((sum, c) => {
    const stat = history[c.modelId];
    const loadMs = stat?.loadMsMedian ?? ROUGH_LOAD_MS;
    const tps = stat?.tokPerSecMedian ?? ROUGH_TOK_PER_SEC;
    return sum + loadMs + Math.max(1, iterations) * (targetTokens / Math.max(1, tps)) * 1000;
  }, 0), [combos, history, iterations, targetTokens]);
  const hasCalibration = combos.some((c) => history[c.modelId]);
  const canStart = selectedIds.length > 0 && combos.length > 0 && totalRuns <= HARD_CEILING;

  return (
    <div className="bench-setup">
      <div className="card">
        <div className="card-h">
          <h3>Models</h3>
          <span className="count">{selectedIds.length} selected</span>
        </div>
        <div className="card-pad">
          {cachedModels === null ? (
            <div className="skel-row"><div className="skel skel-line" style={{ width: '60%' }} /></div>
          ) : cachedModels.length === 0 ? (
            <p className="empty-note">No models are downloaded yet. Load one from the main app first, then come back here.</p>
          ) : (
            <div className="bench-model-list">
              {cachedModels.map((m) => (
                <label key={m.id} className="bench-model-row">
                  <input type="checkbox" checked={selectedIds.includes(m.id)} onChange={() => toggleModel(m.id)} />
                  <span className="bench-model-name">{m.name}</span>
                  <span className="muted">{(m.sizeBytes / 1e9).toFixed(2)} GB</span>
                </label>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="card">
        <div className="card-h"><h3>Settings grid</h3></div>
        <div className="card-pad bench-ranges">
          <RangeRow label="CPU threads" value={threads} onChange={setThreads} />
          <ContextFractionsRow selectedFractions={ctxFractions} onChange={setCtxFractions}
            models={(cachedModels || []).filter((m) => selectedIds.includes(m.id))} />
          <GpuLayersRow value={gpuLayers} onChange={setGpuLayers} disabled={!gpuUsable} />

          <div className="set-row">
            <strong>Warmup</strong>
            <div className="seg" role="tablist" aria-label="Warmup mode">
              {['off', 'on', 'both'].map((mode) => (
                <button key={mode} role="tab" aria-selected={warmup === mode}
                  className={warmup === mode ? 'on' : ''} onClick={() => setWarmup(mode)}>
                  {mode === 'off' ? 'Off' : mode === 'on' ? 'On' : 'Both'}
                </button>
              ))}
            </div>
          </div>

          <PromptPresetsRow selected={promptPresets} onChange={setPromptPresets} />

          <div className="set-row">
            <strong>Iterations per combination</strong>
            <input type="number" min="1" value={iterations} onChange={(e) => setIterations(Number(e.target.value))} />
          </div>

          <div className="set-row">
            <strong>Tokens to generate</strong>
            <input type="number" min="1" value={targetTokens} onChange={(e) => setTargetTokens(Number(e.target.value))} />
          </div>
        </div>
      </div>

      <div className="card bench-summary">
        <div className="card-pad">
          <p>
            <strong>{combos.length}</strong> combinations × <strong>{iterations}</strong> iteration{iterations === 1 ? '' : 's'} =
            {' '}<strong>{totalRuns}</strong> timed runs · est. <strong>{fmtDuration(estMs)}</strong>
            <span className="muted"> {hasCalibration ? '(calibrated from past runs where available)' : '(very rough — depends on your hardware)'}</span>
          </p>
          {totalRuns > WARN_THRESHOLD && (
            <p className="bench-warning">That's a lot of runs — narrow the ranges if this sweep should finish sooner.</p>
          )}
          {totalRuns > HARD_CEILING && (
            <p className="bench-warning">Over {HARD_CEILING} runs — narrow the ranges before starting.</p>
          )}
          <button className="btn primary big" disabled={!canStart} onClick={() => onStart(config)}>
            Start benchmark
          </button>
        </div>
      </div>
    </div>
  );
}
