import { useState } from 'react';
import { getModel } from '../../models/registry.js';
import { getTheme, toggleTheme } from '../../utils/theme.js';
import { ISun, IMoon, IGear, PrismMark } from './icons.jsx';
import { PrivacyBadge } from './PrivacyBadge.jsx';

// Brand + local-model status + privacy badge + settings + theme toggle. The
// model state reflects the real wllama context (loaded during onboarding).
export default function TopBar({ flow, onOpenSettings }) {
  const [, force] = useState(0);
  const m = flow.model;
  const modelName = m.id ? getModel(m.id)?.name : null;

  const onTheme = () => { toggleTheme(); force((n) => n + 1); };
  const isDark = getTheme() === 'dark';

  // Which backend the pill describes: the live one once loading/ready/error,
  // otherwise the one chosen in prefs (unload resets model.mode to 'local').
  const tier = m.status === 'idle' ? (flow.prefs.inference || 'local') : (m.mode || 'local');
  const noun = tier === 'nearai' ? 'NEAR AI TEE' : tier === 'external' ? 'External AI' : 'Local AI';
  const downloading = tier === 'local' && m.status === 'loading' && m.progress > 0 && m.progress < 0.999;
  let dotCls = 'dot', spin = false, text = tier === 'nearai' ? 'Connect NEAR AI TEE' : tier === 'external' ? 'Connect external AI' : 'Set up local AI';
  if (m.status === 'ready') {
    dotCls = 'dot live';
    const name = tier === 'local' ? modelName : m.externalName;
    text = `${tier === 'nearai' ? 'NEAR AI TEE attested' : `${noun} ready`}${name ? ` · ${name}` : ''}`;
  } else if (m.status === 'loading') {
    spin = true;
    text = tier === 'nearai' ? 'Verifying enclave…' : tier === 'external' ? 'Connecting…' : downloading ? 'Downloading local AI…' : 'Warming up local AI…';
  } else if (m.status === 'error') { dotCls = 'dot work'; text = `${noun} failed — retry`; }
  const idleTitle = tier === 'nearai' ? 'Verify the NEAR AI enclave and connect' : tier === 'external' ? 'Connect the external model' : 'Click to set up the on-device AI';

  return (
    <header className="topbar">
      <div className="topbar-in">
        <div className="brand">
          <span className="brand-a"><span className="wm">refractoo</span></span>
          <span className="brand-b">
            <PrismMark />
            <span className="wm">refractoo</span>
          </span>
          <small>your privacy-first defi analyst</small>
        </div>
        <div className="spacer" />

        <button className={`pill${downloading ? ' downloading' : ''}`}
          style={downloading ? { '--p': m.progress } : undefined}
          title={m.status === 'error' && m.error ? m.error : m.status === 'idle' ? idleTitle : `${noun} status`}
          onClick={() => { if (m.status === 'idle') flow.startModel(); else if (m.status === 'error') flow.retryModel(); }}>
          {spin ? <span className="mini-spin" /> : <span className={dotCls} />}
          <span>{text}</span>
        </button>

        <PrivacyBadge prefs={flow.prefs} variant="pill" />

        <button className="icon-btn" title="Settings" onClick={onOpenSettings}>
          <IGear />
        </button>

        <button className="icon-btn" title="Toggle theme" onClick={onTheme}>
          {isDark ? <ISun /> : <IMoon />}
        </button>
      </div>
    </header>
  );
}
