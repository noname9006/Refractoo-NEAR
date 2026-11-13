# For judges: check the claims yourself

Refractoo makes privacy claims. This page maps each one to the code that
implements it and the test that proves it, so you can verify them in a few
minutes instead of taking them on trust.

## One command, no keys, no network

```bash
npm ci
npm run test:offline
```

80 tests, about 2 seconds. `npm test` additionally runs the `live:` tests
against public endpoints (NEAR RPC, `intents.near`, the NEAR AI gateway); the
ones that need a NEAR AI or Intents API key skip themselves without one.

To see the features rather than the tests: [README → Try it in 3 minutes](README.md#try-it-in-3-minutes--no-wallet-no-keys).

## Claim → code → test

### Private AI (NEAR AI TEE)

| Claim | Code | Test |
|---|---|---|
| Every answer is signed inside the attested enclave, over the exact request and response bytes: flip any single byte of the answer, the request or the signature and verification fails | `client.verifyResponse()` → `verifyModelResponse` in `@nearai/inference-sdk`, called from [`nearAiContext.js`](src/near/nearAiContext.js) `analyze()` | [`claims.test.mjs`](tests/claims.test.mjs) A1–A5 |
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

## What is *not* proven here (honest limits)

- **Live NEAR AI chat needs a key.** Offline, the signature tests run the SDK's
  real verification functions, with a locally generated key standing in for the
  enclave's attested key. The live end-to-end run (`npm test` with
  `NEARAI_API_KEY`) uses the real enclave.
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
