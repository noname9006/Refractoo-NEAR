# For judges: check the claims yourself

Refractoo makes privacy claims. This page maps each one to the code that
implements it and the test that proves it, so you can verify them in a few
minutes instead of taking them on trust.

## One command, one file, one hash

```bash
npm ci
npm run verify:evidence
```

Runs the offline suite (140 tests, about 11 seconds, no keys, no network) and checks
every claim in [`evidence/manifest.json`](evidence/manifest.json) against it. A test the
manifest names that is missing from the run fails the claim, so a deleted test cannot
pass quietly. It writes `evidence/run-<date>.json` with the commit, a dirty-tree flag,
the Node version, the SHA-256 of every input file, the status of each claim, and the
list of what is **not** established, then prints the SHA-256 of that file.
`node scripts/verify-evidence.mjs --check evidence/run-<date>.json` tells you whether
your checkout still matches a recorded run.

Recorded run in the repo: [`evidence/run-2026-11-14.json`](evidence/run-2026-11-14.json),
commit `5c02fb5`, clean tree, 21/21 claims, 140/140 tests, canonical SHA-256
`ddc616e50df3170fa0b839b7d55dfb291f0332423b20869dcc4fd3f24358243d`.
Negative control: rename or delete any test the manifest names and the run fails with
`missing: <test name>` and exit code 1.

**Not just on our machine:** [the `evidence` workflow](.github/workflows/evidence.yml) re-runs
the claims, the guard matrix and the live signer check on GitHub's runners on every push,
and keeps the JSON as a run artifact ([Actions → evidence](https://github.com/noname9006/Refractoo-NEAR/actions/workflows/evidence.yml)).

What we do **not** claim is in [LIMITS.md](LIMITS.md).

Plain tests only: `npm run test:offline`. That is 140 tests, about 11 seconds. `npm test` additionally runs the `live:` tests
against public endpoints (NEAR RPC, `intents.near`, the NEAR AI gateway); the
ones that need a NEAR AI or Intents API key skip themselves without one.

To see the features rather than the tests: [README → Try it in 3 minutes](README.md#try-it-in-3-minutes--no-wallet-no-keys).

## Claim → code → test

### Private AI (NEAR AI TEE)

| Claim | Code | Test |
|---|---|---|
| Every answer is signed inside the attested enclave, over the exact request and response bytes: flip any single byte of the answer, the request or the signature and verification fails | `client.verifyResponse()` → `verifyModelResponse` in `@nearai/inference-sdk`, called from [`nearAiContext.js`](src/near/nearAiContext.js) `analyze()` | [`claims.test.mjs`](tests/claims.test.mjs) A1–A5 |
| **See it yourself:** "Simulate tampered answer" on a Verified receipt re-runs the SDK's own signature check on that answer's exact bytes, as received (✓) and with one byte flipped (✗ `signature.payload_mismatch`); the receipt turns red. Nothing is faked and nothing is sent; the bytes stay in memory only | `tamperTest()` in [`nearAiContext.js`](src/near/nearAiContext.js), `VerifiedPanel` in [`Assistant.jsx`](src/components/dashboard/Assistant.jsx) | [`tamper.test.mjs`](tests/tamper.test.mjs); live: `nearai.test.mjs` "verified E2EE stream…" |
| **A real NEAR AI answer, verifiable by anyone, offline.** [`fixtures/nearai-receipt/`](fixtures/nearai-receipt/) holds one answer captured from NEAR AI Cloud: the exact request/response bytes, the enclave's signature and the attested signer. The test pins that signer, verifies with the SDK, and requires a flipped byte, a swapped signer and a forged signature to fail. The prompt it answered contains no real identifier | [`receiptBundle.js`](src/near/receiptBundle.js), captured by [`spike/capture-receipt.mjs`](spike/capture-receipt.mjs) | [`receipt.test.mjs`](tests/receipt.test.mjs) (5 tests) |
| **Save receipt / verify it yourself:** under a Verified answer, **Save receipt** downloads that answer's bytes and signature as JSON. Drop it on **`/verify`** (or click "Check the sample receipt"): the browser re-runs the signature check, flips one byte as a control, and says separately what is established and what is not | `exportReceipt()` in [`nearAiContext.js`](src/near/nearAiContext.js), [`VerifyReceipt.jsx`](src/components/VerifyReceipt.jsx) | same verifier as `receipt.test.mjs` |
| **That receipt's signer is an attested enclave key *right now*.** "Check signer against NEAR AI now" on `/verify` fetches fresh model attestations with a new nonce (no API key), verifies each Intel TDX quote and NVIDIA GPU report in the browser, and requires the receipt's signer among them. A swapped signer finds no match | `checkSignerLive()` in [`receiptBundle.js`](src/near/receiptBundle.js) | `receipt.test.mjs` live: "the receipt signer is an attested NEAR AI enclave key right now"; CI |
| A valid signature from a key the attestation did not vouch for is rejected | same | `claims.test.mjs` A3 |
| The "Verified" receipt fails if any one link is weak (gateway TDX, model TDX, NVIDIA GPU evidence, fresh nonce, E2EE, signature) | `verificationChecks()` in [`nearAiContext.js`](src/near/nearAiContext.js) | [`nearai.test.mjs`](tests/nearai.test.mjs) "verificationChecks: …" |
| NVIDIA attestation verdicts are checked with a bounded clock tolerance, and a nonce mismatch or negative verdict is rejected | [`nrasVerifier.js`](src/near/nrasVerifier.js) | `nearai.test.mjs` "checkClaims …" |
| Only NEAR-run, attested vLLM models are offered; relayed (non-TEE) models are refused | `isConfidentialModel()`, `listConfidentialModels()` | `nearai.test.mjs` "isConfidentialModel …", "listConfidentialModels …"; live: "non-TEE model is refused" |
| The gateway's TDX quote can be verified in the browser with no API key | `verifyGatewayNow()`, [`GatewayCheck.jsx`](src/components/dashboard/GatewayCheck.jsx) | `nearai.test.mjs` live: "verifyGatewayNow verifies the gateway TDX quote" |

### Pseudonymization (what an AI provider can learn)

| Claim | Code | Test |
|---|---|---|
| The exact messages sent to an external API contain no real EVM address, NEAR account (named or implicit, in any letter case), staking pool or tx hash — full or shortened | [`pseudonymize.js`](src/utils/pseudonymize.js) | [`claims.test.mjs`](tests/claims.test.mjs) B1; [`pseudonymize.test.mjs`](tests/pseudonymize.test.mjs) |
| Amounts reach an external API rounded to 4 significant figures (counts stay exact; dates become year-month); the NEAR AI TEE gets exact amounts by default; both are user-settable in the tier panel | `pseudonymizeForRemote()`, `precisionFor()` | `claims.test.mjs` B2; `pseudonymize.test.mjs` "precisionFor …", "sigFigs 0 …" |
| Placeholders in the answer are mapped back to your real addresses locally | `restore()` | `claims.test.mjs` B3; `pseudonymize.test.mjs` "restore() …" |
| Private-shard balances are masked the same way on their way into a prompt | `pseudonymizeForRemote()` over [`portfolioFacts()`](src/analytics/portfolio.js) | [`confidentialBalances.test.mjs`](tests/confidentialBalances.test.mjs) "external tier: account name masked …" |
| Encrypted (FHE) balances reach the model as words, never as a number to guess | [`portfolio.js`](src/analytics/portfolio.js) `portfolioFacts()` | `confidentialBalances.test.mjs` "encrypted (FHE) entries stay words …" |

### Prompt-injection guard (chain data is attacker-controlled)

| Claim | Code | Test |
|---|---|---|
| Token symbols and names, contract method names, protocol and account labels are guarded at the one place every prompt is built: text that reads like instructions, chat-template markup or a link is withheld, everything else is cut to a short plain charset | [`untrusted.js`](src/prompts/untrusted.js), `buildAnalysisMessages()` in [`wallet-analysis.js`](src/prompts/wallet-analysis.js) | [`untrusted.test.mjs`](tests/untrusted.test.mjs) |
| The system prompt tells the model FACTS is untrusted data, never instructions, and the data sits between explicit begin/end markers | `SYSTEM_PROMPT` | `untrusted.test.mjs` "buildAnalysisMessages: hostile chain data never reaches the prompt" |
| The demo plants a token named "IGNORE PREVIOUS INSTRUCTIONS…": it is marked "withheld from AI" on screen, and a real NEAR AI model neither repeats its link nor calls the wallet safe | [`demoFixtures.js`](src/near/demoFixtures.js), [`Shielded.jsx`](src/components/dashboard/Shielded.jsx) | `nearai.test.mjs` live: "hostile token name does not steer the answer" (needs a NEAR AI key) |

Limits: detection is a pattern list, so a cleverly worded name can get past it. The charset and length cut still apply to every chain-data string, and the system-prompt rule is the second layer. A model can still be misled by plain-looking data.

### See exactly what leaves the device

| Claim | Code | Test |
|---|---|---|
| Before any off-device request you see the exact request body, and nothing is sent until you click Send | [`OutboundReview.jsx`](src/components/dashboard/OutboundReview.jsx), `send()` in [`Assistant.jsx`](src/components/dashboard/Assistant.jsx) | checked in the browser (see below) |
| The preview is the wire: one builder makes both the request and the preview | [`outbound.js`](src/utils/outbound.js), used by [`external-context.js`](src/utils/external-context.js) and [`nearAiContext.js`](src/near/nearAiContext.js) | [`outbound.test.mjs`](tests/outbound.test.mjs): the external POST body is byte-identical to the preview; the body handed to the NEAR AI SDK deep-equals it |
| The Think toggle and effort level reach each NEAR AI model as the parameter that model honours (never a silently-ignored one), and they appear in the preview | [`reasoningProfiles.js`](src/near/reasoningProfiles.js), `nearAiRequestBody()` in [`outbound.js`](src/utils/outbound.js) | [`reasoningProfiles.test.mjs`](tests/reasoningProfiles.test.mjs) (4 tests); measured live with [`spike/reasoning-probe.mjs`](spike/reasoning-probe.mjs) |
| The context meter and chat cost use the token counts NEAR AI itself reports for the request; an unknown price shows as unknown, never $0 | [`usage.js`](src/near/usage.js), `ContextStrip` in [`Assistant.jsx`](src/components/dashboard/Assistant.jsx) | [`usage.test.mjs`](tests/usage.test.mjs) (6 tests); key capabilities measured live with [`spike/key-info-probe.mjs`](spike/key-info-probe.mjs) |
| Your API key is never shown in the preview | `previewRequest()` | `outbound.test.mjs` "external: previewRequest …" |

### NEAR Confidential Intents (private shard)

| Claim | Code | Test |
|---|---|---|
| Sign-in signs an **empty intent list** (moves nothing) with a NEP-413 payload and the SDK's versioned nonce; the wallet's signature is verified locally before anything is sent | [`nep413.js`](src/near/nep413.js), `nearIdentity()` in [`confidentialIntents.js`](src/near/confidentialIntents.js) | [`nep413.test.mjs`](tests/nep413.test.mjs); [`intents.test.mjs`](tests/intents.test.mjs) "nearIdentity …" |
| `intents.near`'s own verifier accepts that payload | same | `intents.test.mjs` live, no key: "simulate_intents accepts our NEP-413 payload" |
| Balances are parsed correctly: decimals applied, zero rows dropped, an unknown token shown in raw units instead of a guessed amount | `loadConfidentialHoldings()` | `confidentialBalances.test.mjs` (offline, fake Intents API) |
| One signature per page load: repeat reads and the 1-minute refresh reuse the session; an expired session asks you to sign again rather than prompting on a timer | `sessionFor()`, `refreshConfidentialHoldings()` | `confidentialBalances.test.mjs` "session is reused …", "refresh without a session …" |
| History is invite-only for now: the app says so, and a refusal never triggers a second wallet prompt | `classifyHistoryError()`, [`historyNote.js`](src/near/historyNote.js) | `confidentialBalances.test.mjs` "history refused …", "history 401 …" |
| Session tokens and amounts live in memory only — nothing is written to localStorage or IndexedDB, so a reload forgets them | [`confidentialIntents.js`](src/near/confidentialIntents.js) (in-memory `sessions` map) | by inspection: the module never touches browser storage (dev builds only keep the last sign-in payload on `window` for debugging) |

### Who sees what

| Claim | Code | Test |
|---|---|---|
| The in-app table lists every party the app talks to (hosting, RPCs, price APIs, your wallet, the Intents API, private-shard validators, NEAR AI gateway and enclave, external operator) and what each sees | [`trustBoundaries.js`](src/data/trustBoundaries.js), shown in the tier panel | [`trustBoundaries.test.mjs`](tests/trustBoundaries.test.mjs) |
| The app's own server never receives a wallet address: the page calls exactly four same-origin endpoints, none carrying one | same | `trustBoundaries.test.mjs` "hosting row …" — fails if a new endpoint appears |

## Do the tests catch anything? (guard removal)

A green suite proves little if the tests would stay green without the guards. So
[`scripts/guard-removal.mjs`](scripts/guard-removal.mjs) removes each guard in turn, runs
the named tests, requires at least one to **fail**, and restores the file byte for byte.
A mutation whose code has moved is reported, never skipped.

```bash
npm run verify:guards        # about 1 minute → evidence/guards-<date>.json
```

| # | Guard removed | Mutation | Test that must fail | Result |
|---|---|---|---|---|
| G1 | Signature check on a saved receipt | `verify(…)` call deleted in [`receiptBundle.js`](src/near/receiptBundle.js) | `receipt.test.mjs` "one flipped byte … is rejected" | caught |
| G2 | Tamper demo uses the real SDK verifier | `verify(…)` deleted in `tamperTest()` | `tamper.test.mjs` "real bytes verify, every flipped byte … rejected" | caught |
| G3 | Receipt requires NVIDIA GPU evidence | `gpu` check → `ok: true` | `nearai.test.mjs` "any weak link fails the receipt" | caught |
| G4 | Receipt requires E2EE | `e2ee` check → `ok: true` | same | caught |
| G5 | NVIDIA verdict nonce must match | nonce check deleted in [`nrasVerifier.js`](src/near/nrasVerifier.js) | "checkClaims rejects nonce mismatch …" | caught |
| G6 | Bounded clock tolerance | `iat` future check deleted | "checkClaims tolerates a lagging client clock within the bound only" | caught |
| G7 | Full 0x addresses masked | `EVM_FULL` replace deleted in [`pseudonymize.js`](src/utils/pseudonymize.js) | `claims.test.mjs` B1 | caught |
| G8 | Tx hashes masked | `TX_HASH` replace deleted | B1 | caught |
| G9 | Amounts rounded | `roundSig` bypassed | B2 | caught |
| G10 | Injection detection | `looksLikeInjection` → `false` | `untrusted.test.mjs` "hostile chain data never reaches the prompt" | caught |
| G11 | Prompt built from sanitized facts | raw `facts` put between the FACTS markers | same | caught |
| G12 | FHE balances stay words | `'ENCRYPTED — amount unknown'` → `0` | `confidentialBalances.test.mjs` "encrypted (FHE) entries stay words …" | caught |
| G13 | NEP-413 signature verified before sending | `verifyNep413` check → `if (false)` | `intents.test.mjs` "nearIdentity refuses a signature that does not verify" | caught |
| G14 | Server never sees a wallet | a fifth same-origin endpoint carrying an address | `trustBoundaries.test.mjs` "hosting row …" | caught |

**14/14 caught** on the recorded run ([`evidence/`](evidence)); the JSON lists every failing test per guard.

## See it in the browser (2 minutes)

`npm run dev`, open http://localhost:5173/app, click **Explore a demo**.

- **Review before sending:** pick the External API or NEAR AI tier and ask a
  question. The review window shows the destination, who can read the request,
  the question as sent (`Root.near` → `WALLET_2`) and the full request body.
  Cancel sends nothing.
- **Who sees what:** click **Compare tiers** under the chat box →
  "Every party, and what it sees".
- **Private shard:** Shielded balances → **Show sample private balances (demo)**.
  Recent activity then explains why private history isn't listed.
- **Key-less TEE check:** **Verify NEAR AI gateway now** in the assistant.
- **Offline receipt check:** open http://localhost:5173/verify → **Check the sample
  receipt from the repo** (a real NEAR AI answer), or drop a receipt you saved. Then
  **Check signer against NEAR AI now** to re-prove, live and key-less, that its signer
  is an attested enclave key today.

## What is *not* proven here (honest limits)

The full list is in [LIMITS.md](LIMITS.md). The short version:

- **Offline signature ≠ live attestation.** The captured receipt proves "these bytes
  were signed by this key" offline. That the key sits in a genuine TDX enclave needs a
  fresh quote and nonce, so it is live-only, but key-less: **Check signer against NEAR AI
  now** on `/verify` (also run in CI).
- **The NEAR Intents API (Aurora) sees your private balances** — it serves them
  to you after you sign. It is the one party outside a TEE that does.
- **Private-shard validators** hold the shard state inside TEEs: a hardware
  trust assumption, not cryptography.
- **Private-shard history is invite-only** for now, so past swaps can't be
  listed; balances are unaffected.
- **Pseudonymization does not hide** which assets and chains you hold, rough
  magnitudes, or the content of your question. The tier panel says so.
- **Public reads are public:** RPCs and explorers see the addresses you look up.

## What was built in the hackathon window

Everything after the tag `pre-hackathon` (commit `e44f03c`):
[`pre-hackathon...main`](https://github.com/noname9006/Refractoo-NEAR/compare/pre-hackathon...main).
The README lists it under [Built during the hackathon](README.md#built-during-the-hackathon-scored-work).
