# A real NEAR AI receipt

Captured 2026-11-14T22:54:22.638Z from NEAR AI Cloud, model `Qwen/Qwen3.8-27B`, by
[`spike/capture-receipt.mjs`](../../spike/capture-receipt.mjs) running the app's own `NearAiContext`.

| File | What it is |
|---|---|
| `receipt.json` | Exact request/response bytes (base64), the enclave signature over them, the attested signer. Type `refractoo.nearai-receipt.v1`. |
| `request-plaintext.json` | The messages before E2EE encryption (not covered by the signature). |
| `attestation.json` | The live attestation summary and receipt checks at capture time. |

Signer (`provider_tee`, ed25519): `89154a43a47684742c3d1753252bb6f49f61da9d8c84fc9b1def2df130cb2d93`
SHA-256 of the response bytes: `f837f5b00ba1d4876522bdf2abbf5a8ad863e52ceacb4b52c64653c3548ff00c`

Answer (restored locally would map WALLET_n back): "WALLET_1 and WALLET_2 together hold 61.756612 ETH on Ethereum and 1,523.77781 NEAR (staked in NEAR_1) on Near. Informational only — not financial advice."

## Verify offline

```bash
node --test tests/receipt.test.mjs
```

Or drop `receipt.json` on `/app#/verify` in the running app.

**Established offline:** these bytes were signed by that key; one flipped byte fails.
**Not established offline:** that the key is in a genuine TDX enclave *now*: that was checked live at capture
(`attestation.json`, all checks passed). Re-proving it needs a fresh quote and nonce.
