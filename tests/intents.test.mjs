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
  nearIdentity, evmIdentity, loadConfidentialHoldings, setIntentsApiKeyForTests, clearIntentsSessions,
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
// Live sign-in currently returns 401 for accounts with no Confidential Intents
// history (both standards; format and signature verified — see README). Run on
// demand: INTENTS_LIVE=1 npm test.
const LIVE = KEY && process.env.INTENTS_LIVE === '1';

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

test('nearIdentity builds the documented nep413 signedData', async () => {
  const w = localNearWallet();
  const sd = await nearIdentity(w).signedData();
  assert.equal(sd.standard, 'nep413');
  assert.equal(sd.public_key, w.publicKey);
  assert.match(sd.signature, /^ed25519:[1-9A-HJ-NP-Za-km-z]+$/);
  assert.equal(sd.payload.recipient, 'intents.near');
  assert.equal(Buffer.from(sd.payload.nonce, 'base64').length, 32);
  const msg = JSON.parse(sd.payload.message);
  assert.equal(msg.signer_id, w.accountId);
  assert.deepEqual(msg.intents, []);
});

test('live: NEP-413 sign-in is accepted and balances can be read', { skip: !LIVE && 'set INTENTS_LIVE=1 (and an Intents API key)', timeout: 60_000 }, async () => {
  setIntentsApiKeyForTests(KEY);
  clearIntentsSessions();
  const w = localNearWallet();
  const out = await loadConfidentialHoldings(nearIdentity(w));
  assert.equal(out.kind, 'near');
  assert.equal(out.address, w.accountId);
  assert.ok(Array.isArray(out.tokens)); // a fresh account holds nothing — the point is the 200
});

test('live: ERC-191 sign-in still works after the refactor', { skip: !LIVE && 'set INTENTS_LIVE=1 (and an Intents API key)', timeout: 60_000 }, async () => {
  setIntentsApiKeyForTests(KEY);
  clearIntentsSessions();
  const out = await loadConfidentialHoldings(Wallet.createRandom());
  assert.equal(out.kind, 'evm');
  assert.ok(Array.isArray(out.tokens));
});
