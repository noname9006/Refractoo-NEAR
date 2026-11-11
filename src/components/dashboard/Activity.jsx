import { useState, useEffect } from 'react';
import { amount, timeAgo, shortAddr, usdHolding, explorerTx, CHAIN_META } from './format.js';
import { IIn, IOut, ISwap, IArrowRight, IChevDown, IFlag } from './icons.jsx';
import { fetchHistoricalPrices } from '../../data/prices.js';
import { llamaKey, nativeFor } from '../../data/tokens.js';
import { PRICE_MODE } from '../../config/networks.js';
import { getLayout, setCardCollapsed, setLayout } from '../../storage/local.js';

const SMALL_USD = 0.01;

// Price key + transferred amount for a tx (null when there's nothing to value:
// zero-value contract calls, token transfers without a known contract).
function valueParts(tx) {
  if (tx.kind === 'token') {
    if (!tx.contract || !(tx.tokenAmount > 0)) return null;
    return { key: llamaKey(tx.chainId, tx.contract), amt: tx.tokenAmount };
  }
  const v = Number(tx.valueEth || 0);
  if (!(v > 0)) return null;
  return { key: nativeFor(tx.chainId).key, amt: v };
}

function SkeletonRows() {
  return (
    <>
      {[1, 2, 3, 4].map((i) => (
        <div className="skel-row" key={i}>
          <div className="skel" style={{ width: 32, height: 32, borderRadius: 9, flexShrink: 0 }} />
          <div className="skel-lines">
            <div className="skel skel-line" style={{ width: `${50 + (i % 3) * 14}%` }} />
            <div className="skel skel-line short" style={{ width: `${30 + (i % 2) * 16}%` }} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 5, flexShrink: 0 }}>
            <div className="skel skel-line" style={{ width: 60 }} />
            <div className="skel skel-line" style={{ width: 36 }} />
          </div>
        </div>
      ))}
    </>
  );
}

export default function Activity({ flow, selectedChains, selectedWallets, loading, updating }) {
  const [collapsed, setCollapsed] = useState(() => getLayout().collapsed.activity);
  const [usdMap, setUsdMap] = useState(() => new Map()); // "key@tsSec" → price at tx time
  const [loaded, setLoaded] = useState(false);           // historical fetch resolved
  const [addrFilter, setAddrFilter] = useState(null);    // lowercased address or null
  const [absTime, setAbsTime] = useState(() => getLayout().activityAbsTime); // show exact date/time for all rows
  const [showSmall, setShowSmall] = useState(false);

  const toggleCollapsed = () => setCollapsed((c) => { setCardCollapsed('activity', !c); return !c; });

  const cluster = flow.clusterData || {};
  const walletOn = (addr) => !selectedWallets || selectedWallets.size === 0 || selectedWallets.has(addr.toLowerCase());

  const txs = [];
  const seen = new Set();
  for (const addr of Object.keys(cluster)) {
    if (!walletOn(addr)) continue;
    const owner = addr.toLowerCase();
    for (const chain of cluster[addr]?.chains || []) {
      if (chain.error || !selectedChains.has(chain.chainId)) continue;
      for (const tx of chain.recentTxs || []) {
        txs.push({ ...tx, id: `n:${tx.hash}`, kind: 'native', chainId: chain.chainId, owner });
      }
      for (const tt of chain.tokenTransfers || []) {
        const dir = tt.to?.toLowerCase() === owner ? 'in' : tt.from?.toLowerCase() === owner ? 'out' : null;
        if (!dir) continue;
        const dedupe = `${tt.hash}|${(tt.token || '').toLowerCase()}|${tt.amount}|${dir}`;
        if (seen.has(dedupe)) continue;
        seen.add(dedupe);
        txs.push({
          kind: 'token', id: `t:${dedupe}`, chainId: chain.chainId, owner,
          hash: tt.hash, timestamp: tt.timestamp,
          dir, token: tt.token, tokenName: tt.tokenName, contract: tt.contract,
          tokenAmount: tt.amount, from: tt.from, to: tt.to,
        });
      }
    }
  }
  txs.sort((a, b) => b.timestamp - a.timestamp);

  // Fetch the USD value of each transaction at the moment it happened. Keyed on a
  // stable signature so it only refires when the underlying tx set changes.
  const sig = txs.slice(0, 60).map((t) => `${t.id}@${t.timestamp}`).join(',');
  useEffect(() => {
    const items = [];
    for (const tx of txs.slice(0, 60)) {
      const vp = valueParts(tx);
      if (vp) items.push({ key: vp.key, ts: Math.round(tx.timestamp / 1000) });
    }
    setLoaded(false);
    if (!items.length) { setUsdMap(new Map()); setLoaded(true); return; }
    let alive = true;
    fetchHistoricalPrices(items)
      .then((m) => { if (alive) setUsdMap(m); })
      .catch(() => {})
      .finally(() => { if (alive) setLoaded(true); });
    return () => { alive = false; };
  }, [sig]); // eslint-disable-line react-hooks/exhaustive-deps

  // The feed actually returned data. On a testnet profile most tokens have no
  // mainnet twin to price against, so "unpriced" carries no signal there —
  // gating on live pricing keeps the scam heuristic below from flagging every
  // legitimate testnet token (see PRICE_MODE in config/networks.js).
  const priced = usdMap.size > 0 && PRICE_MODE === 'live';
  const legUsd = (key, amt, ts) => {
    if (!key) return null;
    const p = usdMap.get(`${key}@${Math.round(ts / 1000)}`);
    return p != null ? amt * p : null;
  };

  // One entry per on-chain transaction (same hash) — a contract call and the
  // token transfers it triggered collapse into a single grouped row.
  const groupsMap = new Map();
  for (const tx of txs) {
    const g = groupsMap.get(tx.hash) || { hash: tx.hash, chainId: tx.chainId, owner: tx.owner, timestamp: tx.timestamp, native: null, tokens: [] };
    if (tx.kind === 'native') g.native = g.native || tx; else g.tokens.push(tx);
    g.timestamp = Math.max(g.timestamp, tx.timestamp);
    groupsMap.set(tx.hash, g);
  }

  const decorate = (g) => {
    const nativeTx = g.native;
    const method = nativeTx?.method || '';
    const nativeVal = Number(nativeTx?.valueEth || 0);
    const hasIn = g.tokens.some((t) => t.dir === 'in');
    const hasOut = g.tokens.some((t) => t.dir === 'out');
    const isSwap = /swap|exactInput|exactOutput/i.test(method) || (hasIn && hasOut);
    const isApprove = /approve|permit/i.test(method);
    const isExec = !!method && !isSwap && !isApprove;

    let out, counter;
    if (nativeTx) { out = nativeTx.from?.toLowerCase() === g.owner; counter = out ? nativeTx.to : nativeTx.from; }
    else { const t = g.tokens[0]; out = t?.dir === 'out'; counter = out ? t?.to : t?.from; }

    let title, Icon, cls;
    if (isSwap) { title = 'Swap'; Icon = ISwap; cls = 'swap'; }
    else if (isApprove) { title = 'Token approval'; Icon = IArrowRight; cls = 'exec'; }
    else if (isExec) { title = method; Icon = IArrowRight; cls = 'exec'; }
    else if (g.tokens.length === 1) { const t = g.tokens[0]; title = `${t.dir === 'out' ? 'Sent' : 'Received'} ${t.token || 'tokens'}`; Icon = t.dir === 'out' ? IOut : IIn; cls = t.dir === 'out' ? 'out' : 'in'; }
    else if (nativeVal > 0) { title = out ? 'Sent ETH' : 'Received ETH'; Icon = out ? IOut : IIn; cls = out ? 'out' : 'in'; }
    else if (g.tokens.length > 1) { title = 'Transfer'; Icon = IArrowRight; cls = 'exec'; }
    else { title = 'Contract interaction'; Icon = IArrowRight; cls = 'exec'; }

    // Value lines: native value (if any) + each token transfer.
    const legs = [];
    if (nativeVal > 0) legs.push({ key: nativeFor(g.chainId).key, amt: nativeVal, ts: nativeTx.timestamp, label: 'ETH', dir: out ? 'out' : 'in', contract: null });
    for (const t of g.tokens) {
      if (!(t.tokenAmount > 0)) continue;
      legs.push({ key: t.contract ? llamaKey(g.chainId, t.contract) : null, amt: t.tokenAmount, ts: t.timestamp, label: t.token || 'tokens', dir: t.dir, contract: t.contract });
    }
    for (const leg of legs) {
      leg.usd = legUsd(leg.key, leg.amt, leg.ts);
      leg.scam = !!leg.contract && priced && leg.usd == null; // ERC-20 unknown to the price feed
    }

    const isTransfer = legs.length > 0;
    const hasValue = legs.some((l) => l.usd != null && l.usd >= SMALL_USD);
    // No-value transfers (incl. tokens the feed doesn't know) are "small".
    const small = loaded && priced && isTransfer && !hasValue;
    const scam = loaded && priced && isTransfer && legs.some((l) => l.scam) && legs.every((l) => !l.contract || l.scam);

    const addrs = new Set();
    if (nativeTx) { nativeTx.from && addrs.add(nativeTx.from.toLowerCase()); nativeTx.to && addrs.add(nativeTx.to.toLowerCase()); }
    for (const t of g.tokens) { t.from && addrs.add(t.from.toLowerCase()); t.to && addrs.add(t.to.toLowerCase()); }

    return { g, title, Icon, cls, out, counter, legs, small, scam, addrs };
  };

  const decorated = [...groupsMap.values()].sort((a, b) => b.timestamp - a.timestamp).map(decorate);
  const smallCount = decorated.filter((d) => d.small).length;
  const visible = (showSmall ? decorated : decorated.filter((d) => !d.small)).slice(0, 12);

  const toggleAddr = (a) => setAddrFilter((cur) => (cur === a ? null : a));
  const toggleAbs = () => setAbsTime((v) => { setLayout({ activityAbsTime: !v }); return !v; });

  return (
    <section className={`card${collapsed ? ' collapsed' : ''}`}>
      <div className="card-h card-h-btn" onClick={toggleCollapsed}>
        <h3>Recent activity</h3>
        {updating && <span className="synced"><span className="mini-spin" />updating data…</span>}
        <span className="spacer" />
        {addrFilter && (
          <button className="addr-filter-clear" onClick={(e) => { e.stopPropagation(); setAddrFilter(null); }}>
            {shortAddr(addrFilter)} ✕
          </button>
        )}
        <span className="count">{decorated.length}</span>
        <button className="icon-btn" aria-label={collapsed ? 'Expand' : 'Collapse'}
          onClick={(e) => { e.stopPropagation(); toggleCollapsed(); }}>
          <span className="chev"><IChevDown /></span>
        </button>
      </div>

      {!collapsed && (
        <div className="list">
          {loading && decorated.length === 0 && <SkeletonRows />}
          {!loading && visible.length === 0 && decorated.length === 0 && (
            <div className="empty-note">No transaction history yet. Set <code className="mono">VITE_ETHERSCAN_KEY</code> to load activity (balances work without it).</div>
          )}
          {visible.map(({ g, title, Icon, cls, out, counter, legs, scam, addrs }) => {
            const counterLc = counter?.toLowerCase();
            const href = explorerTx(g.chainId, g.hash);
            const timeText = absTime ? new Date(g.timestamp).toLocaleString() : timeAgo(g.timestamp);
            const dimmed = addrFilter && !addrs.has(addrFilter);
            return (
              <div className={`tx${scam ? ' scam' : ''}${dimmed ? ' dimmed' : ''}`} key={g.hash}>
                <a className={`ic ${cls}`} href={href || undefined} target="_blank" rel="noreferrer"
                  title="View on block explorer"><Icon /></a>
                <div>
                  <div className="t1">{title}{scam && <span className="scam-flag" title="Unknown token — possible scam"><IFlag /></span>}</div>
                  <div className="t2">
                    <span className={`cd ${CHAIN_META[g.chainId]?.cd}`} style={{ width: 7, height: 7, borderRadius: '50%' }} />
                    {CHAIN_META[g.chainId]?.name}{counter ? <> · {out ? 'to' : 'from'}{' '}
                      <button className={`addr-link${addrFilter && counterLc === addrFilter ? ' on' : ''}`}
                        title="Filter by this address" onClick={() => toggleAddr(counterLc)}>{shortAddr(counter)}</button></> : null}
                  </div>
                </div>
                <div className="amt num">
                  {legs.map((leg, i) => {
                    const u = leg.usd != null ? usdHolding(leg.usd) : '';
                    return (
                      <span className="amt-line" key={i}>
                        {u && <span className="amt-usd-inline">{u}</span>}
                        <span className={`amt-tok${leg.dir === 'in' ? ' pos' : ''}${leg.scam ? ' scam-tok' : ''}`}>
                          {leg.dir === 'out' ? '−' : '+'}{amount(leg.amt)} {leg.label}
                        </span>
                      </span>
                    );
                  })}
                  <span className="when" title="Toggle exact time" onClick={toggleAbs}>{timeText}</span>
                </div>
              </div>
            );
          })}

          {smallCount > 0 && (
            <div className="small-toggle-row">
              <button className="small-toggle" onClick={() => setShowSmall((s) => !s)}>
                {showSmall ? 'Hide small transactions' : `Show small transactions (${smallCount})`}
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
