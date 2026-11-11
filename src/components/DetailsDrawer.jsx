import { MODELS, formatSize } from '../models/registry.js';
import { applyEffects } from '../utils/theme.js';

// Collapsed home for all the technical readouts that used to clutter the UI.
export default function DetailsDrawer({ flow }) {
  const { model, prefs, voiceDownload } = flow;
  const s = model.ctxStatus;

  const onOverride = (e) => {
    const id = e.target.value || null;
    flow.updatePref({ modelOverride: id });
  };

  const onEffects = (e) => {
    const reduced = e.target.checked;
    applyEffects(reduced);
    flow.updatePref({ reduceEffects: reduced });
  };

  return (
    <details className="drawer">
      <summary>Details &amp; settings</summary>
      <dl className="kv">
        <dt>Model</dt>
        <dd>{s?.modelId || model.id || '—'}</dd>

        <dt>Compute</dt>
        <dd>
          {s ? s.backend : '—'}
          {s?.nGpuLayers > 0 ? ` · ${s.nGpuLayers} GPU layers` : ''}
          {s?.gpuInfo?.vendor ? ` · ${s.gpuInfo.vendor} ${s.gpuInfo.architecture || ''}` : ''}
        </dd>

        {(model.status === 'error' || (model.log && model.log.length > 0)) && (
          <>
            <dt>AI load log</dt>
            <dd>
              {model.error && <div className="err" style={{ marginBottom: 6 }}>{model.error}</div>}
              {model.log?.length > 0 && <div className="ai-log">{model.log.join('\n')}</div>}
              {model.status === 'error' && (
                <button className="btn ghost sm" style={{ marginTop: 6 }} onClick={() => flow.retryModel()}>Retry load</button>
              )}
            </dd>
          </>
        )}

        {s?.mtpStatus && s.mtpStatus !== 'n/a' && (
          <>
            <dt>MTP</dt>
            <dd>{s.mtpStatus}</dd>
          </>
        )}

        <dt>Voice</dt>
        <dd>
          {prefs.voiceEnabled
            ? voiceDownload?.status === 'loading'
              ? `downloading… ${voiceDownload.pct || 0}%`
              : 'on'
            : (
              <button className="btn ghost sm" onClick={() => flow.chooseVoice(true)}>Enable voice</button>
            )}
        </dd>

        <dt>Model override</dt>
        <dd>
          <select value={prefs.modelOverride || ''} onChange={onOverride} style={{ width: 'auto' }}>
            <option value="">Auto (by device)</option>
            {MODELS.map((m) => (
              <option key={m.id} value={m.id}>{m.name} — {formatSize(m.sizeBytes)}</option>
            ))}
          </select>
        </dd>

        <dt>Storage</dt>
        <dd className="muted">
          Models download once and cache in your browser’s local storage (OPFS),
          which lives inside the browser’s profile folder — the app can’t choose a
          disk location for it. If your system drive is low on space, move your
          browser’s profile (user-data directory) to another drive; that relocates
          the model cache with it. You need roughly the model’s size free
          (1–6&nbsp;GB depending on the model).
        </dd>

        <dt>Visual effects</dt>
        <dd>
          <label className="check">
            <input type="checkbox" checked={!!prefs.reduceEffects} onChange={onEffects} />
            Reduce effects (drop blur &amp; texture) for faster rendering
          </label>
        </dd>

        <dt>Privacy</dt>
        <dd className="muted">
          Inference &amp; private-data unsealing happen on this device. Public chain
          reads reach RPC/explorer endpoints. Cluster &amp; data cached locally only.
        </dd>
      </dl>
    </details>
  );
}
