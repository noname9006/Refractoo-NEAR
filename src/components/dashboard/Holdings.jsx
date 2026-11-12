import { useState } from 'react';
import { amount, usdHolding, usd, pct, tokenPrice, CHAIN_META } from './format.js';
import { ILock, IChevDown } from './icons.jsx';
import TokenIcon from './TokenIcon.jsx';
import { getLayout, setCardCollapsed, setLayout } from '../../storage/local.js';

function TokenGlyph({ h, shield }) {
  if (shield) {
    return (
      <div className="token tk-shield">
        <ILock />
        <span className="chainbadge cd fhe" />
      </div>
    );
  }
  return <TokenIcon chainId={h.chainId} address={h.address} symbol={h.symbol} glyph={h.glyph} color={h.color} />;
}

const DEFAULT_SMALL_USD = 0.02;

function SkeletonRows({ count = 3 }) {
  return Array.from({ length: count }, (_, i) => (
    <div className="skel-row" key={i}>
      <div className="skel skel-avatar" />
      <div className="skel-lines">
        <div className="skel skel-line" style={{ width: `${55 + (i % 3) * 15}%` }} />
        <div className="skel skel-line short" style={{ width: `${30 + (i % 2) * 20}%` }} />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 5 }}>
        <div className="skel skel-line" style={{ width: 52 }} />
        <div className="skel skel-line" style={{ width: 36 }} />
      </div>
    </div>
  ));
}

export default function Holdings({ view, loading, updating, smallUsd = DEFAULT_SMALL_USD }) {
  const [collapsed, setCollapsed] = useState(() => getLayout().collapsed.holdings);
  const [showSmall, setShowSmall] = useState(false);
  // Compact mode is global: clicking any row hides the amount/network/price/change
  // details on ALL rows at once (smoothly), and clicking again restores them.
  const [compact, setCompact] = useState(() => getLayout().holdingsCompact);

  const toggleCollapsed = () => setCollapsed((c) => { setCardCollapsed('holdings', !c); return !c; });
  const toggleCompact = () => setCompact((c) => { setLayout({ holdingsCompact: !c }); return !c; });
  const holdings = view?.holdings || [];
  const shielded = view?.shielded || [];
  const priceSub = (h) => `${amount(h.amount)} ${h.symbol} · ${CHAIN_META[h.chainId]?.name || ''}`;

  // Hidden by default: dust (priced under the user's small-balance threshold)
  // AND unpriced tokens (usd === null, shown as "—") — these are almost always
  // spam/airdrop tokens. The "Display small balances" toggle reveals them; the
  // threshold itself is tunable in Settings.
  const displayed = showSmall
    ? holdings
    : holdings.filter((h) => h.usd != null && h.usd >= smallUsd);
  const hiddenCount = holdings.length - displayed.length;

  return (
    <section className={`card${collapsed ? ' collapsed' : ''}`}>
      <div className="card-h card-h-btn" onClick={toggleCollapsed}>
        <h3>Token holdings</h3>
        {updating && <span className="synced"><span className="mini-spin" />updating data…</span>}
        <span className="spacer" />
        <span className="count">
          {displayed.length} shown{hiddenCount > 0 ? ` · ${hiddenCount} hidden` : ''}{shielded.length ? ` · ${shielded.length} shielded` : ''}
        </span>
        <button className="icon-btn" aria-label={collapsed ? 'Expand' : 'Collapse'}
          onClick={(e) => { e.stopPropagation(); toggleCollapsed(); }}>
          <span className="chev"><IChevDown /></span>
        </button>
      </div>

      {!collapsed && (
        <div className="list">
          {loading && holdings.length === 0 && <SkeletonRows count={4} />}
          {!loading && displayed.length === 0 && holdings.length === 0 && <div className="empty-note">No token balances found on the selected chains.</div>}
          {displayed.map((h) => {
            const c = pct(h.change24h);
            const key = `${h.chainId}:${h.symbol}:${h.address || 'native'}`;
            const tp = tokenPrice(h.price);
            // Detail rows stay mounted and collapse via CSS so the show/hide
            // animates; `compact` is the same value for every row.
            return (
              <div className={`row${compact ? ' compact' : ''}`} key={key} onClick={toggleCompact}>
                <div className="asset">
                  <TokenGlyph h={h} />
                  <div className="meta">
                    <div className="nm">{h.name} <span className="tag">{h.symbol}</span></div>
                    <div className="sub num collapse">{priceSub(h)}</div>
                  </div>
                </div>
                <div className="vals">
                  <div className="v num">{usdHolding(h.usd)}</div>
                  <div className="vsub collapse">
                    {tp && <span className="tp num">{tp}</span>}
                    <span className={`c num ${c.cls}`} style={c.cls ? undefined : { color: 'var(--ink-3)' }}>{c.text}</span>
                  </div>
                </div>
              </div>
            );
          })}

          {shielded.map((s) => (
            <div className="row shielded" key={s.key || `${s.stack}:${s.address}:${s.wallet}`}>
              <div className="asset">
                <TokenGlyph h={{}} shield />
                <div className="meta">
                  <div className="nm">{s.symbol || 'Shielded balance'} <span className="tag shield-tag">private</span></div>
                  <div className="sub num">
                    {s.stack === 'near-intents'
                      ? (s.demo ? 'NEAR private shard · sample data (demo)' : 'NEAR private shard · read locally')
                      : `${s.stack} · ${s.state === 'revealed' ? 'decrypted locally' : 'encrypted'}`}
                  </div>
                </div>
              </div>
              <div className="vals"><div className="v num" style={{ color: 'var(--accent)' }}>{usd(s.usd)}</div></div>
            </div>
          ))}

          {holdings.length > 0 && (
            <div className="small-toggle-row">
              <button
                className="small-toggle"
                onClick={() => setShowSmall((s) => !s)}
              >
                {showSmall ? 'Hide small balances' : `Display small balances${hiddenCount > 0 ? ` (${hiddenCount})` : ''}`}
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
