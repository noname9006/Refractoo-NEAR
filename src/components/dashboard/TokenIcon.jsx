import { useEffect, useState } from 'react';
import { useCoinIcon, useSymbolIcon } from '../../data/coinIcons.js';
import { ILock } from './icons.jsx';
import { CHAIN_META } from './format.js';

// Shared token avatar: CoinGecko icon when available, else the brand-tinted
// letter glyph. Falls back to the glyph if the image fails to load (so a blocked
// or 404 icon never shows a broken-image placeholder). Used by Holdings and
// Spending caps so both render identical token icons.
// bySymbol: look the icon up by symbol (NEAR Intents assets have no EVM contract).
// locked: private-shard balance — a small lock dot sits beside the chain dot.
export default function TokenIcon({ chainId, address, symbol, glyph, color, className = 'token', badge = true, bySymbol = false, locked = false }) {
  const byAddr = useCoinIcon(bySymbol ? '__none' : chainId, address);
  const bySym = useSymbolIcon(bySymbol ? symbol : '');
  const iconUrl = bySymbol ? bySym : byAddr;
  const [failed, setFailed] = useState(false);
  useEffect(() => { setFailed(false); }, [iconUrl]);

  const hasIcon = !failed && typeof iconUrl === 'string' && iconUrl.length > 0;
  const cd = CHAIN_META[chainId]?.cd;

  let style;
  if (hasIcon) style = { background: 'var(--surface)', border: '1px solid var(--line-2)' };
  else if (color) style = { background: color.bg, color: color.fg };

  return (
    <div className={className} style={style}>
      {hasIcon
        ? <img src={iconUrl} alt={symbol} className="token-icon" referrerPolicy="no-referrer" loading="lazy" onError={() => setFailed(true)} />
        : (glyph || symbol?.[0] || '•')}
      {badge && cd && (
        <span className={`chainbadge cd ${cd}${locked ? ' locked' : ''}`} title={locked ? 'Private (NEAR Intents)' : undefined}>
          {locked && <ILock />}
        </span>
      )}
    </div>
  );
}
