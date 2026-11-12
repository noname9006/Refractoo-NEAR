// Small presentation helpers shared by the dashboard cards.

// Chain display metadata + block-explorer roots come from the active network
// profile (see config/networks.js), so the chain pills and explorer links follow
// the mainnet/testnet mode automatically. Re-exported from here because that has
// always been where the dashboard imports them from.
import { CHAIN_META, EXPLORER } from '../../config/networks.js';

export { CHAIN_META, EXPLORER };

// Chain metadata for an id that may not be in the active profile (e.g. a cached
// holding from the other mode). Falls back to a neutral label instead of
// throwing on CHAIN_META[id].name.
export const chainMeta = (chainId) => CHAIN_META[chainId] || { name: `Chain ${chainId}`, cd: 'eth' };

export const shortAddr = (a) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '');

export const explorerTx = (chainId, hash) => (EXPLORER[chainId] && hash ? `${EXPLORER[chainId]}/${chainId === 'near' ? 'txns' : 'tx'}/${hash}` : null);
export const explorerAddr = (chainId, addr) => (EXPLORER[chainId] && addr ? `${EXPLORER[chainId]}/address/${addr}` : null);

// "$128,430.27" → { dollars: "$128,430", cents: ".27" } for the big total.
export function usdParts(n) {
  if (n == null || !isFinite(n)) return { dollars: '$—', cents: '' };
  const fixed = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const [whole, cents] = fixed.split('.');
  return { dollars: `${n < 0 ? '-' : ''}$${whole}`, cents: `.${cents}` };
}

// Compact USD, e.g. "$1,234" (no cents).
export function usd(n) {
  if (n == null || !isFinite(n)) return '—';
  return `${n < 0 ? '-' : ''}$${Math.abs(Math.round(n)).toLocaleString('en-US')}`;
}

// USD for token-holding rows. A space follows the "$" everywhere; small values
// keep cents so they're not all "$0".
//   ≥ $10    → "$ 1,234"  (whole dollars, grouped)
//   $1–$10   → "$ 4.57"   (two decimals)
//   < $1     → "$  .57"   (two spaces, cents only, no leading zero)
//   null/NaN → "—"
export function usdHolding(n) {
  if (n == null || !isFinite(n)) return '—';
  const sign = n < 0 ? '-' : '';
  const a = Math.abs(n);
  if (a >= 10) return `${sign}$ ${Math.round(a).toLocaleString('en-US')}`;
  if (a >= 1) return `${sign}$ ${a.toFixed(2)}`;
  return `${sign}$  ${a.toFixed(2).replace(/^0/, '')}`; // 0.57 → "$  .57"
}

// Per-unit token price shown in grey under a holding's value. Keeps enough
// precision for cheap tokens (sub-cent prices use the subscript-zero notation
// from amount()). Returns '' for missing/zero prices so the row stays clean.
export function tokenPrice(n) {
  if (n == null || !isFinite(n) || n === 0) return '';
  const a = Math.abs(n);
  if (a >= 1) return `$${a.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (a >= 1e-4) return `$${Number(a.toPrecision(3))}`;
  return `$${amount(a)}`;
}

export function usdFull(n) {
  if (n == null || !isFinite(n)) return '—';
  return `${n < 0 ? '-' : ''}$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const SUBS = '₀₁₂₃₄₅₆₇₈₉';
const toSub = (num) => String(num).split('').map((d) => SUBS[+d]).join('');

// Token amount: enough precision for small balances, grouped for large ones.
// Very small values use subscript-zero notation (e.g. 0.0₈1 for 1e-9) instead
// of ugly exponential strings like "1e-9".
export function amount(n) {
  if (n == null || !isFinite(n)) return '—';
  const abs = Math.abs(n);
  if (abs === 0) return '0';
  const sign = n < 0 ? '-' : '';
  if (abs >= 1000) return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (abs >= 1) return n.toLocaleString('en-US', { maximumFractionDigits: 4 });
  if (abs >= 1e-4) return `${sign}${Number(abs.toPrecision(3))}`;
  // Sub-0.0001: compress the run of leading zeros into a subscript count.
  const exp = Math.floor(Math.log10(abs)); // negative
  const zeros = -exp - 1;
  const mant = abs / 10 ** exp; // 1 ≤ mant < 10
  let sig = Number(mant.toPrecision(3)).toString().replace('.', '').replace(/0+$/, '');
  if (!sig) sig = '1';
  return `${sign}0.0${toSub(zeros)}${sig}`;
}

// Percent with sign + class. Returns { text, cls }. Rounds first so values
// that display as "0.0%" are treated as flat (grey), not pos/neg.
export function pct(n) {
  if (n == null || !isFinite(n)) return { text: '—', cls: '' };
  const rounded = Math.abs(n).toFixed(1);
  const flat = Number(rounded) === 0;
  const sign = flat ? '' : n > 0 ? '+' : '−';
  const cls = flat ? '' : n > 0 ? 'pos' : 'neg';
  return { text: `${sign}${rounded}%`, cls };
}

// Unsigned percent for places where direction is already shown another way
// (an up/down arrow, a colored chip) — avoids a redundant +/- sign.
export function pctAbs(n) {
  if (n == null || !isFinite(n)) return '—';
  return `${Math.abs(n).toFixed(1)}%`;
}

// Min/max of a portfolio value series, for the chart's H/L labels. Needs at
// least 2 finite points to be meaningful; returns null otherwise (no data yet).
export function seriesMinMax(series) {
  const vals = (series || []).filter((p) => isFinite(p.value)).map((p) => p.value);
  if (vals.length < 2) return null;
  return { min: Math.min(...vals), max: Math.max(...vals) };
}

export function timeAgo(ts) {
  const s = Math.max(0, (Date.now() - ts) / 1000);
  if (s < 60) return `${Math.round(s)}s ago`;
  const m = s / 60;
  if (m < 60) return `${Math.round(m)}m ago`;
  const h = m / 60;
  if (h < 24) return `${Math.round(h)}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

// NEAR Intents `blockchain` ids → display names (origin chain of a private-shard asset).
const ORIGIN_NAMES = {
  near: 'NEAR', eth: 'Ethereum', btc: 'Bitcoin', sol: 'Solana', zec: 'Zcash', arb: 'Arbitrum',
  base: 'Base', op: 'Optimism', pol: 'Polygon', bsc: 'BNB Chain', avax: 'Avalanche', tron: 'Tron',
  ton: 'TON', doge: 'Dogecoin', xrp: 'XRP Ledger', sui: 'Sui', aptos: 'Aptos', gnosis: 'Gnosis',
  bera: 'Berachain', stellar: 'Stellar', cardano: 'Cardano', ltc: 'Litecoin', bch: 'Bitcoin Cash',
};
export const originChainName = (b) => (b ? ORIGIN_NAMES[String(b).toLowerCase()] || String(b).toUpperCase() : 'NEAR');
