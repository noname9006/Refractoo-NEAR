import { getActiveProvider, setActiveProvider } from './evmWallets.js';
// Public on-chain data: ethers v6 + Etherscan V2 unified API.
//
// Privacy note: every RPC/explorer request reveals the queried address to that
// provider. Users can supply their own RPC URL per chain to control this.

import { BrowserProvider, JsonRpcProvider, FallbackProvider, formatEther } from 'ethers';
import { etherscanLimit } from '../utils/limit.js';
import { CHAINS } from '../config/networks.js';

// The chain list comes from the active network profile (mainnet or testnet) —
// see config/networks.js. Re-exported here because this has always been the
// import path for it, and every consumer still reads it from data/public.js.
//
// Each chain lists several public RPC endpoints. Public nodes flake constantly
// (ERR_CONNECTION_CLOSED, intermittent 5xx, per-IP rate limits); with a single
// endpoint one bad node blanks the whole chain. The list is ordered by
// preference and consumed by createChainProvider, which fails over across them.
// `rpc` mirrors the first entry for any caller that still reads a single URL.
export { CHAINS };

// Build a read provider for a chain with automatic endpoint failover.
//
// A user-supplied override is trusted on its own (no failover — it's their
// node, and silently shopping the address around to public fallbacks would
// defeat the privacy reason they set it). Otherwise we wrap every public
// endpoint in a FallbackProvider with quorum 1: the first endpoint to answer
// wins, and a dead/stalling node is skipped instead of failing the chain. The
// chainId is passed as the network so FallbackProvider skips its own
// eth_chainId probe (which would itself hit the flaky endpoints).
export function createChainProvider(chain, rpcOverride) {
  if (rpcOverride) {
    return new JsonRpcProvider(rpcOverride, chain.chainId, { staticNetwork: true });
  }
  const urls = chain.rpcs?.length ? chain.rpcs : [chain.rpc];
  if (urls.length === 1) {
    return new JsonRpcProvider(urls[0], chain.chainId, { staticNetwork: true });
  }
  const configs = urls.map((url, i) => ({
    provider: new JsonRpcProvider(url, chain.chainId, { staticNetwork: true }),
    priority: i + 1, // earlier in the list = tried first
    weight: 1,
    stallTimeout: 2500, // give up on a stalling endpoint and move on
  }));
  return new FallbackProvider(configs, chain.chainId, { quorum: 1 });
}

const ETHERSCAN_V2 = 'https://api.etherscan.io/v2/api';

// Some wallets (notably MetaMask in certain states) never settle the
// eth_requestAccounts promise if their popup is dismissed or stalls, leaving the
// UI on an infinite spinner. Race every connect call against a timeout so we
// surface an actionable error instead of hanging forever.
const CONNECT_TIMEOUT_MS = 60_000;
function withTimeout(promise, ms = CONNECT_TIMEOUT_MS) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new Error('Wallet did not respond. Open your wallet app, approve the request, then try again.')),
      ms
    );
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export async function connectWallet(eip1193 = getActiveProvider()) {
  if (!eip1193) {
    throw new Error('No web3 wallet detected. Install a browser wallet app to connect.');
  }
  setActiveProvider(eip1193);
  const provider = new BrowserProvider(eip1193);
  await withTimeout(provider.send('eth_requestAccounts', []));
  const signer = await provider.getSigner();
  const network = await provider.getNetwork();
  return {
    address: await signer.getAddress(),
    chainId: Number(network.chainId),
    provider,
    signer,
  };
}

// Like connectWallet, but opens the wallet's account picker so the user can
// authorize MORE THAN ONE account in a single step (plain eth_requestAccounts
// only ever returns the one currently-selected account). Returns every
// authorized address plus the active signer.
export async function requestWalletAccounts(eip1193 = getActiveProvider()) {
  if (!eip1193) {
    throw new Error('No web3 wallet detected. Install a browser wallet app to connect.');
  }
  setActiveProvider(eip1193);
  const provider = new BrowserProvider(eip1193);
  // Re-prompting permissions forces the multi-account chooser in MetaMask &
  // most wallets. Not all wallets support it — fall back silently.
  try {
    await withTimeout(provider.send('wallet_requestPermissions', [{ eth_accounts: {} }]));
  } catch (e) {
    if (e?.code === 4001) throw new Error('Connection request rejected.');
  }
  const accounts = await withTimeout(provider.send('eth_requestAccounts', []));
  const signer = await provider.getSigner();
  const network = await provider.getNetwork();
  return {
    accounts,
    address: await signer.getAddress(),
    chainId: Number(network.chainId),
    provider,
    signer,
  };
}

// rpcOverrides: { [chainId]: url } — user-supplied RPCs take precedence.
export async function fetchPublicData(address, { chains = CHAINS, rpcOverrides = {} } = {}) {
  const apiKey = import.meta.env.VITE_ETHERSCAN_KEY || '';
  const results = await Promise.allSettled(
    chains.map((chain) => fetchChainData(address, chain, rpcOverrides[chain.chainId], apiKey))
  );
  return {
    address,
    fetchedAt: new Date().toISOString(),
    chains: results.map((r, i) =>
      r.status === 'fulfilled'
        ? r.value
        : { chainId: chains[i].chainId, chainName: chains[i].name, error: String(r.reason) }
    ),
  };
}

// Fetch public data for every wallet in a cluster, in parallel.
// Returns { [address]: publicData }. A failed wallet yields an { error } entry.
export async function fetchClusterData(addresses, opts = {}) {
  const results = await Promise.allSettled(
    addresses.map((a) => fetchPublicData(a, opts))
  );
  const out = {};
  addresses.forEach((a, i) => {
    out[a] =
      results[i].status === 'fulfilled'
        ? results[i].value
        : { address: a, error: String(results[i].reason), chains: [] };
  });
  return out;
}

async function fetchChainData(address, chain, rpcOverride, apiKey) {
  const provider = createChainProvider(chain, rpcOverride);

  const [balanceWei, txCount] = await Promise.all([
    provider.getBalance(address),
    provider.getTransactionCount(address),
  ]);

  // Tx history is OPTIONAL enrichment. Etherscan rate-limiting (NOTOK) must never
  // fail the chain — that would discard its native + token balances in the
  // portfolio builder (which skips errored chains). So each call is best-effort.
  let recentTxs = [];
  let tokenTransfers = [];
  if (apiKey) {
    [recentTxs, tokenTransfers] = await Promise.all([
      etherscanList(chain.chainId, address, 'txlist', apiKey).catch(() => []),
      etherscanList(chain.chainId, address, 'tokentx', apiKey).catch(() => []),
    ]);
  }

  return {
    chainId: chain.chainId,
    chainName: chain.name,
    nativeBalance: formatEther(balanceWei),
    nativeSymbol: chain.symbol,
    txCount,
    recentTxs: recentTxs.slice(0, 25).map(simplifyTx),
    tokenTransfers: tokenTransfers.slice(0, 50).map(simplifyTokenTx),
  };
}

async function etherscanList(chainId, address, action, apiKey) {
  const url =
    `${ETHERSCAN_V2}?chainid=${chainId}&module=account&action=${action}` +
    `&address=${address}&startblock=0&endblock=latest&page=1&offset=100&sort=desc&apikey=${apiKey}`;

  // Throttled + retried: the free tier rate-limits bursts with status "0" /
  // message "NOTOK". Retry a couple of times with backoff before giving up.
  for (let attempt = 0; attempt < 3; attempt++) {
    const json = await etherscanLimit(async () => {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Etherscan ${action} HTTP ${res.status}`);
      return res.json();
    });
    if (json.status === '1') return Array.isArray(json.result) ? json.result : [];
    // A genuine empty result, not an error.
    if (/no transactions|no records/i.test(json.message || '')) return [];
    // Rate limited / transient — back off and retry.
    if (attempt < 2 && /notok|rate limit|max .* rate/i.test(`${json.message} ${json.result}`)) {
      await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
      continue;
    }
    throw new Error(`Etherscan ${action}: ${json.message || 'unknown error'}`);
  }
  return [];
}

function simplifyTx(tx) {
  return {
    hash: tx.hash,
    from: tx.from,
    to: tx.to,
    valueEth: formatEther(BigInt(tx.value || '0')),
    timestamp: Number(tx.timeStamp) * 1000,
    isError: tx.isError === '1',
    method: tx.functionName?.split('(')[0] || null,
  };
}

function simplifyTokenTx(tx) {
  const decimals = Number(tx.tokenDecimal || 18);
  return {
    hash: tx.hash,
    token: tx.tokenSymbol,
    tokenName: tx.tokenName,
    contract: tx.contractAddress,
    decimals,
    from: tx.from,
    to: tx.to,
    amount: Number(tx.value) / 10 ** decimals,
    timestamp: Number(tx.timeStamp) * 1000,
  };
}
