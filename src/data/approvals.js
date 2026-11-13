// ERC-20 spending caps (token approvals) + revoke.
//
// Discovery uses Etherscan V2's "get logs by topics" (no contract address
// needed): filter Approval(owner, spender, value) by topic0 = event sig and
// topic1 = the owner. We then confirm each is still live via allowance() and
// flag unlimited ones. Without an Etherscan key we can't safely scan all-token
// logs on public RPCs, so caps are empty then (same tradeoff as tx history).
//
// Revoking sends approve(spender, 0) from the connected signer.

import { Contract, id, zeroPadValue, getAddress } from 'ethers';
import { findToken, CHAIN_SLUG } from './tokens.js';
import { createChainProvider } from './public.js';
import { etherscanLimit } from '../utils/limit.js';

const ETHERSCAN_V2 = 'https://api.etherscan.io/v2/api';
const APPROVAL_TOPIC = id('Approval(address,address,uint256)');
// Treat anything at/above 2^255 as "unlimited" (covers MaxUint256 sentinels).
const UNLIMITED = 1n << 255n;

const ERC20_ALLOWANCE = ['function allowance(address owner, address spender) view returns (uint256)'];
const ERC20_APPROVE = ['function approve(address spender, uint256 value) returns (bool)'];

// Returns [{ chainId, chainName, token, tokenSymbol, decimals, spender,
// allowance(bigint), unlimited, amountText, glyph, color, lastBlock }].
export async function fetchApprovals(owner, chain, rpcOverride) {
  const apiKey = import.meta.env.VITE_ETHERSCAN_KEY || '';
  if (!apiKey) return []; // can't reliably scan without it

  const url =
    `${ETHERSCAN_V2}?chainid=${chain.chainId}&module=logs&action=getLogs` +
    `&topic0=${APPROVAL_TOPIC}&topic0_1_opr=and&topic1=${zeroPadValue(owner, 32)}` +
    `&fromBlock=0&toBlock=latest&page=1&offset=1000&apikey=${apiKey}`;

  let logs;
  try {
    const json = await etherscanLimit(async () => {
      const res = await fetch(url);
      return res.json();
    });
    logs = Array.isArray(json.result) ? json.result : [];
  } catch (err) {
    console.warn(`[approvals] log scan failed on ${chain.name}:`, err?.message || err);
    return [];
  }

  // Keep the most recent log per (token, spender).
  const latest = new Map();
  for (const log of logs) {
    const token = (log.address || '').toLowerCase();
    const tk = findToken(chain.chainId, token);
    if (!tk) continue; // only surface known tokens (avoids approval spam)
    const spenderTopic = log.topics?.[2];
    if (!spenderTopic) continue;
    const spender = getAddress('0x' + spenderTopic.slice(26));
    const block = parseInt(log.blockNumber, 16) || 0;
    const key = `${token}:${spender.toLowerCase()}`;
    const prev = latest.get(key);
    if (!prev || block >= prev.block) {
      latest.set(key, { tk, spender, block, value: BigInt(log.data || '0x0') });
    }
  }
  if (!latest.size) return [];

  // Confirm each is still live on-chain (the log value can be stale).
  const provider = createChainProvider(chain, rpcOverride);
  const entries = [...latest.values()].slice(0, 40);
  const checked = await Promise.allSettled(
    entries.map(async (e) => {
      const c = new Contract(e.tk.address, ERC20_ALLOWANCE, provider);
      const current = await c.allowance(owner, e.spender);
      return { ...e, current };
    })
  );

  const out = [];
  for (const r of checked) {
    if (r.status !== 'fulfilled') continue;
    const { tk, spender, current, block } = r.value;
    if (current === 0n) continue; // revoked / never active
    const unlimited = current >= UNLIMITED;
    out.push({
      chainId: chain.chainId,
      chainName: chain.name,
      chainSlug: CHAIN_SLUG[chain.chainId],
      token: tk.address,
      tokenSymbol: tk.symbol,
      decimals: tk.decimals,
      glyph: tk.glyph,
      color: tk.color,
      owner,
      spender,
      allowance: current,
      unlimited,
      amountText: unlimited
        ? 'Unlimited'
        : `${(Number(current) / 10 ** tk.decimals).toLocaleString('en-US', { maximumFractionDigits: 2 })} ${tk.symbol}`,
      lastBlock: block,
    });
  }
  // Risky (unlimited) first, then largest.
  return out.sort((a, b) => Number(b.unlimited) - Number(a.unlimited));
}

// Sends approve(spender, 0) to revoke. Requires the chain-matching signer.
export async function revokeApproval(tokenAddress, spender, signer) {
  const c = new Contract(tokenAddress, ERC20_APPROVE, signer);
  const tx = await c.approve(spender, 0n);
  await tx.wait();
  return tx.hash;
}
