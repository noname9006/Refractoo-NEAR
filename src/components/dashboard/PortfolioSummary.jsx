import { useEffect, useRef, useState } from 'react';
import Sparkline from './Sparkline.jsx';
import { usdParts, usd, pct, pctAbs, seriesMinMax } from './format.js';
import { IArrowUp, IArrowDown, IUnlock, ILock, IChevDown } from './icons.jsx';
import { getLayout, setCardCollapsed } from '../../storage/local.js';

const RANGES = ['24H', '7D', '30D', '90D'];

export default function PortfolioSummary({ flow, view }) {
  const [range, setRange] = useState('7D');
  const [series, setSeries] = useState([]);
  const [chartLoading, setChartLoading] = useState(false);
  const [revealing, setRevealing] = useState(false);
  const [sealMsg, setSealMsg] = useState(null);
  const [collapsed, setCollapsed] = useState(() => getLayout().collapsed.summary);
  const reqId = useRef(0);
  const lastRange = useRef(null);

  const toggleCollapsed = () => setCollapsed((c) => { setCardCollapsed('summary', !c); return !c; });

  useEffect(() => {
    const id = ++reqId.current;
    // `flow.portfolio` is replaced several times in the background (initial build
    // → enrichment → pricing). Re-clearing the series on every one of those made
    // the chart visibly disappear and redraw each time. So only a user-initiated
    // RANGE change clears the curve up front (with the loading overlay); a
    // background portfolio refresh keeps the current curve on screen and swaps
    // the fresh values in place once they resolve. The reveal animation is keyed
    // on the series' timestamps (stable across value-only refreshes since the
    // history grid is aligned to fixed candle boundaries), so it replays only on
    // an actual range change — never on a background refresh.
    const rangeChanged = lastRange.current !== range;
    lastRange.current = range;
    if (rangeChanged) setSeries([]);
    setChartLoading(true);
    flow.loadHistory(range).then((s) => {
      if (id === reqId.current) { setSeries(s || []); setChartLoading(false); }
    }).catch(() => {
      // On failure drop the spinner; only clear the curve if this was a range
      // change (a failed background refresh leaves the existing curve intact).
      if (id === reqId.current) { if (rangeChanged) setSeries([]); setChartLoading(false); }
    });
  }, [range, flow.portfolio]); // eslint-disable-line react-hooks/exhaustive-deps

  const p = view;
  const delta = p?.change24h || { usd: 0, pct: 0 };
  const deltaPct = pct(delta.pct);
  const flat = deltaPct.cls === '';
  const up = delta.usd >= 0;
  const { dollars, cents } = usdParts(p?.total);
  const chainCount = p?.chains?.length || 0;
  const walletCount = p?.walletCount || 0;
  const chartRange = seriesMinMax(series);

  // Show the same "updating data…" chip the holdings card uses, and keep it up
  // until the WHOLE summary has settled — values priced AND the chart drawn — so
  // the total never appears to silently swap to live mid-refresh. Mirrors the
  // per-section refresh flags (holdings/defi feed the total) plus the chart load.
  const updating =
    flow.pricing || chartLoading || flow.refreshing?.holdings || flow.refreshing?.defi;

  // Confidential holdings split. Encrypted entries have an UNKNOWN amount, so
  // they are counted and never folded into a value — see analytics/portfolio.js.
  const shielded = p?.shielded || [];
  const revealedCount = shielded.filter((t) => t.state === 'revealed').length;
  const encryptedCount = shielded.filter((t) => t.state !== 'revealed').length;

  const revealAll = async () => {
    setSealMsg(null);
    setRevealing(true);
    try {
      await flow.revealAllShielded();
    } catch (e) {
      setSealMsg(String(e.message || e));
    } finally {
      setRevealing(false);
    }
  };

  return (
    <section className={`summary card card-pad${collapsed ? ' collapsed' : ''}`}>
      {/* Header row — always visible, mirrors assistant card style */}
      <div className="sum-head">
        <div className="label">
          Total portfolio value · {walletCount} wallet{walletCount === 1 ? '' : 's'} · {chainCount} chain{chainCount === 1 ? '' : 's'}
          {updating
            ? <span className="synced"><span className="mini-spin" />updating data…</span>
            : p?.priced && <span className="synced"><span className="livedot" />live prices</span>}
        </div>
        {collapsed && (
          <div className="sum-inline-val num">{dollars}<span className="sum-inline-cents">{cents}</span></div>
        )}
        <span className="spacer" />
        <button className="icon-btn" title={collapsed ? 'Expand' : 'Collapse'}
          aria-label={collapsed ? 'Expand portfolio details' : 'Collapse portfolio details'}
          onClick={toggleCollapsed}>
          <span className="chev"><IChevDown /></span>
        </button>
      </div>

      {/* Expanded body — left: total + breakdown, right: chart */}
      {!collapsed && (
        <div className="sum-body">
          <div className="sum-main">
            <div className="total num">{dollars}<span className="cents">{cents}</span></div>
            <div className="delta">
              <span className="period-24h">past 24h</span>
              <span className={`chip ${flat ? 'flat' : up ? 'up' : 'down'}`}>
                {flat ? <span className="chip-dash">–</span> : up ? <IArrowUp /> : <IArrowDown />}
                {usd(Math.abs(delta.usd))}<span className="delta-sep"> · </span>{pctAbs(delta.pct)}
              </span>
            </div>

            <div className="sum-breakdown">
              <div className="spark">
                <div className="blk"><div className="k">Public</div><div className="v num">{usd(p?.publicUsd)}</div></div>
                <div className="blk"><div className="k">DeFi</div><div className="v num">{usd(p?.defiUsd)}</div></div>
                {/* Shielded: revealed value only. Encrypted amounts are unknown
                    — not zero — so they are counted, never valued. The masked
                    "$•••••" is shown only while something is still encrypted. */}
                <div className="blk">
                  <div className="k">
                    Shielded
                    {encryptedCount > 0 && (
                      <button className="shield-btn" disabled={revealing || !flow.wallet}
                        title={
                          flow.wallet
                            ? `Reveal ${encryptedCount} encrypted balance${encryptedCount === 1 ? '' : 's'} — decrypted in this browser, one wallet signature per token`
                            : 'Connect a wallet to reveal confidential balances'
                        }
                        aria-label="Reveal all confidential balances"
                        onClick={revealAll}>
                        {revealing ? <span className="mini-spin" /> : <IUnlock />}
                      </button>
                    )}
                    {encryptedCount === 0 && revealedCount > 0 && (
                      <span className="shield-btn" title="All confidential balances revealed this session"><ILock /></span>
                    )}
                  </div>
                  <div className="shielded-val">
                    <div className="v num" style={{ color: 'var(--accent)' }}>
                      {revealedCount > 0 ? usd(p?.shieldedUsd) : encryptedCount > 0 ? '$•••••' : usd(0)}
                    </div>
                  </div>
                  {encryptedCount > 0 && (
                    <div className="muted" style={{ fontSize: '.72rem' }}>
                      {revealedCount > 0 ? `+ ${encryptedCount} still encrypted` : `${encryptedCount} encrypted`}
                    </div>
                  )}
                </div>
              </div>
              {sealMsg && <div className="muted" style={{ maxWidth: 220 }}>{sealMsg}</div>}
            </div>
          </div>

          <div className="sum-chart">
            <Sparkline series={series} loading={chartLoading} drawKey={range} />
            {chartRange && (
              <div className="chart-hl-col">
                <span className="chart-hl">H {usd(chartRange.max)}</span>
                <span className="chart-hl">L {usd(chartRange.min)}</span>
              </div>
            )}
            <div className="range">
              {RANGES.map((r) => (
                <button key={r} className={`rg${r === range ? ' on' : ''}`} onClick={() => setRange(r)}>{r}</button>
              ))}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
