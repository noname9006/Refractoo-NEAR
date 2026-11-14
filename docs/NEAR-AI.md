# NEAR AI integration notes

Technical notes behind Refractoo's NEAR AI TEE tier and Confidential Intents sign-in. For the product overview see the [README](../README.md).

## Confidential Intents sign-in

**Confidential Intents sign-in needs a versioned nonce.** The Intents auth
APIs reject a plain random nonce — Aurora with a bare `401 Signature
verification failed`, 1Click with `invalid nonce` — even though the same
payload passes `intents.near` `simulate_intents`. Sign-in builds the nonce like
the official SDK (`VersionedNonceBuilder`): magic prefix, `intents.near`
`current_salt`, the message deadline and the current time, see
[`nep413.js`](../src/near/nep413.js). Live tests sign in with throwaway NEP-413 and
ERC-191 keys and read balances on every `npm test` run that has the Intents key.

## Reasoning controls, per NEAR AI model

NEAR AI Cloud has no single reasoning switch: every model (and every provider
behind the gateway) honours a different parameter, and a wrong one is silently
ignored. Sending `enable_thinking` to every model — what the app did before —
left the Think toggle dead on Kimi and DeepSeek V3.2, and on GLM-5.3 moved the
reasoning into the answer text.

The assistant now has **Think** (on/off) and, where the model has levels, an
**Effort** selector next to it. Each request carries the parameter that model
honours:

| Model | Tier | Think off | Think on | Effort levels |
|---|---|---|---|---|
| `z-ai/glm-5.3-flash` (default) | NEAR TEE | `reasoning_effort: "low"` (~15 reasoning tokens; there is no true off) | model default + `thinking_token_budget` | — |
| `Qwen/Qwen3.8-27B` (+ abliterated) | NEAR TEE | `chat_template_kwargs.enable_thinking: false` | `enable_thinking: true` | low, medium, xhigh |
| `deepseek-ai/DeepSeek-V4.1-Flash-1017` (+ abliterated) | NEAR TEE | `enable_thinking: false` | `enable_thinking: true` | low, high, xhigh, max |
| `Qwen/Qwen3.6-35B-A3B-FP8`, unknown models | NEAR TEE | `enable_thinking: false` | `enable_thinking: true` | — |
| `z-ai/glm-5.3` | 3P TEE (Tinfoil) | cannot be switched off — the toggle is locked on | model default + `thinking_token_budget` | low, high, max |
| `moonshotai/kimi-k3` | 3P TEE (Chutes) | `chat_template_kwargs.thinking: false` | model default | low, high, xhigh |
| `moonshotai/kimi-k2.6` | 3P TEE (Chutes) | `chat_template_kwargs.thinking: false` | model default | — |
| `deepseek/deepseek-v3.2` | 3P TEE (Chutes) | nothing sent (does not reason by default) | `reasoning_effort` (default `medium`) | low, medium, high |

- An effort the current model does not accept is never sent (Qwen3.8 answers
  `high` with a 400, DeepSeek V4.1 rejects `medium`).
- **Reasoning budget** (Settings) is still the shared `max_tokens` cap; on the
  two GLM models it is also sent as `thinking_token_budget`, the only parameter
  that really caps their reasoning. Without it GLM-5.3 Flash stops thinking at
  8192 tokens whatever the budget says; "Unlimited" sends `null`.
- The **review-before-sending** dialog shows these parameters: it is built by
  the same function as the request.

**How this was established.** The NEAR AI docs
([reasoning models](https://docs.near.ai/cloud/reasoning-models)) cover only
part of the catalog, so every row was measured against the live API with
[`spike/reasoning-probe.mjs`](../spike/reasoning-probe.mjs) on 2026-11-14: 11
models × 14 parameter variants, one fixed prompt with no wallet data, counting
reasoning tokens and rejected values. Run it again when the catalog changes:

```bash
node spike/reasoning-probe.mjs                      # the default model set
node spike/reasoning-probe.mjs moonshotai/kimi-k3   # specific models
```

It needs `NEARAI_API_KEY` (env or `.env`) and costs a few cents. Limits of the
measurement: one run per variant on an easy prompt, so on/off and rejected
values are solid, while the difference *between* accepted effort levels on
Qwen3.8 and DeepSeek V4.1 Flash did not show.

**Tests** ([`tests/reasoningProfiles.test.mjs`](../tests/reasoningProfiles.test.mjs),
offline): each model gets the switch it honours; an effort is sent only when the
model accepts that value; a model with no off switch always reasons; the budget
maps to `thinking_token_budget` only on GLM; `nearAiRequestBody` carries the
result. [`tests/outbound.test.mjs`](../tests/outbound.test.mjs) still proves the
previewed body deep-equals what is handed to the NEAR AI SDK.

## Context window and chat cost

- **Max context when choosing a model.** The model list in the assistant header
  and both model selects in Settings show each model's context window
  (`1.05M ctx`, `262k ctx`): NEAR AI models from the public catalog
  (`/v1/model/{id}` → `contextLength`), on-device models from the registry's
  `nCtx`.
- **Context fill in the current chat.** A strip above the messages shows
  `Context 4.8k / 1.05M · <1%` with a bar (amber from 70%, red from 90%).
  "Used" is what the last answer's request carried — prompt + completion
  tokens — i.e. what the next question will bring along. The counts come from
  NEAR AI's own usage chunk (`stream_options.include_usage`, visible in the
  review dialog), not from a local tokenizer estimate. They are stored on the
  message, so the meter survives a reload and follows the chat you switch to.
  On-device and external-API tiers do not report usage; there the strip shows
  only the maximum.
- **Chat cost (estimate).** `Chat cost ≈ $0.0005`: token counts × the model's
  public price, summed over the chat's answers.

**Balance and spend limits cannot be read with the API key.** Checked against
the docs and live ([`spike/key-info-probe.mjs`](../spike/key-info-probe.mjs)): the
balance and usage endpoints (`/v1/organizations/{org_id}/usage/balance`, API-key
usage history, spend limits) accept only a cloud.near.ai session token and
answer an inference key with 401/404; completions carry no rate-limit headers.
The inference key can read exactly two things: the usage chunk of its own
request, and that request's cost via `POST /v1/billing/costs`. So the app shows
what it can stand behind — per-chat tokens and an estimated cost — and does not
ask for an account session token, which would be a far broader credential than
the app needs.

**Tests** ([`tests/usage.test.mjs`](../tests/usage.test.mjs), offline): token
formatting, reading the usage chunk, cost = tokens × price with an unknown price
giving "unknown" (never $0), context fill taken from the last answer that
reported usage and capped at 100%, the per-chat cost sum, and that the request
asks for the usage chunk.
