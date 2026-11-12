import { useState } from 'react';
import { verifyGatewayNow } from '../../near/nearAiContext.js';

// "Verify NEAR AI gateway now" — a real, key-less attestation check run in this
// browser (see verifyGatewayNow). Plus a one-line pointer for people who do
// have a NEAR AI key. Used where someone without a key meets the TEE tier.
export default function GatewayCheck({ compact = false, showKeyHint = true, onOpenSettings }) {
  const [st, setSt] = useState({ status: 'idle' });
  const run = async () => {
    setSt({ status: 'running' });
    try {
      setSt({ status: 'ok', r: await verifyGatewayNow() });
    } catch (e) {
      setSt({ status: 'error', error: String(e?.failure?.code || e?.message || e) });
    }
  };
  const r = st.r;
  return (
    <div className={`gw-check${compact ? ' compact' : ''}`}>
      <div className="gw-row">
        <button className="btn sm" onClick={run} disabled={st.status === 'running'}>
          {st.status === 'running' ? <span className="mini-spin" /> : null}
          {st.status === 'ok' ? 'Verify again' : 'Verify NEAR AI gateway now'}
        </button>
        <span className="gw-sub">No key needed — this browser checks the live gateway enclave itself.</span>
      </div>
      {st.status === 'ok' && (
        <ul className="gw-list">
          <li><b>✓</b> Intel TDX quote verified against Intel collateral · TCB <code>{r.tcbStatus}</code>{r.advisoryIds.length ? ` · advisories ${r.advisoryIds.join(', ')}` : ''}</li>
          <li><b>✓</b> Bound to a fresh nonce from this browser <code>{r.nonce}</code></li>
          <li><b>✓</b> Gateway signing key from the quote <code>{r.signer}</code> ({r.algo})</li>
          <li className="muted">Done in {(r.ms / 1000).toFixed(1)} s. The model enclave and answer signatures are checked once you connect with a key.</li>
        </ul>
      )}
      {st.status === 'error' && <div className="gw-err">Verification failed: {st.error}</div>}
      {showKeyHint && (
        <div className="gw-key muted">
          Have a NEAR AI key? Add it in{' '}
          {onOpenSettings ? <button className="linkish" onClick={onOpenSettings}>Settings → AI model</button> : 'Settings → AI model'}{' '}
          to chat through the enclave (keys at{' '}
          <a href="https://cloud.near.ai" target="_blank" rel="noreferrer noopener">cloud.near.ai</a>).
        </div>
      )}
    </div>
  );
}
