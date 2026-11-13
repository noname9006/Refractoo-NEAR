import { IShield, ISpark } from './dashboard/icons.jsx';
import ConnectMenu from './dashboard/ConnectMenu.jsx';

// Shown over the dashboard whenever no wallet is connected. Replaces the old
// "dead" zero-state (a full dashboard of $0.00) with a single focused choice:
// connect a real wallet, or explore a read-only demo.
export default function ConnectOverlay({ flow }) {
  return (
    <div className="modal-scrim connect-scrim">
      <div className="modal connect-modal fade-in">
        <span className="badge-accent"><IShield /> Private by default</span>
        <h2>Connect a wallet to begin</h2>
        <p className="lead">
          Refractoo reads your on-chain balances, DeFi positions and approvals,
          then answers questions with an AI on your device — or, if you choose,
          in a NEAR AI enclave this browser verifies first.
        </p>
        <div className="modal-actions">
          <ConnectMenu flow={flow} className="btn primary" align="center" />
          <button className="btn" disabled={flow.busy} onClick={flow.loadDemo}>
            <ISpark /> Explore a demo
          </button>
        </div>
        {flow.error && <p className="err connect-err">{flow.error}</p>}
        <p className="modal-fine"><IShield /> Your keys never leave this device. Wallet data leaves it only if you pick an off-device AI tier.</p>
      </div>
    </div>
  );
}
