# Refractoo — private AI analysis of your whole portfolio, NEAR included

Refractoo reads your wallets — EVM chains, public NEAR accounts and your
**NEAR Confidential Intents (private-shard) balances** — computes the numbers
deterministically in the browser, and lets an AI explain them. You choose where
that AI runs, and the app shows exactly who can see what:

| Tier | Where the model runs | What this browser verifies |
|---|---|---|
| **On device** | wllama (llama.cpp → WebGPU/WASM) in this tab | nothing leaves the device |
| **NEAR AI TEE** | NEAR AI Cloud, Intel TDX + NVIDIA confidential-computing enclave | gateway + model attestation before sending, end-to-end encryption to the model, a signature on every answer |
| **External API** | any OpenAI-compatible endpoint | nothing — you trust the operator |

For the two off-device tiers the prompt is **pseudonymized**: wallet addresses,
NEAR account names, staking pools and tx hashes become placeholders
(`WALLET_1`, `ADDR_2`, `NEAR_1`…), and the answer is mapped back to your real
addresses locally.

Submitted to **NEAR HACKATHON — Privacy & Private AI track**.

## Try it in 3 minutes — no wallet, no keys

Requires Node 22+ and Chrome/Edge (WebGPU only matters for the on-device model).

```bash
npm ci
npm run dev
```

Open http://localhost:5173/app, then:

| Do | You should see |
|---|---|
| Click **Explore a demo** | A dashboard with an EVM demo wallet and the public NEAR account `root.near`, read live: NEAR balance, FT tokens and NEAR staked in `shitzu.pool.near` (Holdings, DeFi), a **NEAR** chain pill |
| In the assistant, click **Verify NEAR AI gateway now** | Within a few seconds: "Intel TDX quote verified against Intel collateral · TCB UpToDate", the fresh nonce it is bound to, and the gateway signing key — a real attestation check run in your browser, no API key |
| Click the privacy line under the chat box (**Compare tiers**) | The three tiers side by side: where the model runs, what leaves the device, who can read it, what is checked, what is pseudonymized |
| Scroll to **Shielded balances → NEAR Confidential Intents**, click **Show sample private balances (demo)** | Sample private-shard balances (USDC, wNEAR, BTC, ZEC) clearly tagged **sample** — with a wallet connected this button instead asks for one signature of an empty intent and reads your real ones |
| Click **+ NEAR** in the toolbar, enter any account (e.g. `randomname1001.near`) | That account's NEAR / FT / staking added to the portfolio, read-only |

With a NEAR AI key (https://cloud.near.ai): **Settings → AI model → NEAR AI TEE**,
paste the key, **Verify & connect**, then ask anything. Every answer gets a
**Verified · 6/6 checks** panel (gateway TDX, model TDX, NVIDIA GPU, fresh nonce,
E2EE, enclave signature) and a note of what was pseudonymized.

Tests: `npm test` — unit tests plus live checks against public endpoints (NEAR
RPC, FastNEAR, the key-less NEAR AI gateway check). Tests that spend NEAR AI
credit run only when `NEARAI_API_KEY` is set (env or `.env`).

## Built during the hackathon (scored work)

Everything before the tag [`pre-hackathon`](https://github.com/noname9006/Refractoo-NEAR/tree/pre-hackathon)
(commit `e44f03c`) is pre-existing work — see [Baseline](#baseline-pre-hackathon-work).
The hackathon diff: [`pre-hackathon...main`](https://github.com/noname9006/Refractoo-NEAR/compare/pre-hackathon...main).

| NEAR feature | Code |
|---|---|
| **NEAR AI TEE inference tier**: browser-side gateway + model attestation, E2EE chat, per-answer signature check, "Verified" receipt; refuses non-attested (Incognito) models | [`src/near/nearAiContext.js`](src/near/nearAiContext.js) |
| NVIDIA NRAS verdict check with bounded clock tolerance (the SDK has none; a few seconds of client clock lag failed every verification) | [`src/near/nrasVerifier.js`](src/near/nrasVerifier.js) |
| **Key-less live gateway check** for people without a NEAR AI key | `verifyGatewayNow()` in `nearAiContext.js`, [`GatewayCheck.jsx`](src/components/dashboard/GatewayCheck.jsx) |
| **NEAR Confidential Intents**: one signature of an empty intent → private-shard balances + swap history, held in memory only | [`src/near/confidentialIntents.js`](src/near/confidentialIntents.js) |
| **Public NEAR accounts** by name: balance, FTs, per-pool staking, priced | [`src/near/nearAccount.js`](src/near/nearAccount.js) |
| **Pseudonymization** of off-device prompts, per-tier amount precision (TEE exact, external 4 significant figures), local restore of real addresses | [`src/utils/pseudonymize.js`](src/utils/pseudonymize.js) |
| Tier switcher with the who-sees-what table | [`TierPanel.jsx`](src/components/dashboard/TierPanel.jsx) |
| Demo mode for reviewers (live NEAR account, labelled sample private-shard data) | [`src/near/demoFixtures.js`](src/near/demoFixtures.js) |
| Tests | [`tests/`](tests) |

Also in the window: reasoning budget for NEAR AI models (Settings), token-name
sanitizing before anything reaches a prompt (deployer-chosen names are
untrusted text), and fixes found along the way — see the commit log.

## Baseline (pre-hackathon work)

Built June–July 2026, before the hackathon, and not part of the scored work: the
dashboard and design, EVM portfolio + DeFi + approvals, FHE confidential tokens
(Zama, Fhenix CoFHE, Inco), the on-device model (wllama) with voice, and the
external-API tier. The sections below document that baseline.

## Run

```bash
npm ci
cp .env.example .env   # optional: VITE_ETHERSCAN_KEY for tx history
npm run dev
```

Every key in `.env.example` is optional for the demo. `VITE_AURORA_INTENTS_API_KEY`
is needed only to read real Confidential Intents balances with a wallet.

## Network modes

The app runs in one of two modes, chosen by `VITE_NETWORK_MODE` in `.env`:

| | `mainnet` (default) | `testnet` |
|---|---|---|
| Chains | Ethereum, Arbitrum, Optimism, Base, Polygon | Sepolia, Arbitrum Sepolia, Base Sepolia |
| Confidential tokens | **Zama Protocol** (Ethereum), Inco Lightning (Base) | **Fhenix CoFHE** (all three), Zama (Sepolia), Inco (Base Sepolia) |
| Prices | DefiLlama, live | proxied from mainnet twins, **labelled as such** |
| Aave v3 | yes | no (no pool configured ⇒ skipped) |
| Token discovery | curated + CoinGecko registry long tail | curated list + tokens seen in history |

Two things worth knowing:

- **Mainnet is not the "no privacy" mode.** Zama Protocol has been live on
  Ethereum since 2025-12-30 and Inco on Base since 2026-06-15, so confidential
  balances are real on mainnet, against real value.
- **Testnet exists for Fhenix.** CoFHE has no mainnet deployment — Sepolia,
  Arbitrum Sepolia and Base Sepolia are the only places it runs. All three stacks
  overlap on the Sepolia family, which makes testnet mode the one place every
  adapter can be exercised at once.

`VITE_` values are inlined at build time, so two modes means two builds. In
`npm run dev` only, **Settings → Network** switches modes at runtime (it reloads
the page). The IndexedDB chain cache is namespaced per mode, so the two never mix.

## Confidential (shielded) token balances

Three FHE stacks sit behind one adapter interface in `src/fhe/`:

| Stack | Chains | Discovery | Decryption trust |
|---|---|---|---|
| **Zama Protocol** | Ethereum, Sepolia | on-chain wrapper registry (enumerable) | threshold FHE committee |
| **Fhenix CoFHE** | Sepolia, Arb Sepolia, Base Sepolia | configured contract list | Fhenix threshold network |
| **Inco Lightning** | Base, Base Sepolia | configured token list | **TEE nodes** (hardware trust) |

How it behaves:

1. **Discovery never decrypts.** Finding confidential holdings is ordinary
   read-only chain calls (one chunked multicall per chain) — no wallet signature,
   no relayer contact. It learns *that* a ciphertext exists, never its value. This
   works for the read-only demo wallet too.
2. **A non-zero handle is not a non-zero balance.** It only means a ciphertext
   exists. Encrypted rows show `•••••`, contribute nothing to the total, and are
   reported to the LLM as `ENCRYPTED — amount unknown` so it can't fill the gap.
3. **Revealing is per-holding and explicit.** It costs one EIP-712 signature and
   a decryption round-trip. The plaintext is produced in your browser.
4. **The SDKs are lazy-loaded.** Each ships a multi-MB TFHE WASM bundle; none of
   it is in the main chunk. Nothing is fetched unless you reveal something.

For Fhenix specifically, deploy `contracts/ConfidentialDemo.sol` (see
`contracts/README.md`), set `VITE_COFHE_DEMO_ADDRESS`, and run in testnet mode.
Zama's registry addresses are built in for both Ethereum and Sepolia; Inco needs
explicit token addresses (`VITE_INCO_TESTNET_TOKENS`) because it ships no registry.

Open http://localhost:5173 in Chrome/Edge 113+ (WebGPU) — Safari 18+, Firefox
falls back to CPU.

## First test (no shard hosting needed)

Select **Qwen3-1.7B (lite)** → Load model. It's under wllama's 2 GB single-file
limit and loads straight from HuggingFace, validating the whole pipeline.

## Adding a model to the registry

Every selectable model is one entry in the `MODELS` array in
`src/models/registry.js`. To add one, copy an existing entry and fill in:

| Field | Meaning |
|---|---|
| `id` | Unique slug, used as the selection key. |
| `name` | Display name shown in the model picker. |
| `role` | Short label (`Base model`, `Low-resource backup`, `Voice (multimodal)`, `Pipeline test`, ...). |
| `quant` | Quantization string for display (e.g. `Q4_K_M`). |
| `sizeBytes` | GGUF size in bytes — drives the human-readable size shown in the picker/loader (`formatSize`) and storage preflight checks. |
| `source.type` | Currently only `'url'`. |
| `source.url` | Direct download URL. If the model is split into shards, this must point at the **first** shard — wllama auto-loads the rest from the same naming pattern. |
| `source.mmprojUrl` | Optional — multimodal projector GGUF, required for models with `audioInput`/vision input. |
| `nCtx` | Context window. Also sizes the KV cache, which is allocated up front regardless of prompt length — see the size note below. |
| `sampling` | Per-model overrides merged on top of `DEFAULT_SAMPLING` via `resolveSampling()` (see "Setting sampling parameters" below). |
| `reasoning` | `true` if the model emits a reasoning/thinking block. |
| `supportsMTP` | `true` if the GGUF ships MTP (multi-token prediction) draft heads. Has no runtime effect yet — see note below. |
| `needsSplit` | `true` if the GGUF is/was split into shards. Informational only. |
| `audioInput` | `true` for multimodal models that accept audio (requires `source.mmprojUrl`). |

Models with a placeholder `https://YOUR-CDN-OR-HF-REPO/...` URL are treated as
**not hosted** (`isModelHosted()`) and are skipped by the loader, so you can
add a registry entry before you've actually hosted the shards.

### Example entry

```js
{
  id: 'my-new-model-7b',             // unique slug
  name: 'My New Model 7B',           // shown in the picker
  role: 'Base model',
  quant: 'Q4_K_M',
  sizeBytes: 4.5e9,                  // ~4.5 GB
  source: {
    type: 'url',
    // >2GB, so this is the FIRST of N split shards
    url: 'https://YOUR-CDN-OR-HF-REPO/my-new-model-7b-Q4_K_M-00001-of-00009.gguf',
  },
  nCtx: 8192,
  sampling: { temperature: 0.7, top_p: 0.8, top_k: 20, min_p: 0.0, presence_penalty: 1.5, repetition_penalty: 1.0 }, // overrides DEFAULT_SAMPLING
  reasoning: false,
  supportsMTP: false,
  needsSplit: true,
},
```

Add this object to the `MODELS` array in `src/models/registry.js`, host the
split shards, replace the placeholder URL, then the model shows up in the
picker automatically — no other code changes needed.

### Splitting and hosting large GGUFs

wllama can't load a single GGUF >2 GB (ArrayBuffer limit). Split and host
larger models, then point `source.url` at the first shard:

```bash
llama-gguf-split --split-max-size 512M Qwen3.5-4B-MTP-Q4_K_M.gguf qwen35-4b-mtp
# upload the resulting *-0000N-of-0000M.gguf files to your HF repo / CDN
# point registry source.url at the FIRST shard, e.g. *-00001-of-00006.gguf
```

Models under 2 GB (e.g. `qwen3-1.7b-lite`) can point straight at a HuggingFace
`resolve/main/...gguf` URL — no splitting needed.

Note: the MTP (multi-token prediction) speedup needs speculative-decoding
support that wllama doesn't expose yet — the model runs as a plain model until
it does (`supportsMTP` is forward-looking metadata only). The app probes for
it automatically.

### Setting sampling parameters

`DEFAULT_SAMPLING` in `src/models/registry.js` defines the baseline sampling
config; a model's own `sampling` object overrides individual fields on top of
it (`resolveSampling(model)` is the single place inference reads sampling
from — don't read `model.sampling` directly elsewhere). Fields are named the
way llama.cpp's own CLI/server flags are; `wllama-context.js` maps them onto
wllama's `createChatCompletion` field names (`temp`, `penalty_repeat`,
`penalty_present`) at the call site:

- `temperature` — sampling temperature.
- `top_p`, `top_k` — nucleus/top-k truncation.
- `min_p` — 0.0 = off; minimum probability (relative to the top token) a token needs to stay in the candidate pool.
- `repetition_penalty` — 1.0 = off; >1 discourages verbatim repetition.
- `presence_penalty` — 0.0 = off; flat penalty once a token has appeared anywhere in context. Qwen3 recommends 0–2; high values can cause language-mixing, so raise cautiously.
- `penalty_freq` — 0.0 = off; scales with how often a token has appeared.
- `penalty_last_n` — window of recent tokens the penalties look back over (`-1` = whole context, `0` = disable).

Current `DEFAULT_SAMPLING` mirrors llama.cpp's `temperature=0.7, top_p=0.8,
top_k=20, min_p=0.0, presence_penalty=1.5, repetition_penalty=1.0`.

You only need to set the fields you want to override — anything omitted falls
back to `DEFAULT_SAMPLING`.

### Sizing `nCtx`

KV cache is allocated up front from `nCtx`, independent of actual prompt size.
A large `nCtx` on a multi-billion-parameter model can add several GB on top
of the model weights, overcommitting smaller GPUs — WebGPU then stalls at
inference instead of failing cleanly with an OOM error. Keep `nCtx` low enough
that weights + KV cache fit comfortably within the VRAM you expect users to
have (8192–32768 depending on model size, in the current registry).

## Privacy model (honest version)

| Data | Where it goes |
|------|---------------|
| LLM inference — **on-device** tier | never leaves the browser |
| LLM inference — **NEAR AI TEE** tier | end-to-end encrypted to an attested NEAR AI model enclave (verified in the browser first); pseudonymized; NEAR's gateway relays ciphertext |
| LLM inference — **external API** tier | the endpoint operator reads it (pseudonymized, amounts rounded) — use only for self-hosted servers |
| NEAR Confidential Intents balances | the NEAR Intents API sees your address and amounts; the private shard's validators run in TEEs; amounts stay in this tab's memory |
| Public NEAR account reads | FastNEAR, NEAR RPC and DefiLlama see the account names you look up |
| Confidential-balance **discovery** | ordinary public chain reads — no signature, no decryption, no relayer |
| Confidential-balance **plaintext** | produced in-browser; never transmitted, never written to disk |
| Confidential-balance **metadata, on reveal** | ⚠️ the decryption service learns your address + which token you asked about |
| Public chain reads | RPC + Etherscan see the queried address (use custom RPC to control) |
| Model weights | downloaded once, cached in OPFS |

### What revealing a shielded balance actually exposes

Being precise, because "encrypted" is easy to over-claim:

- **Amounts stay private.** User-decryption re-encrypts to a keypair this page
  holds, so no relayer, oracle or node operator sees the value. That part of the
  privacy claim survives fully.
- **Decrypted amounts are memory-only.** They live in React state for the session
  and are gone on reload. This is not automatic: `@zama-fhe/sdk` caches decrypted
  balances to IndexedDB by default, so `src/fhe/memory-storage.js` is passed as its
  storage backend explicitly to prevent that. Cost: one relayer round-trip per
  reveal per page load instead of a cached hit — the right trade for the guarantee.
- **But metadata leaks.** The decryption service learns your address, the token,
  and the ciphertext handle — i.e. *that you asked about a specific confidential
  balance*. Discovery leaks nothing; only revealing does.
- **Trust models differ, and are shown separately.** Zama and Fhenix use threshold
  committees (cryptographic). **Inco uses TEE-based decryption nodes — a hardware
  trust assumption, materially weaker.** The Shielded card's "How revealing works"
  panel states whichever applies to what you actually hold.

One more deliberate deviation: `@cofhe/sdk`'s default web storage backend is a
third-party cross-origin iframe (`iframe-shared-storage.vercel.app`) used to cache
FHE *public* parameters. It caches nothing secret, but this app overrides it with
in-memory storage anyway — a privacy-first app shouldn't embed a third-party frame,
and under our `COEP: credentialless` header it would be blocked and then stall on
its 30s timeout.

## Production deploy

Serve with these headers (required for SharedArrayBuffer / CPU multithread):

```
Cross-Origin-Embedder-Policy: require-corp
Cross-Origin-Opener-Policy: same-origin
```

### VPS deployment (Node + Nginx)

**1. Build the frontend on your VPS:**

```bash
git clone <your-repo> /opt/analyzer
cd /opt/analyzer
npm install
cp .env.example .env   # add VITE_ETHERSCAN_KEY
npm run build
```

**2. Run the API server as a systemd service:**

Create `/etc/systemd/system/analyzer-api.service`:
```ini
[Unit]
Description=Analyzer token API
After=network.target

[Service]
WorkingDirectory=/opt/analyzer
ExecStart=/usr/bin/node server/index.js
Environment=PORT=3001
Restart=always
User=www-data

[Install]
WantedBy=multi-user.target
```

Then enable and start:
```bash
sudo systemctl enable --now analyzer-api
```

**3. Configure Nginx:**

Create `/etc/nginx/sites-available/analyzer`:
```nginx
server {
    listen 80;
    server_name _;

    root /opt/analyzer/dist;
    index index.html;

    # Required for SharedArrayBuffer (wllama WASM multithread)
    add_header Cross-Origin-Embedder-Policy "require-corp" always;
    add_header Cross-Origin-Opener-Policy "same-origin" always;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location /api/ {
        proxy_pass http://localhost:3001;
        proxy_set_header Host $host;
    }
}
```

Enable and reload:
```bash
sudo ln -s /etc/nginx/sites-available/analyzer /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

Access at: `http://your-vps-ip`

### Serve at a subpath (e.g., `/split`)

**1. Update `vite.config.js`:**
```javascript
export default defineConfig({
  base: '/split/',  // add this
  // ... rest of config
  preview: {
    headers: crossOriginIsolation,
    proxy: { '/split/api': 'http://localhost:3001' },  // update this
  },
});
```

**2. Rebuild:**
```bash
npm run build
```

**3. Update Nginx config:**
```nginx
location /split/ {
    root /opt/analyzer/dist;
    try_files $uri /split/index.html;
}

location /split/api/ {
    proxy_pass http://localhost:3001/api/;
    proxy_set_header Host $host;
}
```

Access at: `http://your-vps-ip/split`

### HTTPS

Use certbot to generate a free certificate:
```bash
sudo certbot --nginx -d your-domain.com
```

Or use a self-signed cert for IP-based access:
```bash
sudo openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout /etc/nginx/cert.key -out /etc/nginx/cert.crt
```

Then add to Nginx:
```nginx
listen 443 ssl;
ssl_certificate /etc/nginx/cert.crt;
ssl_certificate_key /etc/nginx/cert.key;
```

**Note:** CoinGecko token icons may fail in production with `require-corp` because their CDN sends no CORP header. If you see broken icons, try `credentialless` instead — it also satisfies the SharedArrayBuffer requirement.
