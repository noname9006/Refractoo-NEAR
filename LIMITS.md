# Limits: what Refractoo does not claim

Each privacy claim we make is listed in [`evidence/manifest.json`](evidence/manifest.json) with the
test that must pass. This page is the other half: what is **established**, what is
**not established**, and what is plainly out of scope. If a sentence elsewhere seems to
claim more than this page, this page is right.

## Established, and how

| # | Established | Evidence |
|---|---|---|
| E1 | A real NEAR AI answer's bytes were signed by the pinned enclave signer; one flipped byte fails | [`fixtures/nearai-receipt/`](fixtures/nearai-receipt/) + [`tests/receipt.test.mjs`](tests/receipt.test.mjs), offline |
| E2 | The SDK's signature check rejects tampered answers, tampered requests, forged signed-text and keys the attestation did not vouch for | [`tests/claims.test.mjs`](tests/claims.test.mjs) A1–A5 (local key standing in for the enclave) |
| E3 | The Verified receipt goes red if any one of six links is weak | `tests/nearai.test.mjs` "verificationChecks: …" |
| E4 | The external-tier prompt contains no real EVM address, NEAR account, staking pool or tx hash, and amounts are rounded to 4 significant figures | `tests/claims.test.mjs` B1, B2 |
| E5 | The request preview is byte-identical to the request sent | [`tests/outbound.test.mjs`](tests/outbound.test.mjs) |
| E6 | The app's own server is called on exactly four same-origin endpoints, none carrying a wallet address | [`tests/trustBoundaries.test.mjs`](tests/trustBoundaries.test.mjs) |
| E6b | The real receipt's signer is, right now, the key of an attested NEAR AI enclave for that model (fresh nonce, TDX + NVIDIA verified, no API key) | `/verify` → "Check signer against NEAR AI now"; `tests/receipt.test.mjs` `live:` test; CI |
| E8 | All of the above re-run on GitHub's machines on every push, results kept as artifacts | [`.github/workflows/evidence.yml`](.github/workflows/evidence.yml) |
| E7 | The tests catch the guards being removed, not just pass | [guard-removal matrix](JUDGES.md#do-the-tests-catch-anything-guard-removal) via `npm run verify:guards` |

One command produces a file recording all of this with the commit and input hashes:
`npm run verify:evidence` → `evidence/run-<date>.json`.

## Not established

| # | Not established | Why, and what would establish it |
|---|---|---|
| N1 | **Offline, that the receipt's signing key is in a genuine TDX enclave.** | The fixture alone proves "signed by this key". The enclave link needs a fresh TDX quote + NVIDIA evidence bound to a new nonce, so it is **live-only**, but anyone can run it with no API key: **Check signer against NEAR AI now** on `/verify`, or the `live:` test in `tests/receipt.test.mjs` (also run in CI on every push). It matched on 2026-11-14 (TDX UpToDate, GPU verified, 3/3 reports). It proves the key is attested *today*; if NEAR AI rotates the key, an old receipt will stop matching, which is the honest result. |
| N2 | **That the plaintext prompt in the fixture is what was encrypted.** | With E2EE the signed request is ciphertext. `request-plaintext.json` shows what the app built; it is not covered by the signature. |
| N3 | **The NEAR AI operator, Intel, NVIDIA.** | TEE security is a hardware and vendor trust assumption, not cryptography alone. |
| N4 | **Prompt-injection resistance in general.** | Detection is a pattern list; a cleverly worded token name can pass it. The charset/length cut and the system-prompt rule are the second and third layers. A model can still be misled by plain-looking data. |
| N5 | **That the review dialog blocks sending until you click Send.** | Checked in the browser, not by the offline suite. |
| N6 | **That session tokens and amounts never touch browser storage.** | By code inspection of `confidentialIntents.js`; no test enforces it. |
| N7 | **An audit.** | Nothing here has been audited by a third party. |

## Out of scope, by design

- **Pseudonymization does not hide** which assets and chains you hold, rough magnitudes or
  the topic of your question. Exact amounts go to the NEAR AI TEE by default (settable).
- **The external-API tier trusts that operator** with the pseudonymized prompt. It is not a TEE.
- **Public reads are public.** RPCs and explorers see the addresses you look up.
- **The NEAR Intents API (Aurora) sees your private-shard balances.** It serves them to you after
  you sign; it is the one party outside a TEE that does. Validators hold shard state in TEEs.
- **Private-shard history is invite-only** at the API, so past swaps are not listed.
- **FHE balances are a demo of display, not of computation.** Encrypted balances reach the model as
  words ("encrypted"), never as a number; the app does not compute on ciphertexts.
- **Nothing persists.** Receipts, sessions and private balances live in memory; a reload forgets
  them. "Save receipt" is the only way to keep a receipt, and it is a file you download.
- **Prices can be stale or missing.** An unpriced token is shown in raw units or as unknown, never guessed.
- **Chain coverage is partial**: the EVM chains and NEAR protocols listed in the README; others are not read.
- **No on-chain anchor.** The evidence file's integrity rests on the git commit, not on a contract.
  There is no mainnet contract for this and we do not claim one.
