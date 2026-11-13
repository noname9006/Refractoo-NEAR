import { useEffect, useRef, useState } from 'react';
import { IPlus } from './icons.jsx';
import ChainLogo from './ChainLogo.jsx';
import NearAccountInput from './NearAccountInput.jsx';
import { listWallets, subscribeWallets, refreshWallets } from '../../data/evmWallets.js';

// One "Connect wallet" button for both stacks. Clicking opens a small menu with
// a NEAR / EVM switch; the options below change with the selected tab.
export default function ConnectMenu({ flow, compact = false, className = 'connect-cta', align = 'left' }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState('evm');
  const ref = useRef(null);
  const [evmWallets, setEvmWallets] = useState(listWallets);
  useEffect(() => subscribeWallets(setEvmWallets), []);
  useEffect(() => { if (open) { refreshWallets(); setEvmWallets(listWallets()); } }, [open]);

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
              ) : evmWallets.map(({ info, provider }) => (
                <button key={info.uuid || info.rdns} className="connect-opt wallet-row" onClick={() => run(() => flow.connectMore(provider))}>
                  {info.icon ? <img src={info.icon} alt="" width={24} height={24} /> : <span className="wallet-ico" />}
                  <b>{info.name}</b>
                </button>
              ))}
            </div>
          ) : (
            <div className="connect-opts">
              <button className="connect-opt" onClick={() => run(flow.connectNear)}>
                <b>NEAR wallet</b>
                <span className="muted">HOT, Meteor, Intear, MyNearWallet…</span>
              </button>
              <div className="connect-sub muted">or read an account by name — no wallet, no signature</div>
              <NearAccountInput flow={flow} compact onDone={() => setOpen(false)} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
