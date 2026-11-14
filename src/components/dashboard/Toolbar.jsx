import { useState } from 'react';
import { CHAIN_META, usd } from './format.js';
import { VIEW_CHAIN_IDS as CHAIN_IDS, IS_TESTNET, PROFILE } from '../../config/networks.js';
import { walletName } from '../../storage/local.js';
import { IPlus, IClose, IReset } from './icons.jsx';
import ConnectMenu from './ConnectMenu.jsx';
import ChainLogo from './ChainLogo.jsx';
import NearOrgLogo from './NearOrgLogo.jsx';

// NEAR first in the chain list (it's a different pipeline from the EVM chains).
const PILL_ORDER = [...CHAIN_IDS].sort((a, b) => (a === 'near' ? -1 : b === 'near' ? 1 : 0));

// First line of a NEAR chip: the user's custom name, else the account id without
// its ".near" suffix. Second line is always the real account id.
const shortId = (id) => (id.length > 22 ? `${id.slice(0, 10)}…${id.slice(-8)}` : id);
function nearName(cluster, id) {
  const custom = cluster?.labels?.[id.toLowerCase()];
  return custom || shortId(id.replace(/\.near$/, ''));
}

// Deterministic two-stop gradient per address, for the wallet avatar.
function avatarStops(addr) {
  let h = 0;
  for (let i = 2; i < addr.length; i++) h = (h * 31 + addr.charCodeAt(i)) % 360;
  return [`hsl(${h} 62% 58%)`, `hsl(${(h + 48) % 360} 60% 50%)`];
}

export default function Toolbar({ flow, selectedChains, onToggleChain, onToggleAll, chainUsd, loading, selectedWallets, onToggleWallet }) {
  const addresses = flow.cluster.addresses || [];
  const allOn = CHAIN_IDS.every((id) => selectedChains.has(id));
  const [editing, setEditing] = useState(null); // address being renamed
  const [draft, setDraft] = useState('');

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
              title={selected ? 'Showing in dashboard · click to hide · double-click name to rename' : 'Hidden · click to show · double-click name to rename'}
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
                <span className="nm" title="Double-click to rename"
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    // The two clicks of a double-click each toggle selection, so the
                    // net effect is none; the heavy view rebuild is deferred and coalesces.
                    startEdit(a, name);
                  }}>
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
          const name = nearName(flow.cluster, id);
          const isEditing = editing === id;
          const bad = st.status === 'error' || st.status === 'missing';
          return (
            <div className={`wchip near${selected ? ' selected' : ''}${bad ? ' bad' : ''}`}
              key={`near:${id}`} role="button" aria-pressed={selected}
              title={st.error ? st.error : selected ? 'NEAR account (read-only) · click to hide · double-click name to rename' : 'Hidden · click to show · double-click name to rename'}
              onClick={() => { if (!isEditing) onToggleWallet?.(id); }}>
              <ChainLogo cd="near" size={24} className="ava" />
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
                <span className="nm" title="Double-click to rename"
                  onDoubleClick={(e) => { e.stopPropagation(); startEdit(id, name); }}>
                  {name}
                  <span className="mono">
                    {st.status === 'missing' ? 'not found' : st.status === 'error' ? 'error' : shortId(id)}
                  </span>
                </span>
              )}
              <button className="x" title="Remove NEAR account" onClick={(e) => {
                e.stopPropagation();
                if (window.confirm(`Remove ${id} from your dashboard?`)) flow.removeNearAcct(id);
              }}>
                <IClose />
              </button>
            </div>
          );
        })}
        {/* One connect button for both stacks: NEAR / EVM switch inside. */}
        {addresses.length === 0 && (flow.cluster.nearAccounts || []).length === 0
          ? <ConnectMenu flow={flow} />
          : <ConnectMenu flow={flow} compact className="add-wallet" />}
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
        {PILL_ORDER.map((id) => (
          <button key={id} className="chain-pill" aria-pressed={selectedChains.has(id)}
            title="Click to show / hide this chain"
            onClick={() => onToggleChain(id)}>
            {id === 'near'
              ? <NearOrgLogo className="near-lockup" />
              : <ChainLogo cd={CHAIN_META[id].cd} size={20} />}
            <span className="cp-txt">
              {id !== 'near' && <span className="cp-name">{CHAIN_META[id].name}</span>}
              <span className="cp-usd">{loading && chainUsd?.[id] == null ? '…' : usd(chainUsd?.[id] || 0)}</span>
            </span>
          </button>
        ))}
      </div>

      {/* Selection / layout actions — deliberately separated from the chain
          pills so they don't read as another chain. */}
      <div className="chain-actions">
        <button className="link-btn" aria-pressed={allOn} onClick={onToggleAll}
          title={allOn ? 'Deselect all chains' : 'Select all chains'}>
          All chains
        </button>
        <button
          className="btn ghost sm reset-layout"
          title="Reset card positions and column width"
          onClick={() => { try { localStorage.removeItem('card_order_v2'); } catch {} window.dispatchEvent(new Event('reset-card-layout')); }}
        >
          <IReset /> Reset layout
        </button>
      </div>

      {flow.error && <div className="toolbar-err">{flow.error}</div>}
    </div>
  );
}
