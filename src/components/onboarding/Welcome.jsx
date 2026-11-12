import { IShield } from '../dashboard/icons.jsx';

export default function Welcome({ onConnect, busy, error, returningCount }) {
  return (
    <div className="ob-card center">
      <div className="ob-icon"><IShield /></div>
      <div>
        <h1>Your private DeFi consultant</h1>
        <p className="muted" style={{ marginTop: 8, maxWidth: 360 }}>
          Analyze your wallets with an AI on your device, or in a NEAR AI enclave
          this browser verifies. Private-data unsealing never leaves this browser.
        </p>
      </div>

      {returningCount > 0 && (
        <p className="muted">Welcome back — connect any of your wallets to reload your cluster of <b style={{ color: 'var(--ink)' }}>{returningCount}</b>.</p>
      )}

      <button className="btn primary big" onClick={onConnect} disabled={busy}>
        {busy ? <><span className="mini-spin" /> Connecting…</> : 'Connect wallet'}
      </button>

      {error && <p className="err">{error}</p>}
      <p className="muted" style={{ fontSize: 11 }}>Requires a web3 wallet app. Your addresses and data stay in this browser.</p>
    </div>
  );
}
