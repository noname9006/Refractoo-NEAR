import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { listConfidentialModels, NEARAI_DEFAULT_MODEL } from '../../near/nearAiContext.js';
import {
  parseHotKey, currentHotKey, effectiveHotlist, hotLabel, TIER_LABELS,
} from '../../models/hotlist.js';
import { IChevDown, ICheck } from './icons.jsx';

// The model name in the Assistant header, as a button: opens the user's hotlist
// (curated in Settings → AI model) and switches tier + model in one click.
// Rendered in a portal because the assistant card clips overflow and its
// backdrop-filter would trap a fixed-position child.
export default function ModelSwitcher({ flow, disabled, onOpenSettings }) {
  const { prefs, model } = flow;
  const btnRef = useRef(null);
  const popRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const [naiModels, setNaiModels] = useState(null);

  const loadedLocalId = model.mode === 'local' && model.status === 'ready' ? model.id : null;
  const current = currentHotKey(prefs, loadedLocalId);
  const list = effectiveHotlist(prefs, loadedLocalId);
  // Show the model in use even if it isn't on the hotlist, so the check mark
  // always has a row to land on.
  const rows = current && !list.includes(current) ? [current, ...list] : list;

  // The NEAR AI catalog is cached module-side; it only supplies display names.
  useEffect(() => {
    let live = true;
    listConfidentialModels().then((l) => { if (live) setNaiModels(l); }).catch(() => {});
    return () => { live = false; };
  }, []);

  const label = (key) => hotLabel(key, naiModels);
  const tier = prefs.inference || 'nearai';
  const shown = current
    ? label(current)
    : tier === 'local' ? 'Auto model' : 'Choose model';

  useLayoutEffect(() => {
    if (!open || !btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    const width = Math.min(320, window.innerWidth - 16);
    setPos({ top: r.bottom + 6, left: Math.max(8, Math.min(r.left, window.innerWidth - width - 8)), width });
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (popRef.current?.contains(e.target) || btnRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); } };
    const onMove = () => setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', onMove);
    window.addEventListener('scroll', onMove, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('resize', onMove);
      window.removeEventListener('scroll', onMove, true);
    };
  }, [open]);

  const pick = async (key) => {
    setOpen(false);
    if (key === current && model.status !== 'error') return;
    const { tier: t, id } = parseHotKey(key);
    if (t === 'nearai') {
      if (!prefs.nearAi?.apiKey) { onOpenSettings?.('ai'); return; }
      flow.updatePref({ inference: 'nearai', nearAi: { ...(prefs.nearAi || {}), model: id } });
      await flow.unloadModel();
      flow.startModel();
    } else if (t === 'external') {
      if (!(prefs.externalApi?.baseUrl && prefs.externalApi?.model)) { onOpenSettings?.('ai'); return; }
      flow.updatePref({ inference: 'external' });
      await flow.unloadModel();
      flow.startModel();
    } else {
      // On-device models are multi-GB: select it, but wait for the explicit
      // "Load model" click (same rule as the tier panel).
      flow.updatePref({ inference: 'local', modelOverride: id });
      await flow.unloadModel();
    }
  };

  const groups = ['nearai', 'local', 'external']
    .map((t) => ({ t, keys: rows.filter((k) => parseHotKey(k).tier === t) }))
    .filter((g) => g.keys.length);

  return (
    <>
      <button ref={btnRef} type="button" className={`model-chip${open ? ' open' : ''}`}
        title="Switch model" aria-haspopup="listbox" aria-expanded={open}
        disabled={disabled}
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}>
        <span className="mc-name">{shown}</span><IChevDown />
      </button>
      {open && pos && createPortal(
        <div ref={popRef} className="model-pop" role="listbox" aria-label="Models"
          style={{ top: pos.top, left: pos.left, width: pos.width }}>
          {groups.map((g) => (
            <div key={g.t} className="mp-group">
              <div className="mp-tier">{TIER_LABELS[g.t]}</div>
              {g.keys.map((k) => {
                const { id } = parseHotKey(k);
                const sub = g.t === 'nearai' && id === NEARAI_DEFAULT_MODEL ? 'default' : null;
                return (
                  <button key={k} type="button" role="option" aria-selected={k === current}
                    className={`mp-item${k === current ? ' on' : ''}`} onClick={() => pick(k)}>
                    <span className="mp-ck">{k === current && <ICheck />}</span>
                    <span className="mp-name">{label(k)}</span>
                    {sub && <span className="mp-sub">{sub}</span>}
                  </button>
                );
              })}
            </div>
          ))}
          <button type="button" className="mp-manage"
            onClick={() => { setOpen(false); onOpenSettings?.('ai'); }}>
            Choose which models appear here…
          </button>
        </div>,
        document.body
      )}
    </>
  );
}
