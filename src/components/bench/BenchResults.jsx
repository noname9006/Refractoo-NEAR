import { useEffect, useMemo, useState } from 'react';
import { getAllSweeps, getRunsForSweep, deleteSweep, updateSweep } from '../../storage/benchStore.js';
import { getModel } from '../../models/registry.js';
import { setPrefs } from '../../storage/local.js';

const CHART_DIMENSIONS = [
  ['gpuLayers', 'GPU layers'],
  ['threads', 'Threads'],
  ['nCtx', 'Context'],
];
const CHART_PALETTE = ['var(--accent)', 'var(--info)', 'var(--warn)', 'var(--pos)', 'var(--neg)'];

function BenchChart({ runs, xKey, models }) {
  const points = runs
    .filter((r) => r.status === 'ok' && Number.isFinite(r.aggregate?.genTokPerSecAvg) && Number.isFinite(r[xKey]))
    .map((r) => ({ x: r[xKey], y: r.aggregate.genTokPerSecAvg, modelId: r.modelId }));

  if (!points.length) return <p className="empty-note">No data to chart yet.</p>;

  const W = 600, H = 220, PAD = { l: 46, r: 16, t: 14, b: 26 };
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const xMin = Math.min(...xs), xMax = Math.max(...xs);
  const yMax = Math.max(...ys) * 1.1;
  const xScale = (x) => PAD.l + (xMax === xMin ? 0.5 : (x - xMin) / (xMax - xMin)) * (W - PAD.l - PAD.r);
  const yScale = (y) => H - PAD.b - (yMax === 0 ? 0 : y / yMax) * (H - PAD.t - PAD.b);

  const colorFor = (modelId) => CHART_PALETTE[models.indexOf(modelId) % CHART_PALETTE.length];

  return (
    <div className="bench-chart-wrap">
      <svg viewBox={`0 0 ${W} ${H}`} className="bench-chart">
        <line x1={PAD.l} y1={H - PAD.b} x2={W - PAD.r} y2={H - PAD.b} className="bench-chart-axis" />
        <line x1={PAD.l} y1={PAD.t} x2={PAD.l} y2={H - PAD.b} className="bench-chart-axis" />
        <text x={PAD.l} y={H - 8} className="bench-chart-label">{xMin}</text>
        <text x={W - PAD.r} y={H - 8} textAnchor="end" className="bench-chart-label">{xMax}</text>
        <text x={2} y={PAD.t + 8} className="bench-chart-label">{yMax.toFixed(0)}</text>
        <text x={2} y={H - PAD.b} className="bench-chart-label">0</text>
        {points.map((p, i) => (
          <circle key={i} cx={xScale(p.x)} cy={yScale(p.y)} r="4" fill={colorFor(p.modelId)}>
            <title>{`${p.x} -> ${p.y.toFixed(1)} tok/s`}</title>
          </circle>
        ))}
      </svg>
      {models.length > 1 && (
        <div className="bench-chart-legend">
          {models.map((id) => (
            <span key={id} className="bench-chart-legend-item">
              <i style={{ background: colorFor(id) }} /> {getModel(id)?.name || id}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function fmtDate(ts) {
  return Number.isFinite(ts) ? new Date(ts).toLocaleString() : '—';
}
function fmtMs(ms) {
  return Number.isFinite(ms) ? `${ms.toFixed(0)}ms` : '—';
}
function fmtTps(tps) {
  return Number.isFinite(tps) ? `${tps.toFixed(1)}` : '—';
}
function fmtGiB(n) {
  return Number.isFinite(n) ? `${(n / 1024 ** 3).toFixed(1)} GiB` : '—';
}

function summarizeHardware(hw) {
  if (!hw) return null;
  const host = hw.host;
  const gpu = host?.gpus?.find((g) => g.primary) || host?.gpus?.[0] || null;
  return {
    cpuModel: host?.cpu?.model || null,
    logicalCores: host?.cpu?.logicalCores ?? hw.browserResources?.cores ?? null,
    ramTotal: host?.memory?.total ?? null,
    ramFree: host?.memory?.free ?? null,
    gpuName: gpu?.name || hw.gpuInfo?.vendor || null,
    vramTotal: gpu?.vramTotal ?? null,
    vramFree: gpu?.vramFree ?? null,
    browserOS: hw.parsedBrowserOS ? `${hw.parsedBrowserOS.browser} ${hw.parsedBrowserOS.browserVersion} · ${hw.parsedBrowserOS.os}` : (hw.userAgent || '—'),
  };
}

function sortValue(run, key) {
  switch (key) {
    case 'model': return getModel(run.modelId)?.name || run.modelId;
    case 'threads': return run.threads;
    case 'nCtx': return run.nCtx;
    case 'gpuLayers': return run.gpuLayers;
    case 'warmup': return run.warmup ? 1 : 0;
    case 'prompt': return run.promptPreset || 'medium';
    case 'ttft': return run.aggregate?.ttftMsAvg ?? null;
    case 'loadMs': return run.loadMs ?? null;
    case 'tps': return run.aggregate?.genTokPerSecAvg ?? null;
    default: return null;
  }
}

function exportSweepJSON(sweep, runs) {
  const blob = new Blob([JSON.stringify({ sweep, runs }, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `bench-sweep-${sweep.id}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function csvEscape(value) {
  const s = String(value ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function exportSweepCSV(sweep, runs) {
  const headers = ['model', 'threads', 'nCtx', 'gpuLayers', 'warmup', 'promptPreset', 'status', 'loadMs', 'ttftMsAvg', 'genTokPerSecAvg', 'error'];
  const rows = runs.map((r) => [
    getModel(r.modelId)?.name || r.modelId, r.threads, r.nCtx, r.gpuLayers, r.warmup ? 'on' : 'off',
    r.promptPreset || 'medium', r.status, r.loadMs ?? '', r.aggregate?.ttftMsAvg ?? '', r.aggregate?.genTokPerSecAvg ?? '', r.error ?? '',
  ]);
  const csv = [headers, ...rows].map((row) => row.map(csvEscape).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `bench-sweep-${sweep.id}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

const COLUMNS = [
  ['model', 'Model'], ['threads', 'Threads'], ['nCtx', 'Ctx'], ['gpuLayers', 'GPU layers'],
  ['warmup', 'Warmup'], ['prompt', 'Prompt'], ['ttft', 'TTFT (avg)'], ['loadMs', 'Load'], ['tps', 'Tok/s (avg)'],
];

export default function BenchResults({ refreshToken, onRetryFailed }) {
  const [sweeps, setSweeps] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [runs, setRuns] = useState([]);
  const [sortKey, setSortKey] = useState('ttft');
  const [sortDir, setSortDir] = useState('asc');
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [chartXKey, setChartXKey] = useState('gpuLayers');
  const [appliedRunId, setAppliedRunId] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const all = await getAllSweeps();
      if (cancelled) return;
      setSweeps(all);
      setSelectedId((prev) => prev ?? all[0]?.id ?? null);
    })();
    return () => { cancelled = true; };
  }, [refreshToken]);

  useEffect(() => {
    let cancelled = false;
    if (!selectedId) { setRuns([]); return; }
    (async () => {
      const r = await getRunsForSweep(selectedId);
      if (!cancelled) setRuns(r);
    })();
    return () => { cancelled = true; };
  }, [selectedId]);

  const selectedSweep = sweeps?.find((s) => s.id === selectedId) || null;
  const hw = useMemo(() => summarizeHardware(selectedSweep?.hardware), [selectedSweep]);

  const sortedRuns = useMemo(() => {
    const arr = [...runs];
    arr.sort((a, b) => {
      const av = sortValue(a, sortKey);
      const bv = sortValue(b, sortKey);
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (av < bv) return sortDir === 'asc' ? -1 : 1;
      if (av > bv) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
    return arr;
  }, [runs, sortKey, sortDir]);

  function toggleSort(key) {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir('asc'); }
  }

  async function handleDelete(sweepId) {
    if (confirmDeleteId !== sweepId) { setConfirmDeleteId(sweepId); return; }
    await deleteSweep(sweepId);
    setConfirmDeleteId(null);
    setSweeps((prev) => prev.filter((s) => s.id !== sweepId));
    if (selectedId === sweepId) setSelectedId(null);
  }

  // Marks a sweep that's stuck at status:'running' (this tab has no live
  // AbortController for it — it belongs to a different tab/session, or is
  // an orphan the mount-time sweep it slipped past) as interrupted, so the
  // list stops showing a run that isn't actually progressing.
  async function handleStop(sweepId) {
    await updateSweep(sweepId, { status: 'interrupted', finishedAt: Date.now() });
    setSweeps((prev) => prev.map((s) => (s.id === sweepId ? { ...s, status: 'interrupted', finishedAt: Date.now() } : s)));
  }

  function handleApply(run) {
    setPrefs({ offloadMode: 'manual', offloadGpuLayers: run.gpuLayers });
    setAppliedRunId(run.id);
    setTimeout(() => setAppliedRunId((id) => (id === run.id ? null : id)), 2000);
  }

  const failedRuns = runs.filter((r) => r.status === 'error');
  const chartModelIds = [...new Set(runs.map((r) => r.modelId))];

  return (
    <div className="columns bench-results">
      <div className="col" style={{ flex: '0 0 320px' }}>
        <div className="card">
          <div className="card-h"><h3>Sweeps</h3><span className="count">{sweeps?.length ?? 0}</span></div>
          <div className="list">
            {sweeps === null ? (
              <div className="skel-row"><div className="skel skel-line" style={{ width: '70%' }} /></div>
            ) : sweeps.length === 0 ? (
              <p className="empty-note">No benchmark runs yet.</p>
            ) : (
              sweeps.map((s) => (
                <div key={s.id} className={`row bench-sweep-row${s.id === selectedId ? ' active' : ''}`}>
                  <button className="bench-sweep-select" onClick={() => setSelectedId(s.id)}>
                    <span>{fmtDate(s.startedAt)}</span>
                    <span className="muted">{s.config?.modelIds?.length || 0} model(s) · {s.totalCombinations} combos</span>
                  </button>
                  <span className={`pill bench-status-${s.status}`}>{s.status}</span>
                  {s.status === 'running' && (
                    <button className="btn ghost sm" onClick={() => handleStop(s.id)}>Stop</button>
                  )}
                  <button className={`btn ghost sm${confirmDeleteId === s.id ? ' danger' : ''}`} onClick={() => handleDelete(s.id)}>
                    {confirmDeleteId === s.id ? 'Confirm' : 'Delete'}
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      <div className="col">
        {!selectedSweep ? (
          <div className="card"><p className="empty-note card-pad">Select a sweep to see its results.</p></div>
        ) : (
          <>
            {hw && (
              <div className="card">
                <div className="card-h"><h3>Device at sweep start</h3></div>
                <div className="card-pad res-grid">
                  <div className="res-tile wide">
                    <span className="rk">CPU</span>
                    <span className="rv">{hw.cpuModel || '—'}</span>
                    <span className="rn">{hw.logicalCores ? `${hw.logicalCores} threads` : ''}</span>
                  </div>
                  <div className="res-tile">
                    <span className="rk">RAM free / total</span>
                    <span className="rv">{fmtGiB(hw.ramFree)} / {fmtGiB(hw.ramTotal)}</span>
                  </div>
                  <div className="res-tile">
                    <span className="rk">VRAM free / total</span>
                    <span className="rv">{fmtGiB(hw.vramFree)} / {fmtGiB(hw.vramTotal)}</span>
                  </div>
                  <div className="res-tile wide">
                    <span className="rk">GPU</span>
                    <span className="rv">{hw.gpuName || '—'}</span>
                  </div>
                  <div className="res-tile wide">
                    <span className="rk">Browser / OS</span>
                    <span className="rv">{hw.browserOS}</span>
                  </div>
                </div>
              </div>
            )}

            <div className="card">
              <div className="card-h">
                <h3>Tok/s by</h3>
                <select value={chartXKey} onChange={(e) => setChartXKey(e.target.value)}>
                  {CHART_DIMENSIONS.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                </select>
              </div>
              <div className="card-pad">
                <BenchChart runs={runs} xKey={chartXKey} models={chartModelIds} />
              </div>
            </div>

            <div className="card">
              <div className="card-h">
                <h3>Runs</h3>
                <span className="count">{runs.length}</span>
                <span className="spacer" />
                {failedRuns.length > 0 && (
                  <button className="btn ghost sm" onClick={() => onRetryFailed?.(selectedSweep, failedRuns)}>
                    Retry failed ({failedRuns.length})
                  </button>
                )}
                <button className="btn ghost sm" onClick={() => exportSweepJSON(selectedSweep, runs)}>Export JSON</button>
                <button className="btn ghost sm" onClick={() => exportSweepCSV(selectedSweep, runs)}>Export CSV</button>
              </div>
              <div className="md-table-wrap">
                <table className="md-table">
                  <thead>
                    <tr>
                      {COLUMNS.map(([key, label]) => (
                        <th key={key} onClick={() => toggleSort(key)} style={{ cursor: 'pointer' }}>
                          {label}{sortKey === key ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''}
                        </th>
                      ))}
                      <th>Status</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedRuns.map((run) => (
                      <tr key={run.id}>
                        <td>{getModel(run.modelId)?.name || run.modelId}</td>
                        <td>{run.threads}</td>
                        <td>{run.nCtx}</td>
                        <td>{run.gpuLayers}</td>
                        <td>{run.warmup ? 'on' : 'off'}</td>
                        <td>{run.promptPreset || 'medium'}</td>
                        <td>{fmtMs(run.aggregate?.ttftMsAvg)}</td>
                        <td>{fmtMs(run.loadMs)}</td>
                        <td>{fmtTps(run.aggregate?.genTokPerSecAvg)}</td>
                        <td>{run.status === 'error' ? <span className="pill bench-status-error" title={run.error}>error</span> : 'ok'}</td>
                        <td>
                          {run.status === 'ok' && (
                            <button className="btn ghost sm" onClick={() => handleApply(run)}>
                              {appliedRunId === run.id ? 'Applied' : 'Use'}
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
