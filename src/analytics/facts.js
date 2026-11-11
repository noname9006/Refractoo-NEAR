// Deterministic analytics. Every number the LLM talks about is computed here
// in plain JS — the model narrates and explains, it never invents figures.
//
// MVP scope note: no price oracle is wired in, so there are no USD values and
// no true P&L. We compute token FLOWS (net in/out) and label them as such.
// Wiring a price feed would be another network call — a privacy tradeoff to
// decide explicitly later.

// shieldedForWallet: ShieldedToken[] belonging to THIS wallet (see
// data/shielded.js). Already narrowed by the caller.
export function buildFacts(publicData, shieldedForWallet = []) {
  const chains = (publicData?.chains ?? []).filter((c) => !c.error);
  const errors = (publicData?.chains ?? []).filter((c) => c.error);

  return {
    address: publicData?.address,
    dataNotes: [
      'No price feed: amounts are in native/token units, not USD.',
      'Token positions are NET FLOWS from recent transfer history, not verified balances.',
      ...errors.map((e) => `Chain ${e.chainName}: data unavailable (${truncate(e.error, 80)})`),
    ],
    nativeBalances: chains.map((c) => ({
      chain: c.chainName,
      balance: round(Number(c.nativeBalance), 6),
      symbol: c.nativeSymbol,
      txCount: c.txCount,
    })),
    tokenFlows: computeTokenFlows(chains, publicData?.address),
    activity: computeActivity(chains),
    riskFlags: computeRiskFlags(chains, publicData?.address),
    confidential: summarizeShielded(shieldedForWallet),
  };
}

// Confidential-token holdings for the prompt. Encrypted amounts are reported as
// an explicit string rather than null/0 — see the matching note in
// portfolio.js → portfolioFacts. An LLM will fill a null; it will not overwrite
// "ENCRYPTED — amount unknown".
function summarizeShielded(tokens = []) {
  if (!tokens.length) return { present: false };
  const entry = (t) => ({
    asset: t.symbol,
    stack: t.stack,
    chain: t.chainName,
    amount: t.state === 'revealed' ? round(Number(t.amount ?? 0), 6) : 'ENCRYPTED — amount unknown',
  });
  const revealed = tokens.filter((t) => t.state === 'revealed');
  const encrypted = tokens.filter((t) => t.state === 'encrypted');
  return {
    present: true,
    note:
      'Shielded balances are encrypted on-chain. Revealed entries were decrypted ' +
      'in this browser at the user\'s request; encrypted entries have an UNKNOWN ' +
      'amount that must never be guessed or treated as zero.',
    revealedCount: revealed.length,
    encryptedCount: encrypted.length,
    holdings: [...revealed, ...encrypted].map(entry),
  };
}

function computeTokenFlows(chains, address) {
  const flows = new Map();
  const addr = address?.toLowerCase();
  for (const chain of chains) {
    for (const t of chain.tokenTransfers ?? []) {
      const key = `${chain.chainName}:${t.token}`;
      const f = flows.get(key) ?? {
        chain: chain.chainName,
        token: t.token,
        tokenName: t.tokenName,
        inAmount: 0,
        outAmount: 0,
        transferCount: 0,
      };
      if (t.to?.toLowerCase() === addr) f.inAmount += t.amount;
      if (t.from?.toLowerCase() === addr) f.outAmount += t.amount;
      f.transferCount += 1;
      flows.set(key, f);
    }
  }
  return [...flows.values()]
    .map((f) => ({ ...f, netFlow: round(f.inAmount - f.outAmount, 6), inAmount: round(f.inAmount, 6), outAmount: round(f.outAmount, 6) }))
    .sort((a, b) => b.transferCount - a.transferCount)
    .slice(0, 20);
}

function computeActivity(chains) {
  const allTxs = chains.flatMap((c) => c.recentTxs ?? []);
  if (allTxs.length === 0) return { recentTxSample: 0 };
  const timestamps = allTxs.map((t) => t.timestamp).sort((a, b) => a - b);
  const failed = allTxs.filter((t) => t.isError).length;
  const methods = countBy(allTxs, (t) => t.method || 'transfer');
  return {
    recentTxSample: allTxs.length,
    oldestSampled: new Date(timestamps[0]).toISOString().slice(0, 10),
    newestSampled: new Date(timestamps[timestamps.length - 1]).toISOString().slice(0, 10),
    failedTxs: failed,
    topMethods: Object.entries(methods)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([method, count]) => ({ method, count })),
  };
}

function computeRiskFlags(chains, address) {
  const flags = [];
  const addr = address?.toLowerCase();

  for (const chain of chains) {
    const txs = chain.recentTxs ?? [];
    const failed = txs.filter((t) => t.isError).length;
    if (txs.length > 0 && failed / txs.length > 0.15) {
      flags.push(`${chain.chainName}: high failed-tx ratio (${failed}/${txs.length}) in recent sample`);
    }

    const approvals = txs.filter((t) => /^approve|^setApprovalForAll|^permit/i.test(t.method || ''));
    if (approvals.length > 0) {
      flags.push(`${chain.chainName}: ${approvals.length} recent approval tx(s) — review active allowances`);
    }

    // Dust/airdrop spam: many distinct unsolicited incoming token transfers
    const incoming = (chain.tokenTransfers ?? []).filter((t) => t.to?.toLowerCase() === addr);
    const tinyIncoming = incoming.filter((t) => t.amount > 0 && t.amount < 0.001);
    if (tinyIncoming.length >= 5) {
      flags.push(`${chain.chainName}: ${tinyIncoming.length} dust-sized incoming token transfers (possible airdrop spam/phishing bait — do not interact)`);
    }
  }

  const totalNative = chains.reduce((s, c) => s + Number(c.nativeBalance), 0);
  for (const chain of chains) {
    const share = totalNative > 0 ? Number(chain.nativeBalance) / totalNative : 0;
    if (share > 0.9 && chains.length > 1 && totalNative > 0.01) {
      flags.push(`Concentration: ${Math.round(share * 100)}% of native balance on ${chain.chainName}`);
    }
  }
  return flags;
}

const countBy = (arr, fn) =>
  arr.reduce((acc, x) => ((acc[fn(x)] = (acc[fn(x)] || 0) + 1), acc), {});
const round = (n, d) => Number(n.toFixed(d));
const truncate = (s, n) => (s.length > n ? s.slice(0, n) + '…' : s);

// Aggregate facts across a whole wallet cluster. clusterData: { address:
// publicData }. Reuses buildFacts() per wallet, then merges balances, token
// flows, risk flags (prefixed by wallet) and activity for the LLM prompt.
// shielded: the whole ShieldedToken[] for the cluster; narrowed per wallet here.
export function buildClusterFacts(clusterData, shielded = []) {
  const addresses = Object.keys(clusterData);
  const byWallet = new Map();
  for (const t of shielded) {
    const k = t.wallet.toLowerCase();
    if (!byWallet.has(k)) byWallet.set(k, []);
    byWallet.get(k).push(t);
  }
  // Spread first, then set `address` last so the cluster key is authoritative
  // (buildFacts also emits an `address`, which may be undefined for sparse data).
  const perWallet = addresses.map((address) => ({
    ...buildFacts(clusterData[address], byWallet.get(address.toLowerCase()) || []),
    address,
  }));

  const nativeAgg = new Map();
  const flowAgg = new Map();
  const riskFlags = [];

  for (const w of perWallet) {
    const short = `${w.address.slice(0, 6)}…${w.address.slice(-4)}`;
    for (const nb of w.nativeBalances) {
      const k = `${nb.chain}:${nb.symbol}`;
      const cur = nativeAgg.get(k) || { chain: nb.chain, symbol: nb.symbol, balance: 0, txCount: 0 };
      cur.balance += nb.balance;
      cur.txCount += nb.txCount;
      nativeAgg.set(k, cur);
    }
    for (const f of w.tokenFlows) {
      const k = `${f.chain}:${f.token}`;
      const cur =
        flowAgg.get(k) ||
        { chain: f.chain, token: f.token, tokenName: f.tokenName, inAmount: 0, outAmount: 0, netFlow: 0, transferCount: 0 };
      cur.inAmount += f.inAmount;
      cur.outAmount += f.outAmount;
      cur.netFlow += f.netFlow;
      cur.transferCount += f.transferCount;
      flowAgg.set(k, cur);
    }
    for (const flag of w.riskFlags) riskFlags.push(`[${short}] ${flag}`);
  }

  const confidentialWallets = perWallet
    .filter((w) => w.confidential?.present)
    .map((w) => ({ wallet: w.address, ...w.confidential }));

  return {
    walletCount: addresses.length,
    addresses,
    dataNotes: [...new Set(perWallet.flatMap((w) => w.dataNotes))],
    nativeBalances: [...nativeAgg.values()].map((x) => ({ ...x, balance: round(x.balance, 6) })),
    tokenFlows: [...flowAgg.values()]
      .map((x) => ({
        ...x,
        inAmount: round(x.inAmount, 6),
        outAmount: round(x.outAmount, 6),
        netFlow: round(x.netFlow, 6),
      }))
      .sort((a, b) => b.transferCount - a.transferCount)
      .slice(0, 20),
    activity: {
      totalRecentTxSampled: perWallet.reduce((s, w) => s + (w.activity?.recentTxSample || 0), 0),
      failedTxs: perWallet.reduce((s, w) => s + (w.activity?.failedTxs || 0), 0),
    },
    riskFlags,
    confidential: confidentialWallets.length ? confidentialWallets : { present: false },
    perWallet: perWallet.map((w) => ({
      address: w.address,
      nativeBalances: w.nativeBalances,
      txTotal: w.nativeBalances.reduce((s, b) => s + b.txCount, 0),
    })),
  };
}
