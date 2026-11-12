import { useState } from 'react';
import { IPlus } from './icons.jsx';

// "Add a NEAR account by name" — read-only, no wallet or signature. Used on the
// connect overlay (so a NEAR-only user can start) and in the toolbar.
export default function NearAccountInput({ flow, compact = false, onDone }) {
  const [value, setValue] = useState('');
  const [err, setErr] = useState('');
  const submit = async (e) => {
    e?.preventDefault();
    const msg = await flow.addNearAcct(value);
    if (msg) { setErr(msg); return; }
    setValue('');
    setErr('');
    onDone?.();
  };
  return (
    <form className={`near-add${compact ? ' compact' : ''}`} onSubmit={submit} onClick={(e) => e.stopPropagation()}>
      <span className="cd near" aria-hidden="true" />
      <input
        type="text"
        spellCheck={false}
        autoCapitalize="off"
        autoComplete="off"
        placeholder="alice.near"
        aria-label="NEAR account name"
        value={value}
        autoFocus={compact}
        onChange={(e) => { setValue(e.target.value); setErr(''); }}
        onKeyDown={(e) => { if (e.key === 'Escape') onDone?.(); }}
      />
      <button className="btn sm" type="submit" disabled={!value.trim()}>
        <IPlus /> {compact ? 'Add' : 'Add NEAR account'}
      </button>
      {err && <span className="near-add-err">{err}</span>}
    </form>
  );
}
