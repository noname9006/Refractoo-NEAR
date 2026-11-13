// Small round chain marks for the filter pills. Simplified, inlined (no third-party
// request); keyed by CHAIN_META[id].cd. Unknown keys fall back to the plain dot.
const W = '#fff';

const MARKS = {
  // NEAR: dark disc, light "N" (follows the theme so it shows on both).
  near: (
    <>
      <circle cx="12" cy="12" r="12" fill="var(--ink)" />
      <path d="M8.5 17V7l7 10V7" stroke="var(--surface)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </>
  ),
  eth: (
    <>
      <circle cx="12" cy="12" r="12" fill="#627eea" />
      <path d="M12 4.5l-4.3 7.1L12 14l4.3-2.4L12 4.5z" fill={W} />
      <path d="M12 15l-4.3-2.4L12 19.5l4.3-6.9L12 15z" fill={W} opacity=".75" />
    </>
  ),
  arb: (
    <>
      <circle cx="12" cy="12" r="12" fill="#28a0f0" />
      <path d="M12 5.5l5 3v7l-5 3-5-3v-7l5-3z" fill="none" stroke={W} strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M9.6 15l2.4-6 2.4 6" fill="none" stroke={W} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
  op: (
    <>
      <circle cx="12" cy="12" r="12" fill="#ff0420" />
      <text x="12" y="15.4" textAnchor="middle" fontSize="9" fontWeight="800" fontFamily="system-ui,sans-serif" fill={W}>OP</text>
    </>
  ),
  base: (
    <>
      <circle cx="12" cy="12" r="12" fill="#0052ff" />
      <circle cx="12" cy="12" r="5.2" fill={W} />
      <rect x="11" y="10.9" width="6" height="2.2" fill="#0052ff" />
    </>
  ),
  poly: (
    <>
      <circle cx="12" cy="12" r="12" fill="#8247e5" />
      <path d="M9 9.2l3-1.7 3 1.7v3.4l-3 1.7-3-1.7V9.2zm3 5.1v2.4" fill="none" stroke={W} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
};

export default function ChainLogo({ cd, size = 16, className = 'chain-logo' }) {
  const mark = MARKS[cd];
  if (!mark) return <span className={`cd ${cd || ''}`} aria-hidden="true" />;
  return (
    <svg className={className} viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" focusable="false">
      {mark}
    </svg>
  );
}
