// Capture ONE real NEAR AI answer receipt into fixtures/nearai-receipt/.
// Runs the app's own NearAiContext (same code path as the browser): live
// attestation, E2EE chat, client.verifyResponse(), then exportReceipt().
// After this, tests/receipt.test.mjs verifies the fixture offline forever.
//
//   node spike/capture-receipt.mjs [model]
// Key: NEARAI_API_KEY from the environment or .env (gitignored). Never printed or saved.
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { NearAiContext, NEARAI_DEFAULT_MODEL, verificationChecks, exportReceipt } from '../src/near/nearAiContext.js';
import { pseudonymizeForRemote } from '../src/utils/pseudonymize.js';
import { buildAnalysisMessages } from '../src/prompts/wallet-analysis.js';
import { verifyReceiptBundle } from '../src/near/receiptBundle.js';

const key = process.env.NEARAI_API_KEY || (() => {
  try {
    const l = fs.readFileSync(new URL('../.env', import.meta.url), 'utf8').split(/\r?\n/).find((x) => x.startsWith('NEARAI_API_KEY='));
    return l ? l.slice(15).trim() : '';
  } catch { return ''; }
})();
if (!key) { console.error('NEARAI_API_KEY not set'); process.exit(2); }

const model = process.argv[2] || NEARAI_DEFAULT_MODEL;
const dir = new URL('../fixtures/nearai-receipt/', import.meta.url);
fs.mkdirSync(dir, { recursive: true });

// Real-looking identifiers that must NOT appear in what is sent (checked by the test).
const W1 = '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed';
const NEAR_ME = 'my-private-whale.near';
const facts = {
  walletCount: 2,
  addresses: [W1],
  nearAccounts: [{ account: NEAR_ME, holdings: [{ asset: 'NEAR', amount: 1523.77781, usd: 5180.84, stakedIn: 'astro-stakers.poolv1.near' }] }],
  nativeBalances: [{ chain: 'Ethereum', symbol: 'ETH', balance: 61.756612, txCount: 812 }],
};
const question = `In one sentence: what does ${W1} together with ${NEAR_ME} hold?`;
const p = pseudonymizeForRemote(facts, question, { sigFigs: 0 });
const messages = buildAnalysisMessages(p.facts, p.question);

const ctx = new NearAiContext();
const st = await ctx.initialize({ apiKey: key, model });
const res = await ctx.analyze(messages, () => {}, null, { thinking: false, maxTokens: 300 });
const receipt = res.verification;
const checks = verificationChecks(receipt);
const id = receipt?.response?.id;
if (!receipt?.response?.ok) { console.error('signature check failed live:', receipt?.response); process.exit(1); }

const bundle = await exportReceipt(id, receipt, model);
const offline = await verifyReceiptBundle(bundle);
if (!offline.ok) { console.error('offline re-check failed:', offline); process.exit(1); }

const write = (name, obj) => fs.writeFileSync(new URL(name, dir), JSON.stringify(obj, null, 2) + '\n');
write('receipt.json', bundle);
write('request-plaintext.json', {
  note: 'The messages array handed to the SDK before E2EE encryption. The signed requestBody in receipt.json is the encrypted wire form, so this file is NOT covered by the signature; it is kept to show what the model was asked.',
  model,
  messages,
  realIdentifiersHashed: [W1, NEAR_ME].map((x) => 'sha256:' + createHash('sha256').update(x.toLowerCase()).digest('hex')),
});
write('attestation.json', {
  note: 'Summary of the live attestation at capture time (gateway + model TDX, NVIDIA GPU evidence, nonce). Recorded, not re-verifiable offline: the raw quotes need Intel collateral and a fresh nonce.',
  capturedAt: bundle.capturedAt,
  attestation: st.attestation,
  liveChecks: checks.map(({ id, ok, detail }) => ({ id, ok, detail })),
});
const answer = res.text.replace(/\s+/g, ' ').trim();
fs.writeFileSync(new URL('README.md', dir), `# A real NEAR AI receipt

Captured ${bundle.capturedAt} from NEAR AI Cloud, model \`${model}\`, by
[\`spike/capture-receipt.mjs\`](../../spike/capture-receipt.mjs) running the app's own \`NearAiContext\`.

| File | What it is |
|---|---|
| \`receipt.json\` | Exact request/response bytes (base64), the enclave signature over them, the attested signer. Type \`${bundle.type}\`. |
| \`request-plaintext.json\` | The messages before E2EE encryption (not covered by the signature). |
| \`attestation.json\` | The live attestation summary and receipt checks at capture time. |

Signer (\`${bundle.kind}\`, ${bundle.signer?.signingAlgo}): \`${bundle.signer?.signingAddress}\`
SHA-256 of the response bytes: \`${bundle.sha256.responseBody}\`

Answer (restored locally would map WALLET_n back): "${answer.slice(0, 200)}"

## Verify offline

\`\`\`bash
node --test tests/receipt.test.mjs
\`\`\`

Or drop \`receipt.json\` on \`/app#/verify\` in the running app.

**Established offline:** these bytes were signed by that key; one flipped byte fails.
**Not established offline:** that the key is in a genuine TDX enclave *now*: that was checked live at capture
(\`attestation.json\`, all checks ${checks.every((c) => c.ok) ? 'passed' : 'NOT all passed'}). Re-proving it needs a fresh quote and nonce.
`);
console.log(`captured ${id} → fixtures/nearai-receipt/ · signer ${bundle.signer?.signingAddress} · live checks ${checks.filter((c) => c.ok).length}/${checks.length}`);
process.exit(0);
