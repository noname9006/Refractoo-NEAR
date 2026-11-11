import { shortAddr } from '../dashboard/format.js';
import { IPlus, IClose } from '../dashboard/icons.jsx';

export default function WalletStep({ cluster, currentAddress, onAddAnother, onContinue, onRemove, busy, error }) {
  const addresses = cluster.addresses || [];
  return (
    <div className="ob-card">
      <div>
        <h2>Your wallets</h2>
        <p className="muted">
          Add the accounts you want to analyze together. They form one cluster, saved only on
          this device — connecting any of them later reloads them all.
        </p>
      </div>

      <div className="ob-list">
        {addresses.map((a) => (
          <div className="item" key={a}>
            <code className="mono">{shortAddr(a)}{currentAddress && a.toLowerCase() === currentAddress.toLowerCase() ? '  · connected' : ''}</code>
            {addresses.length > 1 && (
              <button className="icon-btn" title="Remove" onClick={() => onRemove(a)}><IClose /></button>
            )}
          </div>
        ))}
      </div>

      <div className="row">
        <button className="btn" onClick={onAddAnother} disabled={busy}>
          {busy ? <span className="mini-spin" /> : <IPlus />} Add another
        </button>
        <button className="btn primary grow" onClick={onContinue} disabled={busy || addresses.length === 0}>
          Continue with {addresses.length} wallet{addresses.length === 1 ? '' : 's'}
        </button>
      </div>

      <p className="muted" style={{ fontSize: 11 }}>Tip: switch accounts in your web3 wallet app before clicking “Add another”.</p>
      {error && <p className="err">{error}</p>}
    </div>
  );
}
