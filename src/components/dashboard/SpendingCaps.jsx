import { useState } from 'react';
import { shortAddr } from './format.js';
import { IChevDown } from './icons.jsx';
import TokenIcon from './TokenIcon.jsx';
import { getLayout, setCardCollapsed } from '../../storage/local.js';

function SkeletonRows() {
  return (
    <>
      {[68, 52, 60].map((w, i) => (
        <div className="skel-row" key={i}>
          <div className="skel" style={{ width: 32, height: 32, borderRadius: 9, flexShrink: 0 }} />
          <div className="skel-lines">
            <div className="skel skel-line" style={{ width: `${w}%` }} />
            <div className="skel skel-line short" style={{ width: `${w - 15}%` }} />
          </div>
          <div className="skel skel-line" style={{ width: 44, flexShrink: 0 }} />
          <div className="skel" style={{ width: 52, height: 26, borderRadius: 99, flexShrink: 0 }} />
        </div>
      ))}
    </>
  );
}

export default function SpendingCaps({ flow, view, loading, updating }) {
  const [collapsed, setCollapsed] = useState(() => getLayout().collapsed.caps);
  const toggleCollapsed = () => setCollapsed((c) => { setCardCollapsed('caps', !c); return !c; });
  const approvals = view?.approvals || [];
  const [busy, setBusy] = useState(null);
  const [err, setErr] = useState(null);
  const unlimited = approvals.filter((a) => a.unlimited).length;

  // The same token → spender approval can exist for several wallets and chains,
  // so the row id needs both.
  const rowId = (a) => `${a.chainId}:${a.owner}:${a.token}:${a.spender}`;

  const revoke = async (a) => {
    const id = rowId(a);
    setBusy(id); setErr(null);
    try {
      await flow.revoke(a);
    } catch (e) {
      // User cancelled in the wallet: not an error, just stop quietly.
      if (e?.code === 'ACTION_REJECTED' || e?.code === 4001 || e?.info?.error?.code === 4001) return;
      // ethers errors carry a huge JSON dump in .message; prefer the short reason.
      setErr({ id, msg: e?.shortMessage || e?.reason || String(e?.message || e).split(' (')[0] });
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className={`card${collapsed ? ' collapsed' : ''}`}>
      <div className="card-h card-h-btn" onClick={toggleCollapsed}>
        <h3>Spending caps</h3>
        {updating && <span className="synced"><span className="mini-spin" />updating data…</span>}
        <span className="spacer" />
        {unlimited > 0
          ? <span className="badge warn"><span className="dot" />{unlimited} unlimited</span>
          : approvals.length > 0 && <span className="badge ok"><span className="dot" />all limited</span>}
        <button className="icon-btn" aria-label={collapsed ? 'Expand' : 'Collapse'}
          onClick={(e) => { e.stopPropagation(); toggleCollapsed(); }}>
          <span className="chev"><IChevDown /></span>
        </button>
      </div>

      {!collapsed && (
        <div className="list">
          {loading && approvals.length === 0 && <SkeletonRows />}
          {!loading && approvals.length === 0 && (
            <div className="empty-note">No active token approvals detected{!import.meta.env.VITE_ETHERSCAN_KEY ? ' — set VITE_ETHERSCAN_KEY to scan approvals' : ''}.</div>
          )}
          {approvals.map((a) => {
            const id = rowId(a);
            return (
              <div className="cap" key={id}>
                <TokenIcon chainId={a.chainId} address={a.token} symbol={a.tokenSymbol} glyph={a.glyph} color={a.color} className="cap-tok" />
                <div>
                  <div className="t1">{a.tokenSymbol} <span className="arrow">→</span> {shortAddr(a.spender)}</div>
                  <div className="t2">{a.chainName}{err?.id === id ? ` · ${err.msg}` : ''}</div>
                </div>
                <span className="spacer" />
                <span className={`cap-amt num${a.unlimited ? ' risk' : ''}`}>{a.amountText}</span>
                <button className="btn ghost sm revoke" disabled={busy === id} onClick={() => revoke(a)}>
                  {busy === id ? <span className="mini-spin" /> : 'Revoke'}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
