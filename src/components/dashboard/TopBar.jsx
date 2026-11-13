import { useState } from 'react';
import { getTheme, toggleTheme } from '../../utils/theme.js';
import { ISun, IMoon, IGear, PrismMark } from './icons.jsx';
import NearAiLogo from './NearAiLogo.jsx';

// Brand + "powered by NEAR AI" + live-data indicator + settings + theme toggle.
// Model/privacy status deliberately lives in the Assistant (its gate + footer),
// not up here: the bar stays calm and identical whichever AI tier is selected.
export default function TopBar({ flow, onOpenSettings }) {
  const [, force] = useState(0);
  const onTheme = () => { toggleTheme(); force((n) => n + 1); };
  const isDark = getTheme() === 'dark';

  return (
    <header className="topbar">
      <div className="topbar-in">
        <div className="brand">
          <span className="brand-a"><span className="wm">refractoo</span></span>
          <span className="brand-b">
            <PrismMark />
            <span className="wm">refractoo</span>
          </span>
          <span className="brand-sub">
            <small>your privacy-first defi analyst</small>
            <a className="powered" href="https://near.ai" target="_blank" rel="noopener noreferrer"
              title="Powered by NEAR AI — private, verifiable AI (near.ai)">
              <span>powered by</span>
              <NearAiLogo className="near-logo" />
            </a>
          </span>
        </div>
        <div className="spacer" />

        {flow.portfolio?.priced && (
          <span className="synced" title="Balances and prices refresh automatically every minute">
            <span className="livedot" /><span className="synced-t">live data</span>
          </span>
        )}

        <div className="topbar-tools">
          <button className="icon-btn" title="Settings" aria-label="Settings" onClick={onOpenSettings}>
            <IGear />
          </button>
          <button className="icon-btn" title="Toggle theme" aria-label="Toggle theme" onClick={onTheme}>
            {isDark ? <ISun /> : <IMoon />}
          </button>
        </div>
      </div>
    </header>
  );
}
