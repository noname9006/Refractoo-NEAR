<div align="center">

<a href="https://refractoo.xyz"><img src="docs/media/logo.svg" alt="Refractoo" width="200"></a>

### Your private DeFi analyst

**Every wallet you own in one dashboard, and an AI that explains it without seeing whose it is.**

[![Open the app](https://img.shields.io/badge/Open_the_app-refractoo.xyz-0d9488?style=for-the-badge)](https://refractoo.xyz/app)

[![NEAR AI TEE](https://img.shields.io/badge/AI-NEAR_AI_TEE-1b6ef3)](https://cloud.near.ai)
[![NEAR Confidential Intents](https://img.shields.io/badge/NEAR-Confidential_Intents-000000)](https://near.org)
[![Evidence](https://github.com/noname9006/Refractoo-NEAR/actions/workflows/evidence.yml/badge.svg)](https://github.com/noname9006/Refractoo-NEAR/actions/workflows/evidence.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-lightgrey)](LICENSE)

[**Live app**](https://refractoo.xyz/app) · [How it works](#how-to-use-it) · [Privacy](#who-sees-what) · [For judges](JUDGES.md) · [Self-host](docs/SELF-HOSTING.md)

<br>

<img src="docs/media/hero.gif" alt="Refractoo: open the demo, the dashboard fills with live data across EVM and NEAR" width="900">

</div>

---

## Why Refractoo

DeFi is spread across a dozen wallets, chains and protocols. Making sense of it
is a job for AI, but **handing your portfolio to an AI provider gives away your
net worth, your positions and every address you own.**

Refractoo reads your wallets, works out the numbers in your browser, and lets an
AI explain them **without anyone else learning what you hold**:

- **One view of everything.** EVM chains, NEAR accounts, DeFi positions, token
  approvals and **private NEAR Confidential Intents balances**, priced and
  summed in one place.
- **Ask in plain words.** "Where is my money and what's at risk?", "Am I
  overexposed to ETH?", "Explain my Aave health factor".
- **Private by design.** The AI runs on your own device, or inside a NEAR AI
  enclave **that your browser verifies before sending anything**. Addresses are
  replaced with placeholders before the question leaves the device.
- **Proof instead of promises.** Every answer comes with a receipt: 6 checks
  your browser ran, and a signature you can verify yourself.
- **No sign-up, nothing stored.** No account, no database. Your keys never
  leave your wallet.

## Try it now: no wallet, no keys

1. Open **[refractoo.xyz/app](https://refractoo.xyz/app)**
2. Click **Explore a demo**

You get a live dashboard with demo EVM wallets and public NEAR accounts
(`root.near`, `satojandro.near`), read from the chain in real time. Everything
below works in the demo.

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/media/dashboard-dark.png">
    <img src="docs/media/dashboard-light.png" alt="Refractoo dashboard: wallets, chains, total portfolio value and the Wallet Assistant" width="900">
  </picture>
</p>

## How to use it

### 1. Add your wallets

**Connect wallet** and pick a source. Add as many as you like; they all go into
one portfolio.

| Source | What you get |
|---|---|
| **EVM wallet** (MetaMask, Rabby, Coinbase Wallet or any browser wallet) | Tokens on Ethereum, Arbitrum, Optimism, Base, Polygon, BNB, Avalanche and more |
| **NEAR wallet** (HOT, Meteor, Intear, MyNearWallet, Ledger…) | NEAR, fungible tokens, staking, DeFi, and your private Confidential Intents balances |
| **Watch any address or `.near` account** | Read-only: paste a name and see it, no signature needed |

Watching is read-only. Refractoo never asks for a transaction or a private key.

### 2. See where your money is

<table>
<tr>
<td width="50%" valign="top">

**Holdings and DeFi, across chains.** Tokens are priced live and grouped by
chain. DeFi positions are read straight from the protocols' contracts:

- Lending with health factor: **Aave v3, SparkLend, Morpho, Rhea Lend**
- Liquid staking: **Lido, ether.fi, Ethena, Spark, stNEAR, LiNEAR, rNEAR**
- NEAR validator staking, per pool
- **Uniswap v3** liquidity, in or out of range

Also: **Recent activity** and **Spending caps** (token approvals, with
unlimited ones flagged). Filter by chain with one click; your layout is
remembered.

</td>
<td width="50%" valign="top">
<img src="docs/media/defi.png" alt="DeFi positions: Aave, SparkLend, Morpho with health factors, NEAR staking, Lido" width="100%">
</td>
</tr>
</table>

### 3. Reveal your private balances

<table>
<tr>
<td width="50%" valign="top">
<img src="docs/media/shielded.png" alt="Shielded balances: NEAR Confidential Intents private-shard balances" width="100%">
</td>
<td width="50%" valign="top">

**NEAR Confidential Intents** keep balances and swaps off the public chain.
Refractoo can show them to you, and only to you:

- **One signature of an empty intent** (nothing is transferred) reads your
  private-shard balances.
- They are held **in this tab's memory only**: gone when you close it.
- They reach the AI only on your device or inside a verified enclave.

FHE-encrypted tokens (**Zama, Inco, Fhenix**) are found automatically and stay
masked as `•••••` until you reveal them one by one.

In the demo, **Show sample private balances** shows what this looks like
(labelled *sample*).

</td>
</tr>
</table>

<p align="center"><img src="docs/media/private.gif" alt="Compare AI tiers, then reveal sample private balances" width="820"></p>

### 4. Choose where the AI runs

Open **Compare tiers** under the chat box to see, side by side, where the model
runs and who can read your question:

| | **NEAR AI TEE** (recommended) | **On device** | **External API** |
|---|---|---|---|
| Where the model runs | NEAR AI Cloud, inside an Intel TDX + NVIDIA confidential-computing enclave | In your browser (WebGPU / CPU) | Any OpenAI-compatible server |
| Who can read your question | Only code inside the attested enclave | Only you | The server's operator |
| What your browser checks | TDX quotes, NVIDIA GPU evidence, fresh nonce, a signature on every answer | Nothing leaves the device | Nothing: you trust the operator |
| Models | GLM 5.3, Qwen 3.8, DeepSeek V4.1, Kimi K3 and more | Qwen 3.5 4B, Gemma 4 with voice input (two-click download) | Your choice |
| Cost | Pay per token with a [NEAR AI](https://cloud.near.ai) key | Free | Depends on the provider |

<p align="center"><img src="docs/media/tiers.png" alt="Where your AI runs — and who sees what: the three tiers compared" width="820"></p>

**Setting up NEAR AI:** **Settings → AI model → NEAR AI TEE**, paste a key from
[cloud.near.ai](https://cloud.near.ai), **Verify & connect**. The browser checks
the enclave before the first question is sent.

**Setting up on-device:** **Settings → AI model → On device**, pick a model,
**Load model**. It downloads once and is cached in the browser.

### 5. Ask, and check the receipt

Type a question or pick one of the suggestions. The model gets the facts
Refractoo computed (it never guesses balances), with your addresses replaced by
`WALLET_1`, `NEAR_1`… Real names are restored in the answer on your device.

<p align="center"><img src="docs/media/ai-answer.gif" alt="Asking 'Where is my money and what is at risk?': review what leaves the device, Send, the answer streams in, the Verified 6/6 receipt opens, then a simulated tampered answer fails the signature check" width="900"></p>

<p align="center"><img src="docs/media/ai-answer.png" alt="A real NEAR AI answer: where the money is, by asset and chain, and what is at risk — concentration, unlimited approvals, spam dust transfers" width="900"></p>

<table>
<tr>
<td width="42%" valign="top">

**See exactly what leaves the device.** With **review before sending** on,
the full request is shown first: your question, the facts, and how many
identifiers were replaced with placeholders. It goes out only when you click
**Send**, encrypted to the enclave.

</td>
<td width="58%" valign="top">
<img src="docs/media/review.png" alt="Review what leaves this device: 8 identifiers replaced with placeholders, 18 KB readable only inside the attested enclave" width="100%">
</td>
</tr>
</table>

**Every answer comes with a receipt.** **Verified · 6/6 checks**: gateway TDX,
model TDX, NVIDIA GPU, fresh nonce, end-to-end encryption and the enclave's
signature over the exact answer bytes.

<p align="center"><img src="docs/media/receipt.png" alt="Verified 6/6 checks receipt under a NEAR AI answer" width="820"></p>

**Don't take our word for it.** **Simulate tampered answer** flips one byte of
the real answer in memory and re-runs the same check. It fails:

<p align="center"><img src="docs/media/receipt-tampered.png" alt="Simulated tampering: one flipped byte, signature rejected, receipt turns red" width="820"></p>

**Save receipt** downloads the answer's bytes, signature and signer, so anyone
can re-check it later at [refractoo.xyz/verify](https://refractoo.xyz/verify),
offline, and re-prove live that the signer is an attested enclave key.

**No key yet?** Click **Verify NEAR AI gateway now**: your browser checks the
live NEAR AI enclave in a few seconds, no account needed.

<table>
<tr>
<td width="55%" valign="top">
<img src="docs/media/verify.gif" alt="Key-less NEAR AI gateway check: Intel TDX quote verified, fresh nonce, gateway signing key" width="100%">
</td>
<td width="45%" valign="top">
<img src="docs/media/verify-card.png" alt="Verify a NEAR AI receipt: signature valid, live signer check matches an attested enclave" width="100%">
</td>
</tr>
</table>

## Who sees what

| | Sees your addresses | Sees your balances | Sees your question |
|---|---|---|---|
| Refractoo's server | No | No | No (on-device and NEAR AI tiers) |
| NEAR AI gateway | No | No | Ciphertext only |
| NEAR AI model enclave | Placeholders only | Yes, inside the attested TEE | Yes, inside the attested TEE |
| Public RPCs and explorers | The addresses you look up | Only public on-chain data | No |
| NEAR Intents API (Aurora) | The account you sign in with | Your private-shard balances | No |

Refractoo **stores nothing server-side**: no database, no logs, no sessions. The
whole backend is about 500 lines in [`server/`](server/) and can be read in
minutes. The app shows this table per party under **Compare tiers → Every
party, and what it sees**, and a test checks it against the code.

Full breakdown, including what revealing an FHE balance leaks:
**[docs/PRIVACY.md](docs/PRIVACY.md)**. What we don't claim:
**[LIMITS.md](LIMITS.md)**.

## Safety built in

- **Prompt-injection guard.** Token names are written by whoever deploys the
  token. Suspicious text ("IGNORE PREVIOUS INSTRUCTIONS…") is withheld from the
  AI and flagged. The demo plants one so you can see it.
- **No invented numbers.** Totals come from deterministic code, not the model.
  An encrypted balance is reported as *unknown*, never as zero; a protocol that
  fails to load is shown as failed, not empty.
- **Context and cost meter.** See how full the model's context is and roughly
  what the current chat cost.

## FAQ

<details>
<summary><b>Do I need a NEAR AI key?</b></summary>

No. The dashboard, private balances and the on-device AI work without one. A
key unlocks larger models running in a verified enclave.
</details>

<details>
<summary><b>Can Refractoo move my funds?</b></summary>

No. It only reads. The only signature it ever asks for is an *empty* intent
(no transfer) to read your Confidential Intents balances, or an EIP-712 message
to decrypt an FHE balance you chose to reveal.
</details>

<details>
<summary><b>Will the on-device model run on my computer?</b></summary>

Small models run on most machines with Chrome or Edge. Larger ones need a GPU
with WebGPU. Settings shows the RAM/VRAM estimate and lets you split work
between GPU and CPU. It is slower than the cloud tier; that's the price of
nothing leaving the device.
</details>

<details>
<summary><b>Which browsers are supported?</b></summary>

Chrome and Edge 113+ are recommended (WebGPU). Safari 18+ and Firefox work;
the on-device model falls back to CPU there.
</details>

<details>
<summary><b>Can I run my own instance?</b></summary>

Yes, it's MIT-licensed: `npm ci && npm run dev`. See
[docs/SELF-HOSTING.md](docs/SELF-HOSTING.md) for configuration, network modes,
adding models and deployment.
</details>

---

## For NEAR HACKATHON judges

Submitted to **NEAR HACKATHON, Privacy & Private AI track (Track 03)**.

The track's example is a private expense auditor. Refractoo applies the same
architecture (local or attested-TEE inference, pseudonymized prompts, nothing
stored server-side) to a harder dataset: **the whole portfolio**, including
balances that are private on-chain (NEAR Confidential Intents). Feeding those
to an ordinary cloud AI would undo their privacy; here they reach only the
on-device model or an attested TEE.

**Business model.** On-device analysis is free and costs nothing to serve.
The paid tier is private TEE inference (larger models on NEAR AI Cloud),
billed by subscription or per query. Expansion: wallets, custodians and funds
embed or white-label the analyzer so they can offer portfolio insight
without holding customer data, and show the attestation that proves it.

### Try it in 3 minutes — no wallet, no keys

On [refractoo.xyz/app](https://refractoo.xyz/app), or locally with
`npm ci && npm run dev` (Node 22+, then http://localhost:5173/app):

| Do | You should see |
|---|---|
| Click **Explore a demo** | A dashboard with demo EVM wallets and the public NEAR account `root.near`, read live: NEAR balance, FT tokens and NEAR staked in `shitzu.pool.near` (Holdings, DeFi), a **NEAR** chain pill |
| In the assistant, click **Verify NEAR AI gateway now** | Within a few seconds: "Intel TDX quote verified against Intel collateral · TCB UpToDate", the fresh nonce it is bound to, and the gateway signing key |
| Click **Compare tiers** under the chat box | The three tiers side by side: where the model runs, what leaves the device, who can read it, what is checked, what is pseudonymized |
| **Shielded balances → NEAR Confidential Intents → Show sample private balances (demo)** | Sample private-shard balances (USDC, wNEAR, BTC, ZEC) tagged **sample**; with a wallet connected this button asks for one signature of an empty intent and reads your real ones |
| **Connect wallet → NEAR → Watch an account by name** (e.g. `randomname1001.near`) | That account's NEAR / FT / staking added to the portfolio, read-only |
| With a NEAR AI key: **Settings → AI model → NEAR AI TEE**, **Verify & connect**, ask anything | A **Verified · 6/6 checks** panel on every answer and a note of what was pseudonymized |

**Evidence.** [JUDGES.md](JUDGES.md) maps every privacy claim to its code and
the test that proves it; [LIMITS.md](LIMITS.md) lists what we do not claim.

- `npm run verify:evidence`: all claims, no keys, no network, ~11 s; writes
  `evidence/run-<date>.json` with commit, input hashes and per-claim status.
- `npm run verify:guards`: removes each of 18 guards in turn and shows the tests catch it.
- Real NEAR AI receipts from two models in [`fixtures/nearai-receipt/`](fixtures/nearai-receipt/) and [`fixtures/nearai-receipt-2/`](fixtures/nearai-receipt-2/),
  checkable at `/verify`, plus a live key-less re-proof that its signer is an
  attested enclave key today.
- CI re-runs all of it on every push ([`evidence` workflow](.github/workflows/evidence.yml)).
- `npm test`: unit tests plus live checks against public endpoints. Tests that
  spend NEAR AI credit run only when `NEARAI_API_KEY` is set.

### Built during the hackathon (scored work)

Everything before the tag [`pre-hackathon`](https://github.com/noname9006/Refractoo-NEAR/tree/pre-hackathon)
(commit `e44f03c`) is pre-existing work, see [Baseline](#baseline-pre-hackathon-work).
The hackathon diff: [`pre-hackathon...main`](https://github.com/noname9006/Refractoo-NEAR/compare/pre-hackathon...main).

| NEAR feature | Code |
|---|---|
| **NEAR AI TEE inference tier**: browser-side gateway + model attestation, E2EE chat, per-answer signature check, "Verified" receipt with a **"Simulate tampered answer"** button; refuses non-attested (Incognito) models | [`src/near/nearAiContext.js`](src/near/nearAiContext.js) |
| NVIDIA NRAS verdict check with bounded clock tolerance (the SDK has none; a few seconds of client clock lag failed every verification) | [`src/near/nrasVerifier.js`](src/near/nrasVerifier.js) |
| **Key-less live gateway check** for people without a NEAR AI key | `verifyGatewayNow()` in `nearAiContext.js`, [`GatewayCheck.jsx`](src/components/dashboard/GatewayCheck.jsx) |
| **NEAR Confidential Intents**: one signature of an empty intent → private-shard balances, held in memory only. Sign with a **NEAR wallet (NEP-413**, via near-connect) or an EVM wallet (ERC-191). NEP-413 payloads built and the wallet's signature verified locally before anything is sent. Sign-in uses the SDK's versioned nonce ([why](docs/NEAR-AI.md#confidential-intents-sign-in)) | [`confidentialIntents.js`](src/near/confidentialIntents.js), [`nep413.js`](src/near/nep413.js), [`nearWallet.js`](src/near/nearWallet.js) |
| **Public NEAR accounts** by name: balance, FTs, per-pool staking, priced | [`src/near/nearAccount.js`](src/near/nearAccount.js) |
| **NEAR DeFi positions**: Rhea Lend with the protocol's own health-factor rule; liquid staking (stNEAR, LiNEAR, rNEAR) and unstaking; public NEAR Intents balances. A failed protocol read is reported, never zero-filled | [`src/near/defi/`](src/near/defi) |
| **Pseudonymization** of off-device prompts, per-tier amount precision (TEE exact, external 4 significant figures), local restore of real addresses | [`src/utils/pseudonymize.js`](src/utils/pseudonymize.js) |
| **Per-model reasoning controls**: Think toggle and effort selector send the parameter each NEAR AI model actually honours ([measured table](docs/NEAR-AI.md#reasoning-controls-per-near-ai-model)) | [`reasoningProfiles.js`](src/near/reasoningProfiles.js), [`outbound.js`](src/utils/outbound.js), [`reasoning-probe.mjs`](spike/reasoning-probe.mjs) |
| **Context window and chat cost** from NEAR AI's own usage counts ([details](docs/NEAR-AI.md#context-window-and-chat-cost)) | [`usage.js`](src/near/usage.js), [`Assistant.jsx`](src/components/dashboard/Assistant.jsx), [`ModelSwitcher.jsx`](src/components/dashboard/ModelSwitcher.jsx) |
| Tier switcher with the who-sees-what table | [`TierPanel.jsx`](src/components/dashboard/TierPanel.jsx) |
| **Review before sending**: the exact request body, sent only on "Send"; one builder makes both the preview and the request | [`OutboundReview.jsx`](src/components/dashboard/OutboundReview.jsx), [`outbound.js`](src/utils/outbound.js) |
| **Every party, and what it sees**, tested against the code | [`trustBoundaries.js`](src/data/trustBoundaries.js) |
| Private-shard activity: invite-only history explained, never a second wallet prompt | [`historyNote.js`](src/near/historyNote.js) |
| **Prompt-injection guard** for attacker-controlled chain text; the demo plants a hostile token to show it | [`src/prompts/untrusted.js`](src/prompts/untrusted.js) |
| Demo mode for reviewers (live NEAR account, labelled sample private-shard data, planted prompt-injection token) | [`src/near/demoFixtures.js`](src/near/demoFixtures.js) |
| **Evidence**: claim manifest, one-command evidence file, guard-removal matrix (23/23), two real NEAR AI receipts (two models) verified offline, agent actions (model proposes → user approves a hash-bound proposal → app executes, money-moving kinds denied), **Save receipt** and the **`/verify`** page | [`evidence/`](evidence), [`scripts/`](scripts), [`fixtures/nearai-receipt/`](fixtures/nearai-receipt), [`receiptBundle.js`](src/near/receiptBundle.js), [`VerifyReceipt.jsx`](src/components/VerifyReceipt.jsx) |
| Tests, claim by claim in [JUDGES.md](JUDGES.md) | [`tests/`](tests) |

### Baseline (pre-hackathon work)

Built June–July 2026, before the hackathon, and not part of the scored work: the
dashboard and design, EVM portfolio + DeFi + approvals, FHE confidential tokens
(Zama, Fhenix CoFHE, Inco), the on-device model (wllama) with voice, and the
external-API tier.

## Documentation

| | |
|---|---|
| [docs/PRIVACY.md](docs/PRIVACY.md) | Every party and what it sees; server-side storage; what revealing an FHE balance exposes |
| [docs/NEAR-AI.md](docs/NEAR-AI.md) | Reasoning controls per NEAR AI model, context and cost meter, Confidential Intents sign-in |
| [docs/SELF-HOSTING.md](docs/SELF-HOSTING.md) | Run locally, `.env`, mainnet/testnet modes, DeFi coverage, adding on-device models, VPS deployment |
| [JUDGES.md](JUDGES.md) · [LIMITS.md](LIMITS.md) · [THREAT_MODEL.md](THREAT_MODEL.md) | Claim → code → test map, what we do not claim, and who could attack |

## License

[MIT](LICENSE)
