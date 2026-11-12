import { test } from 'node:test';
import assert from 'node:assert/strict';
import { roundSig, createPseudonymizer, pseudonymizeForRemote, privacyNote, precisionFor } from '../src/utils/pseudonymize.js';

const W1 = '0xF356aBcDeF0123456789abcdef0123456789a1bf';
const W2 = '0xcccf00000000000000000000000000000000c26c';
const OTHER = '0x1111111111111111111111111111111111112222';
const TX = '0x' + 'ab'.repeat(32);

test('roundSig keeps N significant figures (default 4)', () => {
  assert.equal(roundSig(61.7566, 3), 61.8);
  assert.equal(roundSig(61.7566), 61.76); // default 4
  assert.equal(roundSig(124515, 3), 125000);
  assert.equal(roundSig(124515, 4), 124500);
  assert.equal(roundSig(0.000501234, 3), 0.000501);
  assert.equal(roundSig(-3.3712, 3), -3.37);
  assert.equal(roundSig(0), 0);
  assert.equal(roundSig(0.1 + 0.2, 3), 0.3);
});

test('identifiers become stable placeholders; cluster wallets are WALLET_n', () => {
  const p = createPseudonymizer([W1, W2]);
  const s = p.text(`from ${OTHER} to ${W2.toLowerCase()} in ${TX}, again ${OTHER}`);
  assert.equal(s, 'from ADDR_1 to WALLET_2 in TX_1, again ADDR_1');
  assert.doesNotMatch(s, /0x[0-9a-f]{6}/i);
});

test('short "0x1234…abcd" forms resolve to the same wallet label', () => {
  const p = createPseudonymizer([W1]);
  assert.equal(p.text('[0xF356…a1bf] 3 recent approval tx(s)'), '[WALLET_1] 3 recent approval tx(s)');
  assert.equal(p.text('from 0x9999...8888'), 'from ADDR_1');
});

test('NEAR named and implicit accounts are replaced', () => {
  const p = createPseudonymizer(['randomname1001.near']);
  assert.equal(p.text('owner randomname1001.near pays bob.sub.near'), 'owner WALLET_1 pays NEAR_1');
  assert.equal(p.text('implicit ' + 'c'.repeat(64)), 'implicit NEAR_2');
});

test('value(): rounds amounts, keeps counts and percents, coarsens dates', () => {
  const p = createPseudonymizer([W1], { sigFigs: 3 });
  const out = p.value({
    address: W1,
    holdings: [{ asset: 'ETH', amount: 61.7566, usd: 124515, change24hPct: -3.37 }],
    activity: { recentTxSample: 1234, failedTxs: 2, txCount: 1234, oldestSampled: '2026-03-14' },
    confidential: { amount: 'ENCRYPTED — amount unknown', encryptedCount: 1 },
  });
  assert.equal(out.address, 'WALLET_1');
  assert.deepEqual(out.holdings[0], { asset: 'ETH', amount: 61.8, usd: 125000, change24hPct: -3.37 });
  assert.equal(out.activity.txCount, 1234);
  assert.equal(out.activity.oldestSampled, '2026-03');
  assert.equal(out.confidential.amount, 'ENCRYPTED — amount unknown');
});

test('restore() maps placeholders back, tolerant of model spelling, no prefix collisions', () => {
  const addrs = Array.from({ length: 12 }, (_, i) => '0x' + String(i + 1).padStart(40, '0'));
  const p = createPseudonymizer(addrs);
  const out = p.restore('WALLET_1, Wallet 12 and wallet_2; WALLET_99 unknown');
  assert.equal(out, '0x0000…0001, 0x0000…0012 and 0x0000…0002; WALLET_99 unknown');
});

test('restore() leaves prose like "NEAR 2" / "TX 1" alone but maps NEAR_2', () => {
  const p = createPseudonymizer([]);
  p.text('a.near b.near'); // NEAR_1, NEAR_2
  assert.equal(p.restore('stake NEAR 2 times, TX 1 failed; NEAR_2 sent'), 'stake NEAR 2 times, TX 1 failed; b.near sent');
});

test('pseudonymizeForRemote: nothing identifying survives the JSON, question too', () => {
  const facts = {
    addresses: [W1, W2],
    dataNotes: ['note'],
    riskFlags: [`[0xF356…a1bf] Sepolia: 1 recent approval tx(s)`],
    perWallet: [{ address: W1, nativeBalances: [{ balance: 61.7566 }] }],
    usdPortfolio: { totalUsd: 140439.79 },
  };
  const r = pseudonymizeForRemote(facts, `what about ${W1} and 0xF356…a1bf?`, { sigFigs: 4 });
  const json = JSON.stringify(r.facts) + r.question;
  for (const leak of [W1.toLowerCase().slice(2, 10), 'f356', 'a1bf', 'c26c', '61.7566', '140439']) {
    assert.ok(!json.toLowerCase().includes(leak), `leaked ${leak}: ${json}`);
  }
  assert.ok(json.includes('61.76') && json.includes('140400'), json);
  assert.equal(r.facts.dataNotes[0], privacyNote(4));
  assert.match(r.facts.dataNotes[0], /4 significant figures/);
  assert.equal(r.question, 'what about WALLET_1 and WALLET_1?');
  assert.equal(r.restore('WALLET_1 is fine'), '0xF356…a1bf is fine');
  assert.deepEqual(facts.addresses, [W1, W2], 'input not mutated');
});

test('sigFigs 0 (TEE default): identifiers replaced, numbers and dates exact', () => {
  const facts = { addresses: [W1], usdPortfolio: { totalUsd: 140439.79 }, activity: { oldestSampled: '2026-03-14' } };
  const r = pseudonymizeForRemote(facts, `about ${W1}`);
  assert.equal(r.facts.usdPortfolio.totalUsd, 140439.79);
  assert.equal(r.facts.activity.oldestSampled, '2026-03-14');
  assert.equal(r.facts.addresses[0], 'WALLET_1');
  assert.doesNotMatch(r.facts.dataNotes[0], /rounded|approximate/);
});

test('precisionFor: defaults TEE exact, external 4; respects valid prefs only', () => {
  assert.equal(precisionFor({}, 'nearai'), 0);
  assert.equal(precisionFor({}, 'external'), 4);
  assert.equal(precisionFor({ roundRemote: { nearai: 3 } }, 'nearai'), 3);
  assert.equal(precisionFor({ roundRemote: { external: 0 } }, 'external'), 0);
  assert.equal(precisionFor({ roundRemote: { external: 7 } }, 'external'), 4);
});
