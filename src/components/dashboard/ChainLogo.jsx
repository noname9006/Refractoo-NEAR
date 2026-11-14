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
  // BNB Chain: gold disc, white diamond cluster.
  bnb: (
    <>
      <circle cx="12" cy="12" r="12" fill="#f0b90b" />
      <path d="M12 5.6l2 2-2 2-2-2 2-2zM7.2 10.4l1.8 1.8-1.8 1.8-1.8-1.8 1.8-1.8zm9.6 0l1.8 1.8-1.8 1.8-1.8-1.8 1.8-1.8zM12 15.2l2 2-2 2-2-2 2-2zm0-3.8l.8.8-.8.8-.8-.8.8-.8z" fill={W} />
    </>
  ),
  // Mantle: teal disc, bold "M".
  mnt: (
    <>
      <circle cx="12" cy="12" r="12" fill="#0d8a7b" />
      <path d="M6.8 16.5V8l2.9 4.3L12 8.8l2.3 3.5L17.2 8v8.5" fill="none" stroke={W} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
  // Manta Pacific: sky-blue disc, wave-topped hull.
  manta: (
    <>
      <circle cx="12" cy="12" r="12" fill="#1a9bd8" />
      <path d="M5.5 10.2c2.2-3 4.5-3 6.5 0 2-3 4.3-3 6.5 0-1.2 5.2-3.6 7.6-6.5 7.6s-5.3-2.4-6.5-7.6z" fill={W} />
    </>
  ),
  // Avalanche: red disc, white peak with notch.
  avax: (
    <>
      <circle cx="12" cy="12" r="12" fill="#e84142" />
      <path d="M12 6.2l5.6 9.8h-3.1l-2.5-4.4-2.2 4.4H6.4L12 6.2z" fill={W} />
      <path d="M13.6 16h4" stroke={W} strokeWidth="1.6" strokeLinecap="round" />
    </>
  ),
  // Gnosis: green disc, owl-eye ring.
  gno: (
    <>
      <circle cx="12" cy="12" r="12" fill="#04795b" />
      <circle cx="12" cy="12" r="5.2" fill="none" stroke={W} strokeWidth="1.6" />
      <circle cx="12" cy="12" r="1.9" fill={W} />
    </>
  ),
  // zkSync Era: indigo disc, left-right arrows.
  zk: (
    <>
      <circle cx="12" cy="12" r="12" fill="#4e529a" />
      <path d="M5.6 12l3.4-3.2v2h6V8.8l3.4 3.2-3.4 3.2v-2H9v2L5.6 12z" fill={W} />
    </>
  ),
  // Scroll: sand disc, rolled scroll.
  scroll: (
    <>
      <circle cx="12" cy="12" r="12" fill="#eeb431" />
      <path d="M8 7.5h8a1.6 1.6 0 010 3.2H9.6a1.6 1.6 0 000 3.2H16a1.6 1.6 0 010 2.6H8" fill="none" stroke={W} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
  // Celo: yellow disc, open ring.
  celo: (
    <>
      <circle cx="12" cy="12" r="12" fill="#fcff52" />
      <path d="M16.2 7.8A6 6 0 1016.2 16.2" fill="none" stroke="#2a2825" strokeWidth="2.2" strokeLinecap="round" />
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
