import { PRECISION_OPTIONS, precisionFor } from '../../utils/pseudonymize.js';
import GatewayCheck from './GatewayCheck.jsx';

const precisionLabel = (n) => (n === 0 ? 'Exact' : `${n} significant figures`);

// The three inference tiers side by side, with an honest "who sees what" table
// and a one-click switch. Opened from the privacy line under the chat input.
//
// Copy rules: say what actually happens, including the parts that are not
// private (public chain reads, metadata, what pseudonymization can't hide).

const TIERS = [
  { id: 'nearai', name: 'NEAR AI TEE', level: 'tee', tag: 'Recommended' },
  { id: 'local', name: 'On device', level: 'green', tag: 'Max privacy' },
  { id: 'external', name: 'External API', level: 'yellow', tag: 'Provider sees all' },
];

// The "Amounts sent" row is rendered separately (it has per-tier selects).
export function tierRows(redact) {
  const sentIds = redact ? 'Placeholders (WALLET_1, ADDR_2…)' : 'Real addresses';
  // Cell order matches TIERS: NEAR AI TEE, On device, External API.
  return [
    ['Best for', 'Default: balance of speed, convenience and privacy', 'Maximum privacy — model and data never leave this machine', 'Your own self-hosted server only'],
    ['Trade-offs', 'Data leaves the device (encrypted, enclave-verified) · pay per token', 'Can be slow, less capable models, uses this machine’s GPU/CPU — freezes and slowdowns possible', 'Everything is sent to the inference provider, unverified'],
    ['Where the model runs', 'NEAR AI GPUs inside an Intel TDX + NVIDIA confidential-computing enclave', 'This browser (WebGPU / CPU)', 'Whatever server the endpoint points to'],
    ['Question + wallet facts leave the device', 'Yes — end-to-end encrypted to the enclave', 'No', 'Yes — over HTTPS, via the local helper proxy'],
    ['Who can read them', 'Only code inside the attested enclave; NEAR’s gateway relays ciphertext', 'Only you', 'The endpoint operator'],
    ['What this browser checks', 'TDX quotes, NVIDIA GPU evidence, fresh nonce; a signature on every answer', 'Nothing to check', 'Nothing — you trust the operator'],
    ['Wallet addresses sent', sentIds, '—', sentIds],
    ['__amounts__'],
    ['Still visible to the AI', 'Which assets and chains you hold, their amounts (as set above), your question', '—', 'Which assets and chains you hold, their amounts (as set above), your question'],
    ['Cost / setup', 'Pay per token (NEAR AI credits) · API key', 'Free · one-time model download', 'Depends on the provider · URL + key'],
  ];
}

export default function TierPanel({ flow, onClose, onOpenSettings }) {
  const { prefs, model } = flow;
  const current = prefs.inference || 'nearai';
  const redact = prefs.redactRemote !== false;
  const nearReady = !!prefs.nearAi?.apiKey;
  const extReady = !!(prefs.externalApi?.baseUrl && prefs.externalApi?.model);

  const choose = async (id) => {
    if (id === current) return;
    if ((id === 'nearai' && !nearReady) || (id === 'external' && !extReady)) {
      onClose();
      onOpenSettings?.();
      return;
    }
    flow.updatePref({ inference: id });
    await flow.unloadModel();
    // Remote tiers connect immediately (no download). The local model is large,
    // so it waits for the explicit "Load model" click, as everywhere else.
    if (id !== 'local') flow.startModel();
  };

  const setPrecision = (tier, n) =>
    flow.updatePref({ roundRemote: { ...(prefs.roundRemote || {}), [tier]: n } });

  const busy = model.status === 'loading';
  const rows = tierRows(redact);

  return (
    <div className="tier-panel" role="dialog" aria-label="Where your AI runs">
      <div className="tier-head">
        <strong>Where your AI runs — and who sees what</strong>
        <button className="icon-btn" onClick={onClose} aria-label="Close">×</button>
      </div>
      <div className="tier-scroll">
        <table className="tier-table">
          <thead>
            <tr>
              <th />
              {TIERS.map((t) => (
                <th key={t.id} className={`lvl-${t.level}${t.id === current ? ' cur' : ''}`}>
                  <span className="privacy-light" /> {t.name}
                  <div className="muted" style={{ fontSize: 11 }}>{t.tag}</div>
                  <div>
                    {t.id === current ? (
                      <span className="tier-cur">In use</span>
                    ) : (
                      <button className="btn sm" disabled={busy} onClick={() => choose(t.id)}>
                        {(t.id === 'nearai' && !nearReady) || (t.id === 'external' && !extReady) ? 'Set up…' : 'Use'}
                      </button>
                    )}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(([label, ...cells]) => label === '__amounts__' ? (
              <tr key={label}>
                <th scope="row">Amounts sent</th>
                {TIERS.map((t) => (
                  <td key={t.id} className={t.id === current ? 'cur' : ''}>
                    {t.id === 'local' ? '—' : !redact ? 'Exact' : (
                      <select className="tier-prec" value={precisionFor(prefs, t.id)}
                        aria-label={`Amount precision sent to ${t.name}`}
                        onChange={(e) => setPrecision(t.id, Number(e.target.value))}>
                        {PRECISION_OPTIONS.map((n) => <option key={n} value={n}>{precisionLabel(n)}</option>)}
                      </select>
                    )}
                  </td>
                ))}
              </tr>
            ) : (
              <tr key={label}>
                <th scope="row">{label}</th>
                {cells.map((c, i) => <td key={i} className={TIERS[i].id === current ? 'cur' : ''}>{c}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <label className="check tier-redact">
        <input type="checkbox" checked={redact} onChange={(e) => flow.updatePref({ redactRemote: e.target.checked })} />
        Pseudonymize what leaves this device (addresses → placeholders; amounts as set above). Answers are mapped back to your real addresses locally.
        Exact balances across several assets can identify a wallet on a block explorer, so rounding matters most where the operator can read the prompt.
      </label>
      <label className="check tier-redact">
        <input type="checkbox" checked={prefs.reviewRemote !== false} onChange={(e) => flow.updatePref({ reviewRemote: e.target.checked })} />
        Show the exact request before it is sent to NEAR AI or an external API, and send only after I click “Send”.
      </label>
      <div className="tier-gw">
        <strong>Check the NEAR AI enclave yourself</strong>
        <GatewayCheck compact showKeyHint={!nearReady} onOpenSettings={() => { onClose(); onOpenSettings?.(); }} />
      </div>
      <p className="tier-foot muted">
        All tiers: balances and history are read from public RPCs and block explorers, which see the addresses you query.
        Confidential balances are decrypted only in this browser.
      </p>
    </div>
  );
}
