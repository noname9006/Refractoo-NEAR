// Inline stroke icons (no icon-font dependency — privacy-first, offline-ready).
// Each takes optional className; sizing comes from the consuming CSS.
const S = (props) => ({
  viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
  strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', ...props,
});

export const IShield = (p) => (<svg {...S(p)}><path d="M12 3l7 3v5c0 4.4-3 7.6-7 9-4-1.4-7-4.6-7-9V6l7-3z" /></svg>);
export const ILock = (p) => (<svg {...S(p)}><rect x="4" y="10" width="16" height="11" rx="2.5" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></svg>);
export const IUnlock = (p) => (<svg {...S(p)}><rect x="4" y="10" width="16" height="11" rx="2.5" /><path d="M8 10V7a4 4 0 0 1 7.5-1.9" /></svg>);
export const IEye = (p) => (<svg {...S(p)}><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" /><circle cx="12" cy="12" r="3" /></svg>);
export const IEyeOff = (p) => (<svg {...S(p)}><path d="M3 3l18 18M10.6 10.7a3 3 0 0 0 4.2 4.2M9.9 5.2A9.6 9.6 0 0 1 12 5c6.5 0 10 7 10 7a16 16 0 0 1-3 3.9M6.2 6.3A16 16 0 0 0 2 12s3.5 7 10 7a9.5 9.5 0 0 0 3-.5" /></svg>);
export const ISpark = (p) => (<svg {...S(p)}><path d="M12 3l1.6 4.6L18 9l-4.4 1.4L12 15l-1.6-4.6L6 9l4.4-1.4L12 3z" /></svg>);
export const ISun = (p) => (<svg {...S(p)}><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>);
export const IMoon = (p) => (<svg {...S(p)}><path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z" /></svg>);
export const IPlus = (p) => (<svg {...S(p)} strokeWidth="2"><path d="M12 5v14M5 12h14" /></svg>);
export const IClose = (p) => (<svg {...S(p)} strokeWidth="2"><path d="M6 6l12 12M18 6L6 18" /></svg>);
export const IExpand = (p) => (<svg {...S(p)}><path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M8 21H5a2 2 0 0 1-2-2v-3M16 21h3a2 2 0 0 0 2-2v-3" /></svg>);
export const IShrink = (p) => (<svg {...S(p)}><path d="M14 10l7-7M21 3v6h-6M10 14l-7 7M3 21v-6h6" /></svg>);
export const IChevDown = (p) => (<svg {...S(p)} strokeWidth="1.9"><path d="M6 9l6 6 6-6" /></svg>);
export const IArrowUp = (p) => (<svg {...S(p)} strokeWidth="2.4"><path d="M5 15l7-7 7 7" /></svg>);
export const IArrowDown = (p) => (<svg {...S(p)} strokeWidth="2.4"><path d="M19 9l-7 7-7-7" /></svg>);
export const IMic = (p) => (<svg {...S(p)}><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></svg>);
export const ISend = (p) => (<svg {...S(p)} strokeWidth="1.9"><path d="M5 12h14M13 6l6 6-6 6" /></svg>);
export const IStop = (p) => (<svg {...S(p)}><rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" stroke="none" /></svg>);
export const IIn = (p) => (<svg {...S(p)} strokeWidth="2"><path d="M12 5v14M5 12l7 7 7-7" /></svg>);
export const IOut = (p) => (<svg {...S(p)} strokeWidth="2"><path d="M7 7h10v10M7 17L17 7" /></svg>);
export const ISwap = (p) => (<svg {...S(p)} strokeWidth="2"><path d="M7 7h10M13 3l4 4-4 4M17 17H7M11 13l-4 4 4 4" /></svg>);
export const IArrowRight = (p) => (<svg {...S(p)} strokeWidth="2"><path d="M5 12h14M13 6l6 6-6 6" /></svg>);
export const IChip = (p) => (<svg {...S(p)}><path d="M12 3v12M8 11l4 4 4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" /></svg>);
export const ICheck = (p) => (<svg {...S(p)} strokeWidth="2"><path d="M20 6L9 17l-5-5" /></svg>);
export const IFlag = (p) => (<svg {...S(p)}><path d="M5 21V4M5 4l9 4-9 4M5 4h13l-2 4 2 4H5" /></svg>);
export const IReset = (p) => (<svg {...S(p)}><path d="M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5" /></svg>);
export const IGear = (p) => (<svg {...S(p)}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z" /></svg>);
export const ITrash = (p) => (<svg {...S(p)}><path d="M4 7h16M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2m2 0v12a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V7M10 11v6M14 11v6" /></svg>);
export const IDatabase = (p) => (<svg {...S(p)}><ellipse cx="12" cy="5" rx="8" ry="3" /><path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" /></svg>);
export const ICpu = (p) => (<svg {...S(p)}><rect x="6" y="6" width="12" height="12" rx="2" /><path d="M9 9h6v6H9zM9 1v3M15 1v3M9 20v3M15 20v3M1 9h3M1 15h3M20 9h3M20 15h3" /></svg>);
export const IPower = (p) => (<svg {...S(p)}><path d="M12 3v9M7.5 6.5a8 8 0 1 0 9 0" /></svg>);
export const IDownload = (p) => (<svg {...S(p)}><path d="M12 3v12M7 11l5 5 5-5M5 21h14" /></svg>);
export const IList = (p) => (<svg {...S(p)}><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" /></svg>);
export const IImage = (p) => (<svg {...S(p)}><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="M21 15l-5-5L5 21" /></svg>);
export const IClock = (p) => (<svg {...S(p)}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>);
export const IChat = (p) => (<svg {...S(p)}><path d="M21 11.5a8.4 8.4 0 0 1-12 7.6L3 21l1.9-6A8.4 8.4 0 1 1 21 11.5z" /></svg>);

// Brand mark: the refractoo prism — two lenses with a beam refracting into a
// spectrum. Reused as the assistant's identity logo (replaces the old spark
// "diamond"). Colors are intrinsic (ink outline + fixed spectrum), so unlike the
// stroke icons above it does not follow currentColor.
export const PrismMark = ({ className = 'prism-mark', ...p }) => (
  <svg className={className} viewBox="0 0 64 28" fill="none" strokeLinecap="round" strokeLinejoin="round" {...p}>
    <g stroke="var(--ink)" strokeWidth="1.8">
      <circle cx="19" cy="14" r="9" /><circle cx="30" cy="14" r="9" /><path d="M0 14H32" />
    </g>
    <path d="M32 14L62 4" stroke="#ea3a3a" strokeWidth="1.8" />
    <path d="M32 14L62 8" stroke="#f5972b" strokeWidth="1.8" />
    <path d="M32 14L62 12" stroke="#56b04a" strokeWidth="1.8" />
    <path d="M32 14L62 16" stroke="#36a3e6" strokeWidth="1.8" />
    <path d="M32 14L62 20" stroke="#8a5bd0" strokeWidth="1.8" />
  </svg>
);
export const IRefresh = (p) => (<svg {...S(p)}><path d="M20 11a8 8 0 0 0-14.3-4.9L4 8M4 4v4h4M4 13a8 8 0 0 0 14.3 4.9L20 16M20 20v-4h-4" /></svg>);
