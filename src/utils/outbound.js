// What an off-device tier actually sends — one builder per backend, used BOTH
// by the backend to make the request and by the "review before sending"
// preview, so the preview cannot drift from the wire.
//
//   nearai   → body handed to the NEAR AI SDK's chat.completions.create; the SDK
//              encrypts the message contents to the attested model key (E2EE),
//              so this is the exact plaintext that gets encrypted.
//   external → JSON body POSTed to the local /api/llm proxy, which forwards it
//              unchanged to the configured endpoint. The API key travels in a
//              header and is never shown.

// maxTokens: from nearAiContext.outputTokenLimit (null = no cap).
export function nearAiRequestBody(model, messages, { thinking = true, maxTokens = null } = {}) {
  return {
    model, messages, stream: true, temperature: 0.7, top_p: 0.8,
    // Reasoning models otherwise think by default; with the toggle off the
    // trace is hidden anyway, and on a full wallet-facts prompt Qwen 3.8
    // spent the entire 4096-token budget thinking (2+ min, no answer).
    // vLLM honours this chat-template switch; E2EE leaves it intact.
    chat_template_kwargs: { enable_thinking: !!thinking },
    // Omitted (unlimited) → vLLM allows up to the rest of the context window.
    ...(maxTokens != null ? { max_tokens: maxTokens } : {}),
  };
}

export function externalRequestBody(model, messages) {
  return { model, messages, stream: true, temperature: 0.7, top_p: 0.8, max_tokens: 4096 };
}

// Placeholders the pseudonymizer emits — highlighted in the preview.
export const PLACEHOLDER_RE = /\b(?:WALLET|ADDR|TX|NEAR)_\d+\b/g;

// Split text into [{ text, mark }] runs for highlighting placeholders.
export function markPlaceholders(text) {
  const out = [];
  let last = 0;
  for (const m of String(text).matchAll(PLACEHOLDER_RE)) {
    if (m.index > last) out.push({ text: text.slice(last, m.index), mark: false });
    out.push({ text: m[0], mark: true });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last), mark: false });
  return out;
}

const hostOf = (url) => { try { return new URL(url).host; } catch { return String(url || ''); } };

// Everything the review dialog shows. `request` comes from the active backend's
// previewRequest(); `redacted` is null when pseudonymization is off.
export function describeOutbound({ mode, request, question, redacted }) {
  const json = JSON.stringify(request.body, null, 2);
  const placeholders = new Set(json.match(PLACEHOLDER_RE) || []);
  const near = mode === 'nearai';
  return {
    mode,
    destination: near ? 'NEAR AI Cloud' : hostOf(request.baseUrl) || 'External API',
    model: request.body.model,
    transport: near
      ? 'End-to-end encrypted to the attested model enclave. NEAR’s gateway relays ciphertext; only code inside the enclave reads this text.'
      : `HTTPS via the local helper proxy (/api/llm) to ${request.baseUrl || 'the configured endpoint'}. The endpoint operator can read this text. The API key goes in a header and is not shown.`,
    readable: near ? 'enclave' : 'operator',
    question,
    json,
    bytes: new TextEncoder().encode(JSON.stringify(request.body)).length,
    placeholders: placeholders.size,
    pseudonymized: !!redacted,
    sigFigs: redacted?.sigFigs ?? null,
  };
}
