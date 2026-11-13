// Offline tests for the private-shard balance path, no API key and no network:
// the Intents API is replaced by a fake fetch. Covers
//   • parsing /api/account/balances rows (decimals, zero rows, unknown tokens,
//     token-list and history failures),
//   • the session cache (reuse, 401 → re-sign, no-prompt refresh),
//   • the whole way to the off-device prompt: rows → portfolio → facts →
//     pseudonymizeForRemote, checking what an external provider would see.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  loadConfidentialHoldings, refreshConfidentialHoldings, setIntentsApiKeyForTests, clearIntentsSessions,
  hasIntentsSession, SESSION_EXPIRED, STACK_ID,
} from '../src/near/confidentialIntents.js';
import { buildPortfolio, portfolioFacts } from '../src/analytics/portfolio.js';
import { pseudonymizeForRemote } from '../src/utils/pseudonymize.js';
import { demoIntentsHoldings } from '../src/near/demoFixtures.js';

const ACCOUNT = 'secret-holder.near';
const WNEAR = 'nep141:wrap.near';
const USDC = 'nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1';
const MYSTERY = 'nep141:some-very-long-unknown-token.near';
const TOKENS = [
  { assetId: WNEAR, symbol: 'wNEAR', blockchain: 'near', decimals: 24, price: 3.4 },
  { assetId: USDC, symbol: 'USDC', blockchain: 'near', decimals: 6, price: 1 },
];

// Fake Intents API. `state` lets a test change answers and inspect calls.
function fakeApi(over = {}) {
  const state = {
    calls: [],
    tokens: () => ({ status: 200, body: { tokens: TOKENS } }),
    balances: () => ({
      status: 200,
      body: {
        balances: [
          { tokenId: WNEAR, available: '20000000000000000000000' }, // 0.02 wNEAR
          { tokenId: USDC, available: '1234567890' }, // 1234.56789 USDC
          { tokenId: 'nep141:dust.near', available: '0' }, // filtered
          { tokenId: MYSTERY, available: '777' }, // no metadata
        ],
      },
    }),
    history: () => ({ status: 403, body: { message: 'invite-only for now' } }),
    ...over,
  };
  let tokenN = 0;
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(url);
    const auth = init.headers?.Authorization || null;
    state.calls.push({ path: u.pathname, method: init.method || 'GET', auth });
    let r;
    if (u.pathname.startsWith('/api/auth/authenticate/')) r = { status: 200, body: { accessToken: `tok${++tokenN}`, refreshToken: 'ref', expiresIn: 3600 } };
    else if (u.pathname.startsWith('/api/auth/refresh/')) r = { status: 200, body: { accessToken: `tok${++tokenN}`, expiresIn: 3600 } };
    else if (u.pathname.startsWith('/api/tokens/')) r = state.tokens();
    else if (u.pathname.startsWith('/api/account/balances/')) r = state.balances(auth);
    else if (u.pathname.startsWith('/api/account/history/')) r = state.history(auth);
    else r = { status: 404, body: null };
    return new Response(r.body == null ? '' : JSON.stringify(r.body), { status: r.status });
  };
  return state;
}

// An identity that "signs" without a wallet; counts how often it is asked.
function fakeIdentity(id = ACCOUNT) {
  const me = { kind: 'near', id, signs: 0, async signedData() { me.signs++; return { standard: 'nep413', fake: true }; } };
  return me;
}

const quiet = () => { const w = console.warn; console.warn = () => {}; return () => { console.warn = w; }; };

beforeEach(() => {
  setIntentsApiKeyForTests('test-key');
  clearIntentsSessions();
});

// Runs first on purpose: the token list is cached per page load once it loads.
test('token list down: balances still load, every row is an "error" row with raw units', async () => {
  fakeApi({ tokens: () => ({ status: 500, body: null }) });
  const restore = quiet();
  try {
    const out = await loadConfidentialHoldings(fakeIdentity());
    assert.equal(out.tokens.length, 3);
    for (const r of out.tokens) {
      assert.equal(r.state, 'error');
      assert.equal(r.amount, null);
      assert.equal(r.priceUsd, null);
      assert.match(r.error, /raw units/);
    }
    assert.equal(out.tokens[0].rawAmount, '20000000000000000000000');
  } finally { restore(); }
});

test('balances are parsed: decimals applied, zero rows dropped, ShieldedToken shape', async () => {
  fakeApi();
  const restore = quiet();
  try {
    const out = await loadConfidentialHoldings(fakeIdentity());
    assert.equal(out.kind, 'near');
    assert.equal(out.address, ACCOUNT);
    assert.equal(out.tokens.length, 3, 'the "0" balance is filtered');

    const [wnear, usdc] = out.tokens;
    assert.equal(wnear.amount, 0.02);
    assert.equal(wnear.symbol, 'wNEAR');
    assert.equal(wnear.decimals, 24);
    assert.equal(wnear.priceUsd, 3.4);
    assert.equal(wnear.rawAmount, '20000000000000000000000');
    assert.equal(usdc.amount, 1234.56789);

    for (const r of out.tokens) {
      assert.equal(r.stack, STACK_ID);
      assert.equal(r.chainId, 'near', 'must survive the dashboard chain filter');
      assert.equal(r.wallet, ACCOUNT);
      assert.equal(r.key, `${STACK_ID}:${r.address}:${ACCOUNT}`);
    }
  } finally { restore(); }
});

test('unknown token: shortened symbol, raw amount kept, never a guessed number', async () => {
  fakeApi();
  const restore = quiet();
  try {
    const out = await loadConfidentialHoldings(fakeIdentity());
    const m = out.tokens.find((t) => t.address === MYSTERY);
    assert.equal(m.state, 'error');
    assert.equal(m.amount, null);
    assert.equal(m.rawAmount, '777');
    assert.equal(m.symbol, 'some-v…near');
    assert.equal(m.name, MYSTERY);
  } finally { restore(); }
});

test('history "invite-only" error is not fatal: history is null, balances returned', async () => {
  fakeApi();
  const restore = quiet();
  try {
    const out = await loadConfidentialHoldings(fakeIdentity());
    assert.equal(out.history, null);
    assert.ok(out.tokens.length > 0);
  } finally { restore(); }
});

test('balances endpoint error propagates with its status', async () => {
  fakeApi({ balances: () => ({ status: 503, body: { message: 'shard unavailable' } }) });
  await assert.rejects(loadConfidentialHoldings(fakeIdentity()), (e) => e.status === 503 && /shard unavailable/.test(e.message));
});

test('session is reused: the second load does not ask the wallet again', async () => {
  const api = fakeApi({ history: () => ({ status: 200, body: { items: [{ id: 1 }] } }) });
  const id = fakeIdentity();
  await loadConfidentialHoldings(id);
  const out = await loadConfidentialHoldings(id);
  assert.equal(id.signs, 1);
  assert.equal(api.calls.filter((c) => c.path.startsWith('/api/auth/authenticate/')).length, 1);
  assert.deepEqual(out.history, [{ id: 1 }]);
  assert.ok(hasIntentsSession('near', ACCOUNT));
  // Every authed call carries the bearer token; the key is only in the path.
  for (const c of api.calls.filter((x) => x.path.startsWith('/api/account/'))) assert.match(c.auth, /^Bearer tok\d+$/);
});

test('a 401 on balances signs in once more and retries with the new token', async () => {
  let first = true;
  const api = fakeApi({
    balances: (auth) => {
      if (first) { first = false; return { status: 401, body: { message: 'expired' } }; }
      return { status: 200, body: { balances: [{ tokenId: USDC, available: '1000000' }] }, auth };
    },
  });
  const restore = quiet();
  try {
    const id = fakeIdentity();
    const out = await loadConfidentialHoldings(id);
    assert.equal(id.signs, 2);
    assert.equal(out.tokens[0].amount, 1);
    const bal = api.calls.filter((c) => c.path.startsWith('/api/account/balances/'));
    assert.deepEqual(bal.map((c) => c.auth), ['Bearer tok1', 'Bearer tok2']);
  } finally { restore(); }
});

test('refresh without a session throws SESSION_EXPIRED and sends nothing', async () => {
  const api = fakeApi();
  await assert.rejects(refreshConfidentialHoldings('near', ACCOUNT), (e) => e.code === SESSION_EXPIRED);
  assert.equal(api.calls.filter((c) => c.path.startsWith('/api/auth/') || c.path.startsWith('/api/account/')).length, 0);
});

test('refresh after sign-in reads balances without a wallet prompt', async () => {
  fakeApi();
  const restore = quiet();
  try {
    await loadConfidentialHoldings(fakeIdentity());
    const out = await refreshConfidentialHoldings('near', ACCOUNT);
    assert.equal(out.tokens[0].amount, 0.02);
  } finally { restore(); }
});

test('clearIntentsSessions forgets the session (next refresh needs a signature)', async () => {
  fakeApi();
  const restore = quiet();
  try {
    await loadConfidentialHoldings(fakeIdentity());
    clearIntentsSessions();
    assert.equal(hasIntentsSession('near', ACCOUNT), false);
    await assert.rejects(refreshConfidentialHoldings('near', ACCOUNT), (e) => e.code === SESSION_EXPIRED);
  } finally { restore(); }
});

test('no API key: refuses before any request', async () => {
  const api = fakeApi();
  setIntentsApiKeyForTests('');
  await assert.rejects(loadConfidentialHoldings(fakeIdentity()), /not configured/);
  assert.equal(api.calls.length, 0);
});

// --- Into the prompt ----------------------------------------------------------

async function privateRows() {
  fakeApi();
  const restore = quiet();
  try { return (await loadConfidentialHoldings(fakeIdentity())).tokens; } finally { restore(); }
}

test('portfolio: private-shard rows priced from the Intents list and counted in the total', async () => {
  const p = buildPortfolio({ shielded: await privateRows() });
  assert.ok(Math.abs(p.shieldedUsd - (0.02 * 3.4 + 1234.56789)) < 1e-9, String(p.shieldedUsd));
  assert.equal(p.total, p.shieldedUsd);
  const f = portfolioFacts(p).confidentialHoldings;
  assert.deepEqual(f.revealed.map((r) => r.asset).sort(), ['USDC', 'wNEAR']);
  assert.ok(f.revealed.every((r) => r.stack === 'near-intents'));
  assert.equal(f.encryptedCount, 0);
});

test('external tier: account name masked, private amounts rounded to 4 sig figs', async () => {
  const facts = {
    nearAccounts: [ACCOUNT],
    usdPortfolio: portfolioFacts(buildPortfolio({ shielded: await privateRows() })),
  };
  const r = pseudonymizeForRemote(facts, `how much does ${ACCOUNT} hold privately?`, { sigFigs: 4 });
  const sent = JSON.stringify(r.facts) + r.question;
  assert.ok(!sent.includes('secret-holder'), sent);
  assert.ok(!sent.includes('1234.57') && !sent.includes('1234.56'), 'exact private amount leaked: ' + sent);
  const usdc = r.facts.usdPortfolio.confidentialHoldings.revealed.find((x) => x.asset === 'USDC');
  assert.equal(usdc.amount, 1235);
  assert.equal(r.question, 'how much does WALLET_1 hold privately?');
  assert.equal(r.restore('WALLET_1 holds ~1,235 USDC'), `${ACCOUNT} holds ~1,235 USDC`);
});

test('TEE tier (sigFigs 0): amounts exact, account name still masked', async () => {
  const facts = { nearAccounts: [ACCOUNT], usdPortfolio: portfolioFacts(buildPortfolio({ shielded: await privateRows() })) };
  const r = pseudonymizeForRemote(facts, 'q');
  const usdc = r.facts.usdPortfolio.confidentialHoldings.revealed.find((x) => x.asset === 'USDC');
  assert.equal(usdc.amount, 1234.57); // portfolioFacts' own 6-sig-fig precision
  assert.ok(!JSON.stringify(r.facts).includes('secret-holder'));
});

test('encrypted (FHE) entries stay words, not numbers, after pseudonymization', () => {
  const shielded = [
    { stack: 'zama', chainId: 1, chainName: 'Ethereum', wallet: '0x' + '1'.repeat(40), symbol: 'cUSDC', state: 'encrypted', amount: null, underlying: null },
  ];
  const facts = { usdPortfolio: portfolioFacts(buildPortfolio({ shielded })) };
  const r = pseudonymizeForRemote(facts, 'q', { sigFigs: 2 });
  const [e] = r.facts.usdPortfolio.confidentialHoldings.encrypted;
  assert.equal(e.amount, 'ENCRYPTED — amount unknown');
  assert.equal(e.usd, 'ENCRYPTED — value unknown');
  assert.equal(r.facts.usdPortfolio.confidentialHoldings.encryptedCount, 1);
  assert.equal(r.facts.usdPortfolio.confidentialHoldings.revealedUsd, null);
});

test('demo sample rows keep their "sample" flag through pseudonymization', () => {
  const facts = { usdPortfolio: portfolioFacts(buildPortfolio({ shielded: demoIntentsHoldings('root.near') })) };
  const r = pseudonymizeForRemote(facts, 'q', { sigFigs: 4 });
  const rev = r.facts.usdPortfolio.confidentialHoldings.revealed;
  assert.equal(rev.length, 4);
  assert.ok(rev.every((x) => /DEMO SAMPLE/.test(x.sampleData)));
});
