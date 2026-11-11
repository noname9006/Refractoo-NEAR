import { getModel } from '../../models/registry.js';

function comboLabel(combo) {
  if (!combo) return '—';
  const model = getModel(combo.modelId);
  const prompt = combo.promptPreset && combo.promptPreset !== 'medium' ? ` · ${combo.promptPreset} prompt` : '';
  return `${model?.name || combo.modelId} · ${combo.threads}t · ${combo.nCtx}ctx · gpu ${combo.gpuLayers} · warmup ${combo.warmup ? 'on' : 'off'}${prompt}`;
}

function fmtMs(ms) {
  return Number.isFinite(ms) ? `${ms.toFixed(0)}ms` : '—';
}
function fmtTps(tps) {
  return Number.isFinite(tps) ? `${tps.toFixed(1)} tok/s` : '—';
}

export default function BenchLiveRun({ progress, live, completed, onCancel }) {
  const { index = 0, total = 0, combo = null } = progress || {};
  const pct = total > 0 ? Math.round(((index) / total) * 100) : 0;

  return (
    <div className="bench-live">
      <div className="card">
        <div className="card-h">
          <h3>Running sweep — combination {Math.min(index + 1, total)}/{total}</h3>
          <button className="btn ghost sm" onClick={onCancel}>Cancel</button>
        </div>
        <div className="card-pad">
          <div className="track"><div className="fill" style={{ width: `${pct}%` }} /></div>
          <p className="bench-current-combo">{comboLabel(combo)}</p>
          <div className="res-grid">
            <div className="res-tile">
              <span className="rk">Time to first token</span>
              <span className="rv">{fmtMs(live?.ttftMs)}</span>
            </div>
            <div className="res-tile">
              <span className="rk">Tokens / sec</span>
              <span className="rv">{fmtTps(live?.tokPerSec)}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-h">
          <h3>Completed</h3>
          <span className="count">{completed.length}</span>
        </div>
        <div className="list bench-completed-list">
          {completed.length === 0 ? (
            <p className="empty-note">No combinations finished yet.</p>
          ) : (
            completed.map((run) => (
              <div className="row" key={run.id}>
                <span className="bench-row-combo">{comboLabel(run)}</span>
                {run.status === 'error' ? (
                  <span className="pill bench-status-error">error</span>
                ) : (
                  <span className="bench-row-metrics">
                    {fmtMs(run.aggregate?.ttftMsAvg)} ttft · {fmtTps(run.aggregate?.genTokPerSecAvg)}
                  </span>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
