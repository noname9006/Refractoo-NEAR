import { useEffect, useState } from 'react';
import {
  ISpark, IChip, IList, IFlag, IClock, IShield, IGear,
} from './icons.jsx';

// Fixed left-rail navigation. Each entry scrolls its dashboard block into view
// and highlights whichever block is currently nearest the top of the viewport.
// Hidden on narrow screens (see styles.css) where the rail would crowd the page.
const ITEMS = [
  { id: 'sec-summary', label: 'Overview', Icon: ISpark },
  { id: 'sec-assistant', label: 'Assistant', Icon: ISpark },
  { id: 'sec-holdings', label: 'Holdings', Icon: IChip },
  { id: 'sec-defi', label: 'DeFi', Icon: IList },
  { id: 'sec-activity', label: 'Activity', Icon: IClock },
  { id: 'sec-caps', label: 'Approvals', Icon: IFlag },
  { id: 'sec-details', label: 'Details', Icon: IShield },
];

export default function NavPanel({ onOpenSettings }) {
  const [active, setActive] = useState('sec-summary');

  // Highlight the block whose top is closest to (just below) the header.
  useEffect(() => {
    const onScroll = () => {
      let best = null;
      let bestDist = Infinity;
      for (const it of ITEMS) {
        const el = document.getElementById(it.id);
        if (!el) continue;
        const top = el.getBoundingClientRect().top;
        const dist = Math.abs(top - 90); // ~below the sticky topbar
        if (top - 140 < window.innerHeight && dist < bestDist) { bestDist = dist; best = it.id; }
      }
      if (best) setActive(best);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => { window.removeEventListener('scroll', onScroll); window.removeEventListener('resize', onScroll); };
  }, []);

  const go = (id) => {
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <nav className="nav-rail" aria-label="Dashboard sections">
      <div className="nav-rail-in">
        {ITEMS.map(({ id, label, Icon }) => (
          <button key={id} className={`nav-item${active === id ? ' active' : ''}`} onClick={() => go(id)} title={label}>
            <span className="nav-ic"><Icon /></span>
            <span className="nav-lbl">{label}</span>
          </button>
        ))}
        <div className="nav-sep" />
        <button className="nav-item" onClick={onOpenSettings} title="Settings">
          <span className="nav-ic"><IGear /></span>
          <span className="nav-lbl">Settings</span>
        </button>
      </div>
    </nav>
  );
}
