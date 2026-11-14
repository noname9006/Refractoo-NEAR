# A real NEAR AI receipt

Captured 2026-11-14T20:32:15.743Z from NEAR AI Cloud, model `z-ai/glm-5.3-flash`, by
[`spike/capture-receipt.mjs`](../../spike/capture-receipt.mjs) running the app's own `NearAiContext`.

| File | What it is |
|---|---|
| `receipt.json` | Exact request/response bytes (base64), the enclave signature over them, the attested signer. Type `refractoo.nearai-receipt.v1`. |
| `request-plaintext.json` | The messages before E2EE encryption (not covered by the signature). |
| `attestation.json` | The live attestation summary and receipt checks at capture time. |

Signer (`provider_tee`, ed25519): `5a0210f2442c79355784f9de021985429561da5bacc3a4424b01ac52b7e0caff`
SHA-256 of the response bytes: `748c0086f243750ff3c097dafb7ff976b2f36bf5e0b6c5376fe0bf1dfdf49d18`

Answer (restored locally would map WALLET_n back): "WALLET_1 holds 61.756612 ETH on Ethereum (no USD value provided in the data), and WALLET_2 holds 1,523.77781 NEAR worth $5,180.84, of which some is staked in NEAR_1. Informational only — not financial"

## Verify offline

```bash
node --test tests/receipt.test.mjs
```

Or drop `receipt.json` on `/verify` in the running app.

**Established offline:** these bytes were signed by that key; one flipped byte fails.
**Not established offline:** that the key is in a genuine TDX enclave *now*: that was checked live at capture
(`attestation.json`, all checks passed). Re-proving it needs a fresh quote and nonce.
