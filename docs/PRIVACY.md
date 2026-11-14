# Privacy model

Exactly who can see what, per party and per AI tier. For the product overview see the [README](../README.md).

| Data | Where it goes |
|------|---------------|
| LLM inference — **on-device** tier | never leaves the browser |
| LLM inference — **NEAR AI TEE** tier | end-to-end encrypted to an attested NEAR AI model enclave (verified in the browser first); pseudonymized; NEAR's gateway relays ciphertext |
| LLM inference — **external API** tier | the endpoint operator reads it (pseudonymized, amounts rounded) — use only for self-hosted servers. It is relayed through this app's own server (`/api/llm`), so the app's host relays it too, with your API key in a header |
| NEAR Confidential Intents balances | the NEAR Intents API (Aurora) sees your account/address and amounts — the one party outside a TEE that does; the private shard's permissioned validators hold the state inside TEEs (hardware trust); the public chain and explorers see nothing; amounts stay in this tab's memory |
| Public NEAR account reads | FastNEAR and NEAR RPC see the account names you look up; DefiLlama sees which tokens are priced |
| FHE confidential-balance **discovery** | ordinary public chain reads — no signature, no decryption, no relayer |
| FHE confidential-balance **plaintext** | produced in-browser; never transmitted, never written to disk |
| FHE confidential-balance **metadata, on reveal** | ⚠️ the decryption service learns your address + which token you asked about |
| Public chain reads | RPC + Etherscan see the queried address. The provider list is set in `src/config` (no in-app RPC setting) |
| **App hosting** (the server serving the page) | never receives your wallet addresses or balances; sees your IP, page loads, the token contracts whose icons are looked up (`/api/coinicon`) and — external tier only — the relayed AI request |
| Model weights | downloaded once, cached in OPFS |

## Server-side storage: none

**This app stores nothing server-side after a response returns.** Your wallets,
balances, prompts, answers, API keys and attestation results exist only in your
browser tab (plus the browser's own `localStorage`/OPFS for settings, layout and
model files). The code makes this checkable — the whole backend is
[`server/`](../server/), about 500 lines:

- **NEAR AI TEE tier and on-device tier: the server is not involved.** The browser
  talks to `cloud-api.near.ai` directly (attestation, E2EE chat, signature check).
  No request is relayed through this app's server.
- **`/api/llm` (external-API tier only)** is a pass-through proxy
  ([`server/llm.js`](../server/llm.js)): it reads the body into memory, forwards it,
  and pipes the reply back. It does not write, log or cache the body, the
  `x-llm-api-key` header or the response.
- **`/api/coinicon`, `/api/tokenlist`** serve the public CoinGecko token list; the
  only file the server ever writes is that public list
  ([`server/cache/tokenlist.json`](../server/coingecko.js)). `/api/sysinfo` reads the
  host machine's own specs and persists nothing.
- The server has no database, no request logging and no session state.

The app shows the same thing per party in the tier panel ("Every party, and what it sees",
`src/data/trustBoundaries.js`); `tests/trustBoundaries.test.mjs` checks it against the code.

## What revealing a shielded balance actually exposes

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
