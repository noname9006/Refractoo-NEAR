# Privacy Wallet AI — Project Plan & Build State

> Browser-based DeFi wallet analyzer that runs an LLM **fully on-device**. Inference and Fhenix
> CoFHE unsealing happen only in the browser; nothing about the analysis leaves the device.
> Status legend: ✅ built & verified · ⏳ remaining (last mile).

## 1. Goal & privacy thesis
Analyze a user's wallet **cluster** with a local LLM. Public chain reads are the one acknowledged
network touchpoint (configurable RPC). The LLM only *explains* numbers computed deterministically
in JS — it never does the math itself.

## 2. Locked decisions
| Area | Decision |
|---|---|
| Data model | **Hybrid**: public on-chain data + Fhenix CoFHE sealed data |
| Chains | Ethereum + Arbitrum + Optimism + Base (Etherscan V2 unified API) |
| Inference | **wllama** (WebGPU, CPU/WASM fallback) |
| Models | **Qwen3.5-9B-MTP** (base) · **Qwen3.5-4B** (low-resource) · **Gemma-4 E4B** (multimodal/voice) · **Qwen3-1.7B** (lite, testing). MTP runs as a plain model until wllama exposes speculative decoding |
| Voice | **Both** engines: Whisper STT (+RNNoise) *and* Gemma-4 multimodal audio |
| Cluster | One personal cluster; connecting any known wallet rehydrates all |
| Persistence | Local only — localStorage (cluster/prefs) + IndexedDB (chain data) |
| Cluster load | Cache-first + background refresh |
| Sealed data | On-demand unlock (public auto, private on click) |
| Model load | Auto by device resources; degrade 9B→4B→lite |
| UI | Guided flow · **Aurora Glass** (glassmorphism + violet/cyan/teal/magenta) · system-aware light/dark |

## 3. Architecture
```
Browser (on-device)
├─ Onboarding state machine: welcome→wallets→clusterLoad→modelLoad→voicePrompt→ready
├─ DATA (hybrid)
│   ├─ Public:  ethers v6 + Etherscan V2  → ETH/Arbitrum/Optimism/Base
│   └─ Sealed:  @cofhe/sdk permit + decryptForView (Arbitrum Sepolia, on-demand)
├─ ANALYTICS (deterministic JS): balances, token flows, risk flags
├─ INFERENCE: wllama (WebGPU → CPU fallback), split-GGUF models cached in OPFS
├─ VOICE: Whisper (transformers.js) + RNNoise  OR  Gemma-4 audio via wllama mmproj
└─ STORAGE: localStorage cluster/prefs + IndexedDB chain cache
```

## 4. Tech stack
`vite` + `react` · `@wllama/wllama` 3.4 · `ethers` v6 + Etherscan V2 · `@cofhe/sdk` 0.6
(replaced deprecated `cofhejs`) · `@huggingface/transformers` 4.2 (Whisper, lazy-loaded) ·
`@jitsi/rnnoise-wasm`. Vite config: COOP/COEP headers, `worker.format:'es'`,
`optimizeDeps.exclude` for wllama + transformers.

## 5. User flow
1. **Connect wallet** → optionally **add more** → one local cluster.
2. Connecting a **known** wallet → loads the whole cluster cache-first.
3. Cluster ready → **model auto-loads** by device resources (deviceMemory/cores/WebGPU; VRAM is
   not exposed, so it's heuristic + degrade-on-failure).
4. **One-time popup** asks about voice; "Enable" downloads Whisper (~75 MB).
5. Minimal **workspace**: cluster summary, one prompt box, "🔓 Unlock private data", streamed
   answer with hidden `<think>` reasoning. Technical readouts live behind a **Details** drawer.

## 6. Design system — "Aurora Glass"
Frosted-glass panels (`backdrop-filter` blur+saturate, translucent surfaces, hairline borders,
inner highlight) over a living mesh-gradient backdrop (violet/cyan/teal/magenta blobs + two
slowly drifting orbs, `prefers-reduced-motion` aware). Gradient title text, gradient primary
buttons with glow, glowing status dots, gradient progress/stepper. Full
`prefers-color-scheme: dark` variant. All in `src/styles.css`.

## 7. File map
```
src/
  App.jsx                     thin: Onboarding until 'ready', then Workspace
  state/useAppFlow.js         effect-driven state machine + all actions
  storage/local.js            localStorage: cluster + prefs
  storage/dataCache.js        IndexedDB: public chain data (never sealed plaintext)
  utils/gpu-detector.js       WebGPU probe (no VRAM read)
  utils/resource-detector.js  recommendModel() + degrade chain
  utils/wllama-context.js     load (incl. mmproj), stream chat, transcribe, stop
  models/registry.js          4 models + sizes/sampling/MTP/audio flags
  data/public.js              connectWallet, fetchPublicData, fetchClusterData
  data/sealed.js              @cofhe/sdk init/permit/decrypt/encrypt
  analytics/facts.js          buildFacts + buildClusterFacts (deterministic)
  prompts/wallet-analysis.js  system prompt + FACTS/user turn  ·  prompts/think-parser.js
  voice/capture.js · rnnoise.js · whisper.js · index.js   (two engines)
  components/
    Onboarding.jsx + onboarding/{Welcome,WalletStep,ClusterLoad,ModelAutoLoad}.jsx
    Workspace.jsx · DetailsDrawer.jsx · VoiceInput.jsx · VoiceModal.jsx
    WalletChip.jsx · Stepper.jsx
  styles.css                  Aurora Glass design system
contracts/ConfidentialDemo.sol + README.md   (CoFHE demo, Arbitrum Sepolia)
vite.config.js · index.html · .env.example · README.md · .claude/launch.json
```

## 8. Privacy model (stated in-app)
- ✅ Inference + sealed-value decryption: 100% local.
- ✅ Cluster + public data cached locally only; **unsealed CoFHE plaintext stays in memory, never persisted**.
- ⚠️ Model download + public chain reads are network calls; default RPC/explorer sees the queried
  address unless a custom RPC is supplied.

## 9. Verified ✅
Clean `npm run build`; full onboarding flow end-to-end in preview (new user → multi-wallet cluster
→ real balances aggregated across 4 chains → auto model → voice prompt → workspace → streamed
analysis); returning-user cache-first rehydrate (skips add-wallets, no re-prompt); RNNoise wasm
runs on real audio frames; cluster facts aggregate; Aurora Glass renders, no console errors.
*(Wallet + model were stubbed — see §10.)*

## 10. Remaining — last mile ⏳
1. **Host split GGUF shards** (9B/4B/Gemma-4 + mmproj) via `llama-gguf-split`; update placeholder
   URLs in `src/models/registry.js`. Until then auto-load degrades to the lite model.
2. **Deploy `contracts/ConfidentialDemo.sol`** to Arbitrum Sepolia; set
   `VITE_CONFIDENTIAL_DEMO_ADDRESS` (else nothing to unseal).
3. **Set `VITE_ETHERSCAN_KEY`** for tx history (balances work without it).
4. **Real-hardware smoke test**: actual MetaMask connect + a real model download were not
   exercised in the preview env; logic verified with an injected provider + stubbed model load.

## 11. Gotchas captured
- `cofhejs` deprecated → `@cofhe/sdk` (viem-based; has `Ethers6Adapter`).
- wllama 3.1+ = single WASM (`{default:url}`), 2 GB/file cap → split GGUFs; OpenAI-style streaming;
  `mmprojUrl` + `supportInputModality('audio')` for audio.
- WebGPU never exposes VRAM → try-offload-then-degrade.
- Fixed during build: `dataCache.tx()` must resolve `req.result` (not `?? req`);
  `buildClusterFacts` must set `address` *after* spreading `buildFacts()`.
