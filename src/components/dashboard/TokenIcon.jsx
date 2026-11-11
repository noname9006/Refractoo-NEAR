import { useEffect, useState } from 'react';
import { useCoinIcon } from '../../data/coinIcons.js';
import { CHAIN_META } from './format.js';

// Shared token avatar: CoinGecko icon when available, else the brand-tinted
// letter glyph. Falls back to the glyph if the image fails to load (so a blocked
// or 404 icon never shows a broken-image placeholder). Used by Holdings and
// Spending caps so both render identical token icons.
export default function TokenIcon({ chainId, address, symbol, glyph, color, className = 'token', badge = true }) {
  const iconUrl = useCoinIcon(chainId, address);
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
      {badge && cd && <span className={`chainbadge cd ${cd}`} />}
    </div>
  );
}
