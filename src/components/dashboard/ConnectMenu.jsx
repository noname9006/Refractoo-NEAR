import { useEffect, useRef, useState } from 'react';
import { IPlus } from './icons.jsx';
import ChainLogo from './ChainLogo.jsx';
import NearAccountInput from './NearAccountInput.jsx';
import { listWallets, subscribeWallets, refreshWallets } from '../../data/evmWallets.js';

// Last-used wallet per stack (per-browser convenience; safe if storage is blocked).
const LAST_KEY = { evm: 'last_wallet_evm', near: 'last_wallet_near' };
const getLast = (k) => { try { return localStorage.getItem(LAST_KEY[k]); } catch { return null; } };
const setLast = (k, v) => { try { localStorage.setItem(LAST_KEY[k], v); } catch { /* ignore */ } };
const lastFirst = (list, last, idOf) => {
  const i = last ? list.findIndex((x) => idOf(x) === last) : -1;
  return i <= 0 ? list : [list[i], ...list.slice(0, i), ...list.slice(i + 1)];
};

// One "Connect wallet" button for both stacks. Clicking opens a small menu with
// a NEAR / EVM switch; the options below change with the selected tab.
export default function ConnectMenu({ flow, compact = false, className = 'connect-cta', align = 'left' }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState('evm');
  const ref = useRef(null);
  const [byName, setByName] = useState(false);
  const [evmWallets, setEvmWallets] = useState(listWallets);
  useEffect(() => subscribeWallets(setEvmWallets), []);
  useEffect(() => { if (open) { refreshWallets(); setEvmWallets(listWallets()); } }, [open]);
  // NEAR wallets come from near-connect's manifest (fetched lazily, on first NEAR tab view).
  const [nearWallets, setNearWallets] = useState(null); // null = loading
  const [nearErr, setNearErr] = useState('');
  useEffect(() => {
    if (!open || tab !== 'near' || nearWallets) return undefined;
    let live = true;
    import('../../near/nearWallet.js').then((m) => m.listNearWallets())
      .then((ws) => { if (live) setNearWallets(ws); })
      .catch((e) => { if (live) setNearErr(String(e?.message || e)); });
    return () => { live = false; };
  }, [open, tab, nearWallets]);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const run = async (fn) => { setOpen(false); await fn(); };

  return (
    <div className="connect-menu" ref={ref}>
      <button className={className} disabled={flow.busy} aria-haspopup="menu" aria-expanded={open}
        title={compact ? 'Connect another wallet' : undefined}
        onClick={() => setOpen((o) => !o)}>
        {flow.busy ? <span className="mini-spin" /> : <IPlus />}{!compact && ' Connect wallet'}
      </button>
      {open && (
        <div className={`connect-pop fade-in ${align}`} role="menu" onClick={(e) => e.stopPropagation()}>
          <div className="connect-tabs" role="tablist">
            <button role="tab" aria-selected={tab === 'evm'} onClick={() => setTab('evm')}>
              <ChainLogo cd="eth" size={16} /> EVM
            </button>
            <button role="tab" aria-selected={tab === 'near'} onClick={() => setTab('near')}>
              <ChainLogo cd="near" size={16} /> NEAR
            </button>
          </div>
          {tab === 'evm' ? (
            <div className="connect-opts">
              {evmWallets.length === 0 ? (
                <div className="connect-empty muted">
                  No EVM wallet found in this browser. Install one (MetaMask, Rabby, Coinbase Wallet…) and reopen this menu.
                </div>
              ) : lastFirst(evmWallets, getLast('evm'), (w) => w.info.rdns).map(({ info, provider }, i) => (
                <button key={info.uuid || info.rdns} className="connect-opt wallet-row"
                  onClick={() => { setLast('evm', info.rdns); run(() => flow.connectMore(provider)); }}>
                  {info.icon ? <img src={info.icon} alt="" width={24} height={24} /> : <span className="wallet-ico" />}
                  <b>{info.name}</b>
                  {i === 0 && info.rdns === getLast('evm') && <span className="last-used">Last used</span>}
                </button>
              ))}
            </div>
          ) : (
            <div className="connect-opts">
              {nearErr ? (
                <div className="connect-empty muted">Couldn’t load the NEAR wallet list: {nearErr}</div>
              ) : !nearWallets ? (
                <div className="connect-empty muted"><span className="mini-spin" /> Loading wallets…</div>
              ) : nearWallets.length === 0 ? (
                <div className="connect-empty muted">No NEAR wallets available.</div>
              ) : (
                <div className="wallet-list">
                  {lastFirst(nearWallets, getLast('near'), (w) => w.id).map((w, i) => (
                    <button key={w.id} className="connect-opt wallet-row" title={w.description}
                      onClick={() => { setLast('near', w.id); run(() => flow.connectNear(w.id)); }}>
                      {w.icon ? <img src={w.icon} alt="" width={24} height={24} /> : <span className="wallet-ico" />}
                      <b>{w.name}</b>
                      {i === 0 && w.id === getLast('near') && <span className="last-used">Last used</span>}
                    </button>
                  ))}
                </div>
              )}
              {byName
                ? <NearAccountInput flow={flow} compact onDone={() => setOpen(false)} />
                : <button className="link-btn connect-sub" onClick={() => setByName(true)}>Watch an account by name instead</button>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
