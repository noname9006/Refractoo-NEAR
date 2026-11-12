// Live tests against the NEAR Intents API (Aurora). Need the partner key
// (AURORA_INTENTS_API_KEY in env or .env); skipped without it. They sign in
// with THROWAWAY keys generated here — no real wallet, nothing on-chain:
//   • NEP-413 from a fresh ed25519 key, as its implicit account (an implicit
//     account id is the hex of its own public key, so the key owns it by
//     definition);
//   • ERC-191 from a fresh random EVM wallet.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { ed25519 } from '@noble/curves/ed25519';
import { Wallet } from 'ethers';
import { nep413Hash, bytesToBase58, b64encode, implicitAccountId } from '../src/near/nep413.js';
import {
  nearIdentity, evmIdentity, loadConfidentialHoldings, setIntentsApiKeyForTests, clearIntentsSessions, setSaltProviderForTests,
} from '../src/near/confidentialIntents.js';

function readKey() {
  if (process.env.AURORA_INTENTS_API_KEY) return process.env.AURORA_INTENTS_API_KEY;
  try {
    const line = fs.readFileSync(new URL('../.env', import.meta.url), 'utf8').split(/\r?\n/)
      .find((l) => l.startsWith('AURORA_INTENTS_API_KEY=') || l.startsWith('VITE_AURORA_INTENTS_API_KEY='));
    return line ? line.slice(line.indexOf('=') + 1).trim() : '';
  } catch { return ''; }
}
const KEY = readKey();

// A local "wallet" that signs NEP-413 exactly as a NEAR wallet would.
function localNearWallet() {
  const priv = ed25519.utils.randomPrivateKey();
  const publicKey = `ed25519:${bytesToBase58(ed25519.getPublicKey(priv))}`;
  const accountId = implicitAccountId(publicKey);
  return {
    accountId,
    publicKey,
    signMessage: async ({ message, recipient, nonce }) => ({
      accountId,
      publicKey,
      signature: b64encode(ed25519.sign(nep413Hash({ message, nonce, recipient }), priv)), // base64, per spec
    }),
  };
}

test('nearIdentity refuses a signature that does not verify (nothing sent)', async () => {
  const w = localNearWallet();
  const bad = nearIdentity({ accountId: w.accountId, signMessage: async (p) => ({ ...(await w.signMessage(p)), signature: b64encode(new Uint8Array(64)) }) });
  await assert.rejects(bad.signedData(), /does not verify/);
  const other = nearIdentity({ accountId: 'alice.near', signMessage: w.signMessage });
  await assert.rejects(other.signedData(), /expected alice\.near/);
});

test('nearIdentity builds the documented nep413 signedData with a versioned nonce', async () => {
  setSaltProviderForTests(async () => Uint8Array.from([0x25, 0x28, 0x12, 0xb3]));
  const w = localNearWallet();
  const sd = await nearIdentity(w).signedData();
  assert.equal(sd.standard, 'nep413');
  assert.equal(sd.public_key, w.publicKey);
  assert.match(sd.signature, /^ed25519:[1-9A-HJ-NP-Za-km-z]+$/);
  assert.equal(sd.payload.recipient, 'intents.near');
  const n = Buffer.from(sd.payload.nonce, 'base64');
  assert.equal(n.length, 32);
  assert.equal(n.subarray(0, 5).toString('hex'), '5628f6c600');
  assert.equal(n.subarray(5, 9).toString('hex'), '252812b3');
  // nonce deadline (ns) == message deadline
  assert.equal(n.readBigUInt64LE(9), BigInt(Date.parse(JSON.parse(sd.payload.message).deadline)) * 1000000n);
  setSaltProviderForTests(undefined);
  const msg = JSON.parse(sd.payload.message);
  assert.equal(msg.signer_id, w.accountId);
  assert.deepEqual(msg.intents, []);
});

// The authoritative check, no keys needed: intents.near's own verifier
// (simulate_intents, a view call) must accept our NEP-413 sign-in payload.
test('live, no key: intents.near simulate_intents accepts our NEP-413 payload', { timeout: 30_000 }, async () => {
  const w = localNearWallet();
  const sd = await nearIdentity(w).signedData();
  const args = Buffer.from(JSON.stringify({ signed: [sd] })).toString('base64');
  const r = await fetch('https://rpc.mainnet.fastnear.com', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'query', params: { request_type: 'call_function', finality: 'final', account_id: 'intents.near', method_name: 'simulate_intents', args_base64: args } }),
  });
  const j = await r.json();
  assert.ok(!j.error && !j.result?.error, String(JSON.stringify(j.error || j.result?.error)).slice(0, 300));
  const out = JSON.parse(Buffer.from(j.result.result).toString());
  assert.equal(out.intents_executed?.[0]?.account_id, w.accountId);
});

test('live: NEP-413 sign-in is accepted and balances can be read', { skip: !KEY && 'no Intents API key', timeout: 60_000 }, async () => {
  setIntentsApiKeyForTests(KEY);
  clearIntentsSessions();
  const w = localNearWallet();
  const out = await loadConfidentialHoldings(nearIdentity(w));
  assert.equal(out.kind, 'near');
  assert.equal(out.address, w.accountId);
  assert.ok(Array.isArray(out.tokens)); // a fresh account holds nothing — the point is the 200
});

test('live: ERC-191 sign-in still works after the refactor', { skip: !KEY && 'no Intents API key', timeout: 60_000 }, async () => {
  setIntentsApiKeyForTests(KEY);
  clearIntentsSessions();
  const out = await loadConfidentialHoldings(Wallet.createRandom());
  assert.equal(out.kind, 'evm');
  assert.ok(Array.isArray(out.tokens));
});
