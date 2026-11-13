import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { markPlaceholders } from '../../utils/outbound.js';

// "Review before sending" for the off-device tiers (NEAR AI TEE, external API).
// Shows the EXACT request body the backend will send — built by the same
// function the backend uses (utils/outbound.js) — and sends only on "Send".
// Cancel, Esc or closing the dialog sends nothing.

const kb = (n) => (n < 1024 ? `${n} B` : `${(n / 1024).toFixed(1)} KB`);

function Marked({ text }) {
  const runs = useMemo(() => markPlaceholders(text), [text]);
  return runs.map((r, i) => (r.mark ? <mark key={i} className="ph">{r.text}</mark> : <span key={i}>{r.text}</span>));
}

export default function OutboundReview({ info, reviewOn, onToggleReview, onCancel, onSend }) {
  const sendRef = useRef(null);
  const [copied, setCopied] = useState(false);
  const near = info.mode === 'nearai';

  // Focus once on open; Esc always reaches the latest onCancel.
  const cancelRef = useRef(onCancel);
  cancelRef.current = onCancel;
  useEffect(() => {
    sendRef.current?.focus();
    const onKey = (e) => { if (e.key === 'Escape') cancelRef.current(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const copy = async () => {
    try { await navigator.clipboard.writeText(info.json); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* clipboard blocked */ }
  };

  const amounts = !info.pseudonymized ? 'exact' : info.sigFigs ? `rounded to ${info.sigFigs} significant figures` : 'exact';

  // Portal to <body>: the assistant card sits inside a transformed ancestor,
  // which would turn position:fixed into "fixed to the card".
  return createPortal(
    <div className="ob-scrim" onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div className="ob-dialog" role="dialog" aria-modal="true" aria-labelledby="ob-title">
        <div className="ob-head">
          <div>
            <strong id="ob-title">Review what leaves this device</strong>
            <div className={`ob-dest lvl-${near ? 'tee' : 'yellow'}`}>
              <span className="privacy-light" />
              {info.destination} · <span className="mono">{info.model || 'model not set'}</span>
            </div>
          </div>
          <button className="icon-btn" onClick={onCancel} aria-label="Cancel, send nothing">×</button>
        </div>

        <p className="ob-transport">{info.transport}</p>

        <ul className="ob-facts">
          {info.pseudonymized ? (
            <li className="ok">Addresses and accounts → placeholders ({info.placeholders} in this request), mapped back locally in the answer</li>
          ) : (
            <li className="warn">Pseudonymization is OFF — real addresses and exact amounts are in this request</li>
          )}
          <li className={info.pseudonymized && info.sigFigs ? 'ok' : ''}>Amounts: {amounts}</li>
          <li>{kb(info.bytes)} · {near ? 'readable only inside the attested enclave' : 'readable by the endpoint operator'}</li>
        </ul>

        <div className="ob-label">Your question, as sent</div>
        <div className="ob-question"><Marked text={info.question} /></div>

        <div className="ob-label">
          Full request body{near ? ' (plaintext, before encryption to the enclave)' : ''}
          <button className="btn ghost sm" onClick={copy}>{copied ? 'Copied' : 'Copy'}</button>
        </div>
        <pre className="ob-json" tabIndex={0}><Marked text={info.json} /></pre>

        <div className="ob-foot">
          <label className="check">
            <input type="checkbox" checked={reviewOn} onChange={(e) => onToggleReview(e.target.checked)} />
            Show this before every off-device request
          </label>
          <div className="ob-actions">
            <button className="btn" onClick={onCancel}>Cancel</button>
            <button className="btn primary" ref={sendRef} onClick={onSend}>Send</button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
