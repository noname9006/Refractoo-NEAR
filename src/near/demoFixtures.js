// Demo-mode sample data for the one NEAR feature that can't run without the
// visitor's own wallet + signature: Confidential Intents (private-shard)
// balances. Everything else in the demo is live public data.
//
// These rows are SAMPLE DATA. They are flagged `demo: true`, rendered with a
// "sample data" tag, and the card says so — they must never be mistaken for a
// real account's private balances.

export const DEMO_NEAR_ACCOUNT = 'root.near'; // public, has FTs + staking — read live

export function demoIntentsHoldings(wallet = 'demo') {
  const row = (tokenId, symbol, originChain, amount, priceUsd) => ({
    stack: 'near-intents',
    chainId: 'near',
    chainName: 'NEAR private shard',
    wallet,
    address: tokenId,
    symbol,
    name: `${symbol} (${originChain}) · sample`,
    decimals: null,
    originChain,
    underlying: null,
    handle: null,
    state: 'revealed',
    amount,
    priceUsd,
    rawAmount: null,
    error: null,
    demo: true,
    key: `near-intents:${tokenId}:${wallet}:demo`,
  });
  return [
    row('nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1', 'USDC', 'near', 1250, 1),
    row('nep141:wrap.near', 'wNEAR', 'near', 420, 3.4),
    row('nep141:btc.omft.near', 'BTC', 'btc', 0.0125, 101000),
    row('nep141:zec.omft.near', 'ZEC', 'zec', 3.2, 54),
  ];
}

// The demo shows the history state a real signed-in user gets today: the NEAR
// Intents API lists private-shard history by invitation only. No fake swaps.
export const DEMO_HISTORY_STATUS = { state: 'restricted', status: null, message: 'invite-only for now', demo: true };
