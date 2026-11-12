// Privacy posture of the current inference setup, surfaced as a green/yellow/red
// light. The whole product promise is "your data stays on your device", so this
// is deliberately conservative: anything that leaves the device is at least
// yellow, and a recognised commercial inference provider is red.
//
//   green  — model runs in-app, on this device (nothing leaves)
//   yellow — external API, but the host looks self-hosted (localhost / LAN /
//            an unrecognised domain you presumably run yourself)
//   red    — external API whose host is a known third-party inference provider
//
// The provider list is a best-effort denylist of well-known hosted-LLM APIs; it
// only drives the red vs yellow distinction, never whether a request is allowed.

const PROVIDER_HOSTS = [
  'api.openai.com',
  'api.anthropic.com',
  'openrouter.ai',
  'api.groq.com',
  'api.mistral.ai',
  'api.deepseek.com',
  'api.together.xyz',
  'api.perplexity.ai',
  'api.cohere.ai',
  'api.cohere.com',
  'generativelanguage.googleapis.com',
  'api.x.ai',
  'api.fireworks.ai',
  'api.endpoints.huggingface.cloud',
  'api.novita.ai',
  'api.deepinfra.com',
];

function hostOf(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

function isKnownProvider(host) {
  return PROVIDER_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
}

export const PRIVACY_COPY = {
  green: 'Private — your questions and data never leave this device.',
  tee:
    // Worded to stay true in every state: nothing is sent until the attestation
    // check passes, so the claim doesn't depend on whether it has run yet.
    'NEAR AI TEE — nothing is sent until this browser verifies the model’s hardware enclave; prompts are then end-to-end encrypted to it and every answer’s signature is checked. NEAR AI cannot read them, but your data does leave this device.',
  yellow:
    'External model in use — make sure this endpoint is self-hosted on your own machine or server. Otherwise your wallet data is exposed to whoever operates it.',
  red: 'Third-party inference provider in use — your private wallet data may be exposed to the provider.',
};

const PRIVACY_SHORT = {
  green: 'On-device',
  tee: 'NEAR AI TEE',
  yellow: 'External API',
  red: '3rd-party API',
};

// Returns { level, label, short } for the given prefs. Defaults to green for any
// missing/local config so the UI fails safe (claims privacy only when local).
export function privacyState(prefs) {
  if (prefs?.inference === 'nearai') {
    return { level: 'tee', label: PRIVACY_COPY.tee, short: PRIVACY_SHORT.tee };
  }
  const external = prefs?.inference === 'external';
  if (!external) {
    return { level: 'green', label: PRIVACY_COPY.green, short: PRIVACY_SHORT.green };
  }
  const level = isKnownProvider(hostOf(prefs?.externalApi?.baseUrl)) ? 'red' : 'yellow';
  return { level, label: PRIVACY_COPY[level], short: PRIVACY_SHORT[level] };
}

// --- Confidential-token reveal ----------------------------------------------
//
// A SEPARATE axis from the inference badge above, deliberately not folded into
// it. The green/yellow/red light answers "where does my LLM run"; this answers
// "what happens when I decrypt a shielded balance". Both can be true at once: an
// on-device model (green) plus a reveal that contacts a relayer.
//
// The honest position, stated precisely:
//   • Plaintext never leaves the browser. User-decryption re-encrypts to a
//     keypair this page holds, so no operator sees the amount.
//   • Decrypted amounts are memory-only — never localStorage, never IndexedDB.
//     src/fhe/memory-storage.js is what enforces that against SDKs which would
//     otherwise cache them to disk.
//   • But the decryption service DOES learn metadata: your address, the token,
//     and the ciphertext handle. It learns THAT you asked about a specific
//     confidential balance. That is new network exposure and must be disclosed.

export const REVEAL_COPY = {
  // Before any reveal: discovery is pure view calls, nothing has been decrypted.
  idle:
    'Confidential balances are encrypted. Finding them uses ordinary read-only ' +
    'chain calls — no signature, no decryption, nothing sent to any service.',
  // After at least one reveal this session.
  revealed:
    'Revealed amounts were decrypted in this browser and are held in memory for ' +
    'this session only — never written to disk. The decryption service cannot ' +
    'read your amounts, but it does learn which confidential balances you asked ' +
    'about, from your address.',
};

// Reveal posture for a set of shielded holdings.
//   'none'     — nothing confidential found; no exposure at all.
//   'idle'     — holdings found, none revealed; still zero network exposure.
//   'revealed' — at least one reveal happened, so metadata has been shared.
export function revealState(shielded = []) {
  if (!shielded.length) return { level: 'none', label: null };
  const anyRevealed = shielded.some((t) => t.state === 'revealed');
  return anyRevealed
    ? { level: 'revealed', label: REVEAL_COPY.revealed }
    : { level: 'idle', label: REVEAL_COPY.idle };
}
