import { useState } from 'react';
import { usdHolding } from './format.js';
import { IChevDown } from './icons.jsx';
import { getLayout, setCardCollapsed } from '../../storage/local.js';

function SkeletonRows() {
  return (
    <div className="list">
      {[72, 55, 63].map((w, i) => (
        <div className="skel-row" key={i}>
          <div className="skel" style={{ width: 30, height: 30, borderRadius: 8, flexShrink: 0 }} />
          <div className="skel-lines">
            <div className="skel skel-line" style={{ width: `${w}%` }} />
            <div className="skel skel-line short" style={{ width: `${w - 20}%` }} />
          </div>
          <div className="skel skel-line" style={{ width: 52, flexShrink: 0 }} />
        </div>
      ))}
    </div>
  );
}

export default function DefiPositions({ view, loading, updating }) {
  const [collapsed, setCollapsed] = useState(() => getLayout().collapsed.defi);
  const toggleCollapsed = () => setCollapsed((c) => { setCardCollapsed('defi', !c); return !c; });
  const positions = view?.positions || [];
  const [open, setOpen] = useState(() => new Set());
  const toggle = (i) => setOpen((s) => { const n = new Set(s); n.has(i) ? n.delete(i) : n.add(i); return n; });

  return (
    <section className={`card${collapsed ? ' collapsed' : ''}`}>
      <div className="card-h card-h-btn" onClick={toggleCollapsed}>
        <h3>DeFi positions</h3>
        {updating && <span className="synced"><span className="mini-spin" />updating data…</span>}
        <span className="spacer" />
        {positions.length > 0 && <span className="count">{positions.length} detected</span>}
        <button className="icon-btn" aria-label={collapsed ? 'Expand' : 'Collapse'}
          onClick={(e) => { e.stopPropagation(); toggleCollapsed(); }}>
          <span className="chev"><IChevDown /></span>
        </button>
      </div>

      {!collapsed && (
        <>
          {loading && positions.length === 0 && <SkeletonRows />}
          {!loading && positions.length === 0 && (
            <div className="list"><div className="empty-note">No DeFi positions detected on the selected chains.</div></div>
          )}
          {positions.map((d, i) => (
            <div className={`defi-row${open.has(i) ? ' open' : ''}`} key={`${d.protocol}:${d.chainId}:${i}`}>
              <div className="defi-head" onClick={() => toggle(i)}>
                <div className="proto">{d.glyph || '◆'}</div>
                <div>
                  <div className="nm">{d.protocol} <span className="tag">{d.chainName}</span></div>
                  <div className="sub">{d.sub}</div>
                </div>
                <span className="spacer" />
                <div className="num" style={{ fontWeight: 600 }}>{usdHolding(d.usd)}</div>
                <span className="defi-chev"><IChevDown /></span>
              </div>
              <div className="defi-legs">
                {d.legs.map((leg, j) => (
                  <div className="leg" key={j}>
                    <div className="k"><span className={`dotk ${leg.tone || 'sup'}`} />{leg.label}</div>
                    <div className="v num">{leg.text || usdHolding(leg.usd)}</div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </>
      )}
    </section>
  );
}
