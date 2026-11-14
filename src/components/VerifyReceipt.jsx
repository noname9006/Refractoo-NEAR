import { useState } from 'react';
import { verifyReceiptBundle } from '../near/receiptBundle.js';

// /verify: re-check a saved NEAR AI receipt in this browser, with no key, no
// account and no network. Runs the same SDK verifier the app ran when the
// answer arrived, on the file's exact bytes, then once more with one byte
// flipped. Says separately what that proves and what it does not.
export default function VerifyReceipt() {
  const [state, setState] = useState(null); // null | { name, bundle, result } | { error }
  const [over, setOver] = useState(false);

  const check = async (name, text) => {
    try {
      const bundle = JSON.parse(text);
      setState({ name, bundle, result: await verifyReceiptBundle(bundle) });
    } catch (e) { setState({ error: `${name}: ${e?.message || e}` }); }
  };
  const fromFile = async (f) => f && check(f.name, await f.text());
  const sample = async () => {
    const m = await import('../../fixtures/nearai-receipt/receipt.json');
    check('fixtures/nearai-receipt/receipt.json (captured from NEAR AI Cloud)', JSON.stringify(m.default));
  };
  const r = state?.result;

  return (
    <main className="verify-page">
      <header>
        <a href="/app" className="verify-back">← Refractoo</a>
        <h1>Verify a NEAR AI receipt</h1>
        <p>Checked in this browser. Nothing is uploaded and no key is needed.</p>
      </header>

      <label
        className={`verify-drop ${over ? 'over' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); fromFile(e.dataTransfer.files?.[0]); }}
      >
        <input type="file" accept="application/json,.json" onChange={(e) => fromFile(e.target.files?.[0])} hidden />
        <strong>Drop a receipt JSON here</strong>
        <span>or click to choose one ("Save receipt" under a Verified answer)</span>
      </label>
      <button className="btn ghost sm" onClick={sample}>Check the sample receipt from the repo</button>

      {state?.error && <div className="verify-result bad"><h2>Not a readable receipt</h2><p>{state.error}</p></div>}

      {r && (
        <section className={`verify-result ${r.ok ? 'ok' : 'bad'}`} aria-live="polite">
          <h2>{r.ok ? '✓ Signature valid' : '✗ Not valid'}</h2>
          <p className="verify-file">{state.name}</p>
          <ul>
            <li className={r.signature.ok ? 'ok' : 'bad'}>
              <span>{r.signature.ok ? '✓' : '✗'}</span>
              Signature over the exact bytes{r.signature.ok ? '' : <> — <code>{r.signature.code}</code></>}
            </li>
            <li className={r.hashes.ok ? 'ok' : 'bad'}>
              <span>{r.hashes.ok ? '✓' : '✗'}</span> Stated SHA-256 matches the bytes in the file
            </li>
            {r.tamper && (
              <li className={r.tamper.ok ? 'bad' : 'ok'}>
                <span>{r.tamper.ok ? '✗' : '✓'}</span>
                Control: byte {r.tamper.byteIndex.toLocaleString()} flipped → {r.tamper.ok ? 'still accepted (the check is broken)' : <>rejected, <code>{r.tamper.code}</code></>}
              </li>
            )}
          </ul>
          <dl>
            <dt>Signer</dt><dd className="mono">{r.signer || '—'} ({state.bundle?.signer?.signingAlgo || '?'}, {r.kind})</dd>
            <dt>Model</dt><dd>{state.bundle?.model || '—'}</dd>
            <dt>Captured</dt><dd>{state.bundle?.capturedAt || '—'}</dd>
          </dl>
          {Array.isArray(state.bundle?.liveChecks) && (
            <>
              <h3>Recorded at capture (live, not re-proven here)</h3>
              <ul className="verify-live">
                {state.bundle.liveChecks.map((c) => <li key={c.id} className={c.ok ? 'ok' : 'bad'}><span>{c.ok ? '✓' : '✗'}</span>{c.id}: {c.detail}</li>)}
              </ul>
            </>
          )}
          <div className="verify-scope">
            <div><h3>Established by this check</h3><ul>{r.established.map((s) => <li key={s}>{s}</li>)}{!r.established.length && <li>Nothing: the check failed.</li>}</ul></div>
            <div><h3>Not established offline</h3><ul>{r.notEstablished.map((s) => <li key={s}>{s}</li>)}</ul></div>
          </div>
        </section>
      )}
    </main>
  );
}
