import { useState } from 'react';
import { CHAIN_META } from './format.js';
import { VIEW_CHAIN_IDS as CHAIN_IDS, IS_TESTNET, PROFILE } from '../../config/networks.js';
import { walletName } from '../../storage/local.js';
import { IPlus, IClose, IReset } from './icons.jsx';
import NearAccountInput from './NearAccountInput.jsx';

// Deterministic two-stop gradient per address, for the wallet avatar.
function avatarStops(addr) {
  let h = 0;
  for (let i = 2; i < addr.length; i++) h = (h * 31 + addr.charCodeAt(i)) % 360;
  return [`hsl(${h} 62% 58%)`, `hsl(${(h + 48) % 360} 60% 50%)`];
}

export default function Toolbar({ flow, selectedChains, onToggleChain, onToggleAll, selectedWallets, onToggleWallet }) {
  const addresses = flow.cluster.addresses || [];
  const allOn = CHAIN_IDS.every((id) => selectedChains.has(id));
  const [editing, setEditing] = useState(null); // address being renamed
  const [draft, setDraft] = useState('');
  const [addingNear, setAddingNear] = useState(false);

  const startEdit = (a, name) => { setEditing(a); setDraft(name); };
  const commit = () => { if (editing) flow.renameWallet(editing, draft); setEditing(null); };

  return (
    <div className="toolbar">
      <div className="wallets">
        {addresses.map((a) => {
          const [c1, c2] = avatarStops(a);
          const gid = `wg-${a.slice(2, 10)}`;
          const name = walletName(flow.cluster, a);
          const selected = !selectedWallets || selectedWallets.has(a.toLowerCase());
          const isEditing = editing === a;
          return (
            <div
              className={`wchip${selected ? ' selected' : ''}`}
              key={a}
              role="button"
              aria-pressed={selected}
              title={selected ? 'Showing in dashboard · click to hide' : 'Hidden · click to show'}
              onClick={() => { if (!isEditing) onToggleWallet?.(a); }}
            >
              <svg className="ava" viewBox="0 0 24 24" aria-hidden="true">
                <defs><linearGradient id={gid} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor={c1} /><stop offset="1" stopColor={c2} /></linearGradient></defs>
                <rect width="24" height="24" rx="12" fill={`url(#${gid})`} />
              </svg>
              {isEditing ? (
                <input
                  className="wname-edit"
                  autoFocus
                  value={draft}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') { e.preventDefault(); commit(); }
                    if (e.key === 'Escape') setEditing(null);
                  }}
                  onBlur={commit}
                />
              ) : (
                <span className="nm" title="Click to rename" onClick={(e) => { e.stopPropagation(); startEdit(a, name); }}>
                  {name}<span className="mono">{a.slice(0, 6)}…{a.slice(-4)}</span>
                </span>
              )}
              <button className="x" title="Disconnect wallet" onClick={(e) => {
                e.stopPropagation();
                if (window.confirm(`Disconnect ${name}? This removes it from your dashboard.`)) flow.removeFromCluster(a);
              }}>
                <IClose />
              </button>
            </div>
          );
        })}

        {/* NEAR accounts: read-only by name, so no rename/sign — name + status. */}
        {(flow.cluster.nearAccounts || []).map((id) => {
          const st = flow.nearStatus?.[id] || {};
          const selected = !selectedWallets || selectedWallets.has(id);
          return (
            <div className={`wchip near${selected ? ' selected' : ''}${st.status === 'error' || st.status === 'missing' ? ' bad' : ''}`}
              key={`near:${id}`} role="button" aria-pressed={selected}
              title={st.error ? st.error : selected ? 'NEAR account (read-only) · click to hide' : 'Hidden · click to show'}
              onClick={() => onToggleWallet?.(id)}>
              <span className="ava near-ava" aria-hidden="true">N</span>
              <span className="nm">{id.length > 22 ? `${id.slice(0, 10)}…${id.slice(-8)}` : id}
                <span className="mono">{st.status === 'loading' ? 'loading…' : st.status === 'missing' ? 'not found' : st.status === 'error' ? 'error' : 'NEAR'}</span>
              </span>
              <button className="x" title="Remove NEAR account" onClick={(e) => {
                e.stopPropagation();
                if (window.confirm(`Remove ${id} from your dashboard?`)) flow.removeNearAcct(id);
              }}>
                <IClose />
              </button>
            </div>
          );
        })}
        {addingNear ? (
          <NearAccountInput flow={flow} compact onDone={() => setAddingNear(false)} />
        ) : (
          <button className="add-wallet add-near" title="Add a NEAR account by name (read-only)" onClick={() => setAddingNear(true)}>
            <IPlus /> NEAR
          </button>
        )}

        {addresses.length === 0 ? (
          <button className="connect-cta" disabled={flow.busy} onClick={flow.connectMore}>
            {flow.busy ? <span className="mini-spin" /> : <IPlus />} Connect wallet
          </button>
        ) : (
          <button className="add-wallet" title="Connect another wallet" disabled={flow.busy} onClick={flow.connectMore}>
            {flow.busy ? <span className="mini-spin" /> : <IPlus />}
          </button>
        )}
      </div>

      <div className="spacer" />

      {/* Testnet mode has to be unmistakable: the USD figures are proxied from
          mainnet prices and represent no real value. */}
      {IS_TESTNET && (
        <span
          className="pill testnet-badge"
          title={`Testnet mode — ${PROFILE.chains.map((c) => c.name).join(', ')}. USD values are proxied from mainnet prices and are not real value.`}
        >
          Testnet
        </span>
      )}

      <div className="chains" role="group" aria-label="Filter by chain">
        <button className="chain-pill" aria-pressed={allOn} onClick={onToggleAll}>All chains</button>
        {CHAIN_IDS.map((id) => (
          <button key={id} className="chain-pill" aria-pressed={selectedChains.has(id)}
            title="Click to show only this chain · click again for all"
            onClick={() => onToggleChain(id)}>
            <span className={`cd ${CHAIN_META[id].cd}`} />{CHAIN_META[id].name}
          </button>
        ))}
      </div>

      {/* Layout action — deliberately separated from the chain filters so it
          doesn't read as a sixth chain. */}
      <button
        className="btn ghost sm reset-layout"
        title="Reset card positions and column width"
        onClick={() => { try { localStorage.removeItem('card_order_v2'); } catch {} window.dispatchEvent(new Event('reset-card-layout')); }}
      >
        <IReset /> Reset layout
      </button>

      {flow.error && <div className="toolbar-err">{flow.error}</div>}
    </div>
  );
}
