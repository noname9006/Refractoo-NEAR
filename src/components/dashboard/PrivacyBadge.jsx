import { privacyState } from '../../utils/privacy.js';

// Green/yellow/red privacy light + copy, driven by where inference runs.
// Two presentations:
//   variant="foot" — the line under the assistant input (full sentence)
//   variant="pill" — the compact top-bar pill (short label, sentence in tooltip)
export function PrivacyBadge({ prefs, variant = 'foot', onClick }) {
  const s = privacyState(prefs);
  if (onClick) {
    return (
      <button className={`chat-foot as-btn lvl-${s.level}`} title="Where your AI runs — compare tiers" onClick={onClick}>
        <span className="privacy-light" />
        <span>{s.label}</span>
        <span className="chat-foot-more">Compare tiers</span>
      </button>
    );
  }
  if (variant === 'pill') {
    return (
      <span className={`pill privacy lvl-${s.level}`} title={s.label}>
        <span className="privacy-light" />
        {s.short}
      </span>
    );
  }
  return (
    <div className={`chat-foot lvl-${s.level}`} title={s.label}>
      <span className="privacy-light" />
      <span>{s.label}</span>
    </div>
  );
}
