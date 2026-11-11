# FHE Integration Plan — Fhenix CoFHE · Zama · Inco

> Adds confidential-token balances and a confidential-DeFi surface to the dashboard,
> behind a build-time **mainnet / testnet** mode toggle.
> Status legend: 🔬 researched · 📐 designed · ⏳ to build · ⚠️ decision needed

---

## STATUS: implemented ✅

All five phases are built. Both modes were verified against live chains (see
§11 for what the implementation changed relative to this plan).

Verified end to end:
- **Mainnet** — Zama's registry on Ethereum enumerates 9 valid wrapper pairs
  (cUSDC/cUSDT/cWETH addresses match Zama's published list). A live wallet was
  found holding a real cUSDT ciphertext handle; it renders as `1 found ·
  1 encrypted` with `•••••`, excluded from the total.
- **Testnet** — Sepolia/Arb-Sepolia/Base-Sepolia chain pills, testnet badge, a
  separate `pwai-testnet` IndexedDB, `priceMode: 'proxy'`, registry disabled.
  Zama's Sepolia registry found a `cUSDCMock` handle. CoFHE correctly reports
  `configured: false` with no demo address set.
- **Bundle** — the entry chunk contains none of the three SDKs (no `tfhe`, no
  relayer URLs, no `attestedDecrypt`). Adapters are 3–5 KB chunks; the 5 MB TFHE
  WASM is lazy.
- Clean `npm run build`; no console errors in either mode.

Not verified (needs a wallet holding a confidential balance + a signature):
the **reveal** path — decryption, permit signing, and the revealed-amount USD
math. Discovery, state handling and UI are verified; the final decrypt call is not.

---

## 1. Research findings that change the premise

The request assumed *"mainnet (as current) and testnet (to use networks supported by
fhenix)"* — i.e. that confidential tokens are a testnet-only feature. That was true a
year ago. It isn't now:

| Stack | Mainnet | Testnet | Confidential tokens live? |
|---|---|---|---|
| **Fhenix CoFHE** | ❌ none | Sepolia `11155111`, Arbitrum Sepolia `421614`, Base Sepolia `84532` | No shipped token standard/registry — per-contract only |
| **Zama Protocol** | ✅ **Ethereum `1`** (since 2025-12-30), BSC, HyperEVM | Sepolia, Hoodi | ✅ **Yes** — ERC-7984 wrappers + an *enumerable* on-chain registry |
| **Inco Lightning** | ✅ **Base `8453`** (since 2026-06-15) | Base Sepolia `84532` | ✅ Yes — confidential ERC-20, but no registry (curated list needed) |

Consequences for the design:

1. **Mainnet mode is not the "no privacy" mode.** Zama on Ethereum and Inco on Base are
   both chains the app *already* supports. The flagship "shielded balances" feature works
   on mainnet, against real value, with no new chains added.
2. **Fhenix is the testnet story.** CoFHE has no mainnet deployment, so the existing
   `ConfidentialDemo.sol` flow belongs in testnet mode — as *one entry in a list*, not as
   the whole feature.
3. **All three stacks coexist on Sepolia-family chains**, so testnet mode can exercise
   every adapter at once. That makes it the natural development/QA mode.
4. **Zama's wrapper registry is enumerable on-chain**, which means real discovery instead
   of a hardcoded token list — and it maps each wrapper to its underlying ERC-20, so
   `cUSDC` can be priced from `USDC` through the existing DefiLlama path.

Sources: [CoFHE compatibility](https://cofhe-docs.fhenix.zone/get-started/introduction/compatibility.md) ·
[Zama mainnet addresses](https://docs.zama.org/protocol/protocol-apps/addresses/mainnet/ethereum.md) ·
[Zama wrapper registry](https://docs.zama.org/protocol/protocol-apps/confidential-tokens/wrapper-registry.md) ·
[Inco on Base](https://mpost.io/inco-lightning-launches-on-base-expanding-smart-contract-privacy-with-encrypted-computation-and-data-protection/)

---

## 2. Mode design

### Env toggle

```bash
# .env
VITE_NETWORK_MODE=mainnet        # mainnet | testnet   (default: mainnet)
VITE_FHE_STACKS=zama,inco        # which adapters to enable; omit ⇒ mode default
VITE_COFHE_DEMO_ADDRESS=0x…      # testnet only (renamed from VITE_CONFIDENTIAL_DEMO_ADDRESS)
```

`import.meta.env` is **inlined at build time**, so two modes = two builds. That matches
the "toggle via env" ask, but for local work it's painful. Recommendation: env is the
source of truth, plus a dev-only runtime override in Settings (`prefs.networkModeOverride`,
visible only when `import.meta.env.DEV`) so switching doesn't need a rebuild. ⚠️

### What each mode contains

| | mainnet | testnet |
|---|---|---|
| Chains | 1, 42161, 10, 8453, 137 (unchanged) | 11155111, 421614, 84532 |
| Token universe | curated + CoinGecko registry (tier 1/2) | curated testnet list only — skip registry/tier-2 |
| Aave v3 | current addresses | none (`defi.js` already returns `null` on a missing pool) |
| Prices | DefiLlama, live | mainnet-twin proxy prices, **labelled as such** |
| FHE stacks | Zama (Ethereum), Inco (Base) | CoFHE (all 3), Zama (Sepolia), Inco (Base Sepolia) |
| Activity | Etherscan V2 | Etherscan V2 — same key, all three testnets supported |

**Multicall3 is at `0xcA11bde05977b3631167028862bE2a173976CA11` on all three testnets**, so
`balances.js` needs zero changes.

### Cache namespacing — do not skip this

`dataCache.js` opens IndexedDB `'pwai'`; `local.js` writes `pwai.cluster` / `pwai.prefs`.
Without namespacing, testnet balances get painted as mainnet values by the cache-first
path in `paintFromCache()`. Minimal correct split:

- **Namespace by mode:** the IndexedDB database name (`pwai` → `pwai-testnet`) — covers
  both `chainData` and the enriched cache.
- **Keep shared:** `pwai.cluster` (addresses are chain-agnostic) and `pwai.prefs` (theme,
  model, offload — all mode-independent).

---

## 3. Architecture

Two new layers. Everything downstream of them is unchanged or lightly extended.

```
src/config/networks.js          ← NEW: mode resolution + profile selection
  ├─ networks.mainnet.js        ← moved out of data/public.js + data/tokens.js
  └─ networks.testnet.js        ← NEW

src/data/public.js              ← becomes a thin re-export of profile.chains
src/data/tokens.js              ← becomes a thin re-export of profile.tokens/aave/slugs
        (import paths downstream stay identical — minimal diff)

src/fhe/                        ← NEW: one adapter per stack behind one interface
  ├─ index.js                   registry + lazy loader, driven by the active profile
  ├─ cofhe.js                   ← today's data/sealed.js, refactored to the interface
  ├─ zama.js
  └─ inco.js

src/data/shielded.js            ← NEW: cross-stack discovery orchestrator (mirrors enrich.js)
src/data/fheApps.js             ← NEW: curated confidential-dApp catalog per mode
```

### Adapter interface (📐)

Every stack has the same frontend shape — *authorize once, read a handle, decrypt
in-browser* — so one interface covers all three:

```js
export const meta = {
  id: 'zama',
  name: 'Zama Protocol',
  trust: 'fhe-threshold',      // 'fhe-threshold' | 'tee'  → drives the privacy badge
  relayerHost: 'relayer.zama.org',
};

export async function init({ provider, signer, chain });   // idempotent
export async function discover(owners, chain);             // → ShieldedToken[] (handles only, no decrypt)
export async function authorize(tokens);                   // EIP-712 permit(s); may be a no-op
export async function reveal(token, owner);                 // → bigint, in memory only
```

`discover()` must **never decrypt**. It returns encrypted handles so the dashboard can
show "you hold something confidential here" without a signature or a relayer round-trip.
Revealing is always an explicit user action.

### Per-stack discovery

- **Zama** — read the registry at `0xeb5015fF021DB115aCe010f23F55C2591059bBA0`:
  `getTokenConfidentialTokenPairsLength()` then `getTokenConfidentialTokenPairsSlice(from,to)`,
  then one chunked Multicall3 pass of `confidentialBalanceOf(owner)` over every valid
  wrapper. This is exactly the shape `balances.js` already implements — reuse `CHUNK=500`
  and the per-chain limiter. **Check the `isValid` flag**: a non-zero address can be revoked.
  Cache the pair list in IndexedDB (it changes rarely) and refresh on a length change.
- **Inco** — no registry. Curated list per chain in the network profile, same
  `probeBalances`-style pass against the confidential balance getter.
- **CoFHE** — no registry, no shipped token standard. Config-driven contract list; the
  existing demo contract is one entry.

### Important semantics: a non-zero handle ≠ a non-zero balance

`confidentialBalanceOf` returns a ciphertext handle. A non-zero handle only means *a
ciphertext exists* — the amount could be zero. So discovery yields "encrypted, unknown"
and the UI must not imply a positive balance. Zama's SDK distinguishes these: a never-shielded
account throws `NoCiphertextError`, whereas an actual zero returns `0n`.

---

## 4. Data model change: `shielded` becomes a list

`portfolio.js` today carries one scalar per wallet from one demo contract:

```js
sealedByAddress = { [address]: { hasValue, value } }
shielded = [{ wallet, usd }]
```

New shape — a holding list with an explicit reveal state:

```js
shielded: [{
  stack: 'zama', chainId: 1, wallet, address, symbol, name, decimals,
  underlying: '0xA0b8…',                  // from the registry → enables real pricing
  state: 'encrypted' | 'revealed' | 'error',
  amount: null,  usd: null,  change24h: null,  error: null,
}]
shieldedUsd: <sum of REVEALED only>
shieldedEncrypted: <count still hidden>
```

Rules:
- `total` includes **revealed only**. Never estimate an encrypted amount.
- The summary card shows `+ N encrypted` next to the total when `shieldedEncrypted > 0`.
- 24h delta: revealed shielded holdings now get a *real* change from the underlying's price
  feed, instead of today's "treated as flat". Small accuracy win.
- Plaintext still never touches `localStorage` or IndexedDB (see §7).

Touches: `analytics/portfolio.js`, `analytics/facts.js` (`buildClusterFacts` signature),
`state/useAppFlow.js` (`sealedByAddress` → `shielded` state + `revealToken` action
replacing the single `unlockSealed`).

---

## 5. Confidential DeFi apps — scoped honestly

The ask is "display fhenix shielded token balances **and defi apps**". Those are two
different things, and only one is fully deliverable today:

**Deliverable now — the shielded balances themselves.** Wrapped confidential tokens *are*
the primary confidential-DeFi position. Real, readable, per-wallet.

**Deliverable now — a catalog card.** `data/fheApps.js`: curated per-mode list of
confidential dApps (name, stack, chain, category, URL) rendered as a link list. Known
entries: [app.zama.org](https://app.zama.org/) (shield/unshield/transfer),
[staking.zama.org](https://staking.zama.org/), Zama governance. Explicitly labelled
"available apps", **not** "your positions" — no numbers.

**Phase 3, verify first — readable positions.** Zama staking exposes stake positions
on-chain and could become a real `defiPositions` entry. Everything else in the confidential
DeFi landscape is either testnet-only or has no stable position-read interface.

This follows the discipline already stated in `data/defi.js`: *"We deliberately do NOT
guess at AMM LP positions … that would invite fabricated numbers."* Same rule here — no
protocol gets a position row until its interface is verified.

---

## 6. Pricing in testnet mode

DefiLlama has no testnet prices, so `usd` would be `null` everywhere and the whole
dashboard would read as $0. Two options:

- **(a) Amounts only** — honest, but the summary/sparkline/24h cards go blank.
- **(b) Mainnet-twin proxy (recommended)** — add `priceProxy: { chainId: 1, address: '0xA0b8…' }`
  to testnet token entries, price through the existing `llamaKey()` path, and set a
  profile flag `priceMode: 'proxy'` that makes the UI label every figure
  *"test network — prices proxied from mainnet"*.

Recommendation: (b), because the point of testnet mode is exercising the FHE flows, and a
dashboard reading $0 makes that hard to eyeball. The label is non-negotiable.

---

## 7. Privacy model — must be updated before shipping reveal

The current claim (README + `utils/privacy.js` + `PrivacyBadge`) is that everything private
stays on-device. Revealing a confidential balance adds a network hop that the current copy
doesn't cover. Being precise about it:

- **Plaintext still never leaves the browser.** User-decryption re-encrypts to a keypair the
  browser holds; the relayer/oracle never sees the cleartext amount. The existing claim
  survives.
- **But the relayer learns metadata**: your address, the token, and the ciphertext handle —
  i.e. *that you are asking about a specific confidential balance*. That's new and must be
  disclosed.
- **Trust models differ per stack** and should be shown, not averaged: Zama = threshold-FHE
  decryption via a Zama-operated relayer; CoFHE = Fhenix threshold network; **Inco = TEE-based
  decryption nodes**, a materially different assumption (hardware trust, not cryptographic).
  The adapter's `meta.trust` field drives this.

Changes: extend `PRIVACY_COPY` in `utils/privacy.js` with a shielded-reveal dimension (the
current green/yellow/red is inference-only), add a per-stack note in the reveal confirmation,
and add rows to the README privacy table.

### ⚠️ Direct conflict to fix: SDK-side plaintext persistence

`@zama-fhe/sdk` **caches decrypted balances in IndexedDB by default**, keyed by
token+owner+ciphertext. That flatly contradicts `local.js`'s stated rule — *"Unsealed CoFHE
plaintext is NEVER persisted (kept in memory only)"*. Fix: pass an explicit in-memory
`storage` backend to `createConfig()`. Audit `@cofhe/sdk` and `@inco/lightning-js` for the
same behaviour (permits and session keys are less sensitive than amounts, but check).

---

## 8. Risks & gotchas

| Risk | Detail | Mitigation |
|---|---|---|
| **Bundle size** | Three SDKs, each shipping a multi-MB TFHE WASM blob, on top of wllama + transformers.js | Dynamic import only, per active stack — extend the existing `await import('../data/sealed.js')` pattern. Never static-import an adapter. |
| **viem arrives uninvited** | `@zama-fhe/sdk` lists `viem` as a *dependency*, not just a peer, so it ships even though the app is ethers-v6 | Use the `@zama-fhe/sdk/ethers` adapter (confirmed to exist in 3.3.0) to avoid a second *wallet* stack; accept viem in the bundle |
| **Inco + Vite** | Inco's docs state the SDK is tested against Webpack/NextJS and ask for bug reports on Rollup/Vite | Spike `@inco/lightning-js` in isolation **before** committing to Phase 3; it is the last phase for this reason |
| **CoFHE version skew** | `package.json` pins `@cofhe/sdk ^0.6.1`, but the compatibility page lists `0.5.2` as current-compatible | Verify the existing permit/decrypt path still works before refactoring it |
| **COEP** | `credentialless` is set for SharedArrayBuffer. `fetch` to relayers is fine (CORS), bundled WASM is fine — a CDN-loaded WASM would not be | Confirm each SDK bundles its WASM rather than fetching it |
| **Signature fatigue** | One EIP-712 permit per token per stack, on first reveal | Batch via `authorize(tokens)` where the stack supports it; add a "reveal all" that collects one signature per stack |
| **LLM fabrication** | The model will happily invent an encrypted amount | `portfolioFacts` must emit `"2 confidential balances present, still encrypted — amount unknown"`, and the system prompt in `prompts/wallet-analysis.js` must forbid guessing |

---

## 9. Phasing

Each phase ends at something demonstrable.

**Phase 0 — network profile layer.** ⏳
`config/networks.js` + two profiles; `public.js`/`tokens.js` become selectors; namespace the
IndexedDB cache by mode; env plumbing + `.env.example`.
*Done when:* `VITE_NETWORK_MODE=testnet` shows Sepolia/Arb-Sepolia/Base-Sepolia native
balances, activity, and proxy prices, with mainnet mode byte-identical in behaviour to today.
**No FHE code yet** — this de-risks the refactor independently.

**Phase 1 — Zama on mainnet (the centerpiece).** ⏳
Adapter interface + `fhe/zama.js` + registry discovery + `data/shielded.js` + a `Shielded.jsx`
card with per-token reveal + the portfolio/facts shape change + the privacy-model update
(including the in-memory storage fix).
*Done when:* a wallet holding cUSDC on Ethereum sees an encrypted row, reveals it with one
signature, and gets a USD figure priced from USDC.

**Phase 2 — Fhenix CoFHE on testnet.** ⏳
Refactor `data/sealed.js` → `fhe/cofhe.js` behind the interface; demo contract becomes one
config entry; wire all three CoFHE testnets.
*Done when:* the existing initialize→write→unseal demo works through the new interface, in
testnet mode, alongside Zama-Sepolia.

**Phase 3 — Inco.** ⏳
Vite-compat spike first, then `fhe/inco.js` for Base + Base Sepolia. TEE trust note in the
privacy surface.

**Phase 4 — confidential apps + LLM.** ⏳
`data/fheApps.js` catalog card; verify and add Zama staking as a real position; prompt +
`portfolioFacts` updates; README privacy table.

---

## 10. Decisions — resolved as recommended

1. **Runtime mode override in dev** — env + a dev-only Settings → Network toggle
   (`import.meta.env.DEV` gated, reloads the page). ✅
2. **Testnet pricing** — proxy from mainnet twins, labelled. Every testnet token
   carries an explicit `priceKey`; `priceMode: 'proxy'` drives the badge. ✅
3. **Zama's other mainnets** (BSC, HyperEVM) — not added; the five existing chains stand. ✅
4. **Card placement** — dedicated `Shielded.jsx`, registered in `card_order_v2`
   (5 cards, 3 in the wide column), collapsible and draggable like the rest. ✅

---

## 11. What the implementation changed

Five things came out differently from the plan. All are improvements or corrections
found by reading the SDKs rather than the docs.

1. **The Sepolia registry address didn't need an env var.** The plan left it unset
   rather than guess. `@zama-fhe/sdk`'s own chain descriptors carry
   `registryAddress` per chain, so both Ethereum (`0xeb50…bBA0`) and Sepolia
   (`0x2f07…128e`) are now built in and verified. `VITE_ZAMA_SEPOLIA_REGISTRY`
   survives only as an override.

2. **The `decimals`/`rate` question is settled, not assumed.** The plan flagged
   uncertainty about whether a wrapper's `decimals()` accounts for its `rate`. Read
   from mainnet: cUSDC is `decimals=6, rate=1` over a 6-dp underlying; cWETH is
   `decimals=6, rate=1e12` over an 18-dp underlying. Both collapse to
   `raw / 10**decimals`, so no rate math is needed. Recorded in `zama.js` with the
   arithmetic.

3. **CoFHE's default storage is a third-party iframe.** Not anticipated at all.
   `@cofhe/sdk`'s web backend proxies storage through
   `iframe-shared-storage.vercel.app`. It caches only FHE *public* parameters, so
   it is not a plaintext leak — but a privacy-first app should not embed a
   third-party frame, and under this app's `COEP: credentialless` it would be
   blocked and then stall on a 30s timeout. Overridden with in-memory storage.

4. **Discovery needs no SDK at all.** The plan assumed the Zama SDK would be
   involved. Registry reads and `confidentialBalanceOf` are ordinary view calls, so
   discovery is plain ethers + one chunked multicall — which is why the entry bundle
   stays SDK-free and discovery needs no signature or relayer. The SDK loads only
   on reveal. This is the single biggest structural win over the plan.

5. **`data/sealed.js` is gone, not just refactored.** Its unseal flow became
   `fhe/cofhe.js`; its unused `writeSealedBalance` became `writeSealedValue()` there
   (still not UI-wired — it is the only way to create something to reveal, since
   CoFHE has no token standard). See `contracts/README.md`.

### Still open

- **The reveal path is unexercised.** It needs a wallet holding a confidential
  balance and a real signature. Worth doing before trusting the USD figures.
- **Inco has no token addresses.** Both profiles ship empty lists, so the stack
  reports `configured: false`. It needs real confidential-token addresses on Base
  before it yields anything. The adapter is written and builds, but is untested
  against a live contract — the Vite-compat concern the plan raised did not
  materialise (it bundles into a 3.2 KB lazy chunk).
- **Zama staking positions** remain `positions: false` in `data/fheApps.js`,
  pending interface verification.
