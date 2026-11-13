// Key privacy claims, checked offline (no keys, no network):
//   A. The NEAR AI answer signature binds the exact request/response bytes:
//      change one byte anywhere and verification fails. These call the same
//      SDK functions client.verifyResponse() uses, with a locally generated
//      enclave key standing in for the attested one.
//   B. The prompt that leaves the device for an external API (the exact
//      messages array) contains no real identifier and no exact amount.
// NEP-413 payload + versioned nonce: tests/nep413.test.mjs and
// tests/intents.test.mjs. Private-shard balance parsing:
// tests/confidentialBalances.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Wallet, sha256 } from 'ethers';
import { ed25519 } from '@noble/curves/ed25519';
import { verifyModelResponse, verifyGatewayResponse } from '@nearai/inference-sdk';
import { pseudonymizeForRemote } from '../src/utils/pseudonymize.js';
import { buildAnalysisMessages } from '../src/prompts/wallet-analysis.js';
import { buildPortfolio, portfolioFacts } from '../src/analytics/portfolio.js';
import { demoIntentsHoldings } from '../src/near/demoFixtures.js';

// --- A. Response signature ----------------------------------------------------

const enc = (o) => new TextEncoder().encode(typeof o === 'string' ? o : JSON.stringify(o));
const h = (b) => sha256(b).slice(2);
const MODEL = 'deepseek-ai/DeepSeek-V3.1';
const REQ = enc({ model: MODEL, messages: [{ role: 'user', content: 'what does WALLET_1 hold?' }] });
const RES = enc({ id: 'chatcmpl-1', choices: [{ message: { role: 'assistant', content: 'WALLET_1 holds ~1,235 USDC.' } }] });

const flip = (bytes, i = bytes.length >> 1) => { const c = Uint8Array.from(bytes); c[i] ^= 0x01; return c; };
const flipHex = (hex, i = 10) => hex.slice(0, i) + (hex[i] === '0' ? '1' : '0') + hex.slice(i + 1);
const code = (fn) => { try { fn(); return 'ok'; } catch (e) { return e?.failure?.code || e?.code || e.message; } };

// An "enclave" ECDSA key; the attestation says this address is the TEE's.
const ecdsa = Wallet.createRandom();
async function ecdsaCase(kind, text) {
  return {
    signature: { kind, signer: { signingAlgo: 'ecdsa', signingAddress: ecdsa.address }, signedText: text, signature: await ecdsa.signMessage(text) },
    attestation: { signer: { signingAlgo: 'ecdsa', signingAddress: ecdsa.address } },
  };
}

test('A1. provider_tee signature over the exact bytes verifies', async () => {
  const { signature, attestation } = await ecdsaCase('provider_tee', `${MODEL}:${h(REQ)}:${h(RES)}`);
  assert.equal(code(() => verifyModelResponse({ requestBody: REQ, responseBody: RES, signature, attestation })), 'ok');
});

test('A2. one flipped byte in the answer, the request or the signature → rejected', async () => {
  const { signature, attestation } = await ecdsaCase('provider_tee', `${MODEL}:${h(REQ)}:${h(RES)}`);
  const v = (o) => code(() => verifyModelResponse({ requestBody: REQ, responseBody: RES, signature, attestation, ...o }));
  // every byte position of the answer
  for (let i = 0; i < RES.length; i++) assert.equal(v({ responseBody: flip(RES, i) }), 'signature.payload_mismatch', `answer byte ${i}`);
  assert.equal(v({ requestBody: flip(REQ) }), 'signature.payload_mismatch');
  assert.equal(v({ signature: { ...signature, signature: flipHex(signature.signature, 20) } }), 'signature.invalid');
});

test('A3. a valid signature from a key the attestation did not vouch for → rejected', async () => {
  const { signature } = await ecdsaCase('provider_tee', `${MODEL}:${h(REQ)}:${h(RES)}`);
  const otherTee = { signer: { signingAlgo: 'ecdsa', signingAddress: Wallet.createRandom().address } };
  assert.equal(code(() => verifyModelResponse({ requestBody: REQ, responseBody: RES, signature, attestation: otherTee })), 'signature.signer_mismatch');
});

test('A4. signed text forged to match tampered bytes, but not re-signed → rejected', async () => {
  const { signature, attestation } = await ecdsaCase('provider_tee', `${MODEL}:${h(REQ)}:${h(RES)}`);
  const bad = flip(RES);
  const forged = { ...signature, signedText: `${MODEL}:${h(REQ)}:${h(bad)}` };
  assert.equal(code(() => verifyModelResponse({ requestBody: REQ, responseBody: bad, signature: forged, attestation })), 'signature.invalid');
});

test('A5. gateway (ed25519) signature: valid passes, tampered answer fails', () => {
  const priv = ed25519.utils.randomPrivateKey();
  const pub = Buffer.from(ed25519.getPublicKey(priv)).toString('hex');
  const text = `${h(REQ)}:${h(RES)}`;
  const signature = { kind: 'gateway', signer: { signingAlgo: 'ed25519', signingAddress: pub }, signedText: text, signature: Buffer.from(ed25519.sign(enc(text), priv)).toString('hex') };
  const attestation = { signer: { signingAlgo: 'ed25519', signingAddress: pub } };
  assert.equal(code(() => verifyGatewayResponse({ requestBody: REQ, responseBody: RES, signature, attestation })), 'ok');
  assert.equal(code(() => verifyGatewayResponse({ requestBody: REQ, responseBody: flip(RES), signature, attestation })), 'signature.payload_mismatch');
  assert.equal(code(() => verifyModelResponse({ requestBody: REQ, responseBody: RES, signature, attestation })), 'signature.kind_mismatch');
});

// --- B. What leaves the device ---------------------------------------------------

const W1 = '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed';
const W2 = '0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359';
const SPENDER = '0x1111111254EEB25477B68fb85Ed929f73A960582';
const TXH = '0x' + '9f'.repeat(32);
const NEAR_ME = 'my-private-whale.near';
const IMPLICIT = 'e'.repeat(64);

function realisticFacts() {
  return {
    walletCount: 3,
    addresses: [W1, W2],
    nearAccounts: [{ account: NEAR_ME, holdings: [{ asset: 'NEAR', amount: 1523.77781, usd: 5180.84, stakedIn: 'astro-stakers.poolv1.near' }] }],
    dataNotes: ['note'],
    nativeBalances: [{ chain: 'Ethereum', symbol: 'ETH', balance: 61.756612, txCount: 812 }],
    tokenFlows: [{ chain: 'Ethereum', token: 'USDC', inAmount: 48211.337, outAmount: 1200.5, netFlow: 47010.837, transferCount: 37 }],
    riskFlags: [`[${W1.slice(0, 6)}…${W1.slice(-4)}] unlimited approval to ${SPENDER}`, `failed tx ${TXH}`, `received from ${IMPLICIT}`],
    perWallet: [{ address: W1, txTotal: 812 }, { address: W2, txTotal: 3 }],
    usdPortfolio: portfolioFacts(buildPortfolio({ shielded: demoIntentsHoldings(NEAR_ME) })),
    activity: { oldestSampled: '2026-03-14T10:22:31Z' },
  };
}
const QUESTION = `Compare ${W1} with ${W2.toLowerCase()} and My-Private-Whale.NEAR — did ${SPENDER} drain anything?`;
const IDENTIFIERS = [W1, W2, SPENDER, TXH, NEAR_ME, IMPLICIT, 'astro-stakers'];
const EXACT_AMOUNTS = ['61.756612', '61.7566', '48211.337', '47010.837', '1523.77781', '5180.84'];

test('B1. external tier: the exact messages sent contain no real identifier', () => {
  const r = pseudonymizeForRemote(realisticFacts(), QUESTION, { sigFigs: 4 });
  const wire = JSON.stringify(buildAnalysisMessages(r.facts, r.question)).toLowerCase();
  for (const id of IDENTIFIERS) {
    const l = id.toLowerCase();
    assert.ok(!wire.includes(l), `leaked ${id}`);
    if (l.startsWith('0x')) {
      assert.ok(!wire.includes(l.slice(2, 10)), `leaked head of ${id}`);
      assert.ok(!wire.includes(`${l.slice(0, 6)}…${l.slice(-4)}`), `leaked short form of ${id}`);
    }
  }
  // Nothing address-shaped is left at all.
  assert.doesNotMatch(wire, /0x[0-9a-f]{8}/);
  assert.doesNotMatch(wire, /\b[0-9a-f]{64}\b/);
  assert.doesNotMatch(wire, /[a-z0-9_-]+\.(near|tg)\b/);
});

test('B2. external tier: amounts reach the API at 4 significant figures, never exact', () => {
  const r = pseudonymizeForRemote(realisticFacts(), QUESTION, { sigFigs: 4 });
  const wire = JSON.stringify(buildAnalysisMessages(r.facts, r.question));
  for (const a of EXACT_AMOUNTS) assert.ok(!wire.includes(a), `exact amount ${a} sent`);
  const f = r.facts;
  assert.equal(f.nativeBalances[0].balance, 61.76);
  assert.equal(f.tokenFlows[0].netFlow, 47010);
  assert.equal(f.nearAccounts[0].holdings[0].amount, 1524);
  assert.equal(f.nativeBalances[0].txCount, 812, 'counts identify nothing; kept exact');
  assert.equal(f.activity.oldestSampled, '2026-03');
  // Every number in the payload has ≤ 4 significant figures, except count keys.
  const walk = (v, k = '') => {
    if (typeof v === 'number' && v !== 0 && !/(count|Count|txTotal|Pct|pct)$/.test(k)) {
      const sig = String(Math.abs(v)).replace('.', '').replace(/^0+/, '').replace(/0+$/, '').length;
      assert.ok(sig <= 4, `${k}=${v} has ${sig} significant figures`);
    } else if (v && typeof v === 'object') for (const [kk, x] of Object.entries(v)) walk(x, Array.isArray(v) ? k : kk);
  };
  walk(f);
  assert.match(f.dataNotes[0], /rounded to 4 significant figures/);
});

test('B3. the answer is mapped back locally to the user\'s real identifiers', () => {
  const r = pseudonymizeForRemote(realisticFacts(), QUESTION, { sigFigs: 4 });
  assert.equal(r.question, 'Compare WALLET_1 with WALLET_2 and WALLET_3 — did ADDR_1 drain anything?');
  assert.equal(r.restore('WALLET_1 and WALLET_3 look safe; ADDR_1 is a router.'),
    `${W1.slice(0, 6)}…${W1.slice(-4)} and ${NEAR_ME} look safe; ${SPENDER.slice(0, 6)}…${SPENDER.slice(-4)} is a router.`);
});
