// GPU-evidence verifier for NEAR AI model attestation, tolerant of client clock
// skew.
//
// Why this exists: @nearai/inference-sdk 0.3.0 checks NVIDIA's NRAS JWT with no
// clock tolerance (`nbf`/`iat` must not be in the future by even one second).
// A machine whose clock lags a few seconds — common on Windows without recent
// NTP sync — fails every model verification with `not_yet_valid`, which would
// make the TEE tier unusable for that user. The SDK lets the caller replace
// only the GPU-evidence verifier (modelVerification.verifiers.gpuEvidence);
// TDX quote checks, the model nonce binding, the signer, E2EE key selection and
// response signatures all stay inside the SDK.
//
// This keeps every check the SDK's own verifier makes:
//   • JWT signature from NVIDIA's published JWKS, algorithm ES384 only
//   • issuer === https://nras.attestation.nvidia.com
//   • exp / nbf / iat required, validated with a bounded tolerance
//   • eat_nonce must equal the nonce inside the submitted GPU payload (the SDK
//     separately binds that payload nonce to its own fresh client nonce)
//   • x-nvidia-overall-att-result must be true
// The only difference is CLOCK_TOLERANCE_S.

import { createLocalJWKSet, jwtVerify } from 'jose';
import { CLOCK_TOLERANCE_S } from './nearAiContext.js';

const NVIDIA_ISSUER = 'https://nras.attestation.nvidia.com';
const NVIDIA_JWKS_URL = `${NVIDIA_ISSUER}/.well-known/jwks.json`;
// Browser default in the SDK: NVIDIA NRAS does not send CORS headers, so the
// payload goes through NEAR AI's forwarding proxy. The proxy cannot forge the
// verdict — the JWT is checked against NVIDIA's own keys below.
const NRAS_URL = 'https://cloud.near.ai/api/proxy/nras/v3/attest/gpu';
export { CLOCK_TOLERANCE_S };

export class GpuEvidenceError extends Error {
  constructor(reason, cause) {
    super(`GPU attestation check failed: ${reason}`);
    this.name = 'GpuEvidenceError';
    this.reason = reason;
    if (cause) this.cause = cause;
  }
}

const isHex32 = (s) => typeof s === 'string' && /^(0x)?[0-9a-fA-F]{64}$/.test(s);
const normHex = (s) => s.replace(/^0x/i, '').toLowerCase();

// The JWKS rarely changes; cache it, but refetch after an hour or when a token
// names a key we don't have (NVIDIA rotated keys while the tab stayed open).
const JWKS_TTL_MS = 60 * 60 * 1000;
let jwksPromise = null;
let jwksAt = 0;
function getJwks(fetchImpl, { force = false } = {}) {
  if (force || !jwksPromise || Date.now() - jwksAt > JWKS_TTL_MS) {
    jwksAt = Date.now();
    jwksPromise = (async () => {
      const r = await fetchImpl(NVIDIA_JWKS_URL);
      if (!r.ok) throw new GpuEvidenceError(`jwks_http_${r.status}`);
      const raw = await r.json();
      if (!raw || !Array.isArray(raw.keys)) throw new GpuEvidenceError('invalid_jwks');
      return createLocalJWKSet(raw);
    })().catch((e) => { jwksPromise = null; throw e; });
  }
  return jwksPromise;
}

// Pure claim checks, exported for tests.
export function checkClaims(claims, expectedNonce, nowS = Date.now() / 1000, tol = CLOCK_TOLERANCE_S) {
  if (!claims || typeof claims !== 'object') throw new GpuEvidenceError('invalid_claims');
  for (const k of ['exp', 'nbf', 'iat']) {
    if (!Number.isInteger(claims[k])) throw new GpuEvidenceError('invalid_claims');
  }
  if (claims.iat > nowS + tol) throw new GpuEvidenceError('not_yet_valid');
  if (!isHex32(claims.eat_nonce)) throw new GpuEvidenceError('invalid_claims');
  if (normHex(claims.eat_nonce) !== normHex(expectedNonce)) throw new GpuEvidenceError('nonce_mismatch');
  if (claims['x-nvidia-overall-att-result'] !== true) throw new GpuEvidenceError('attestation_rejected');
}

export function createSkewTolerantGpuVerifier({ fetchImpl = (...a) => fetch(...a), nrasUrl = NRAS_URL } = {}) {
  return async (nvidiaPayload) => {
    let nonce;
    try {
      nonce = JSON.parse(nvidiaPayload)?.nonce;
    } catch (e) {
      throw new GpuEvidenceError('payload_invalid', e);
    }
    if (!isHex32(nonce)) throw new GpuEvidenceError('payload_nonce_missing');

    const [token, jwks] = await Promise.all([
      (async () => {
        const r = await fetchImpl(nrasUrl, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: nvidiaPayload,
        });
        if (!r.ok) throw new GpuEvidenceError(`nras_http_${r.status}`);
        const raw = await r.json();
        // NRAS v3 returns [["JWT", "<overall token>"], { "GPU-0": [...], ... }]
        const t = Array.isArray(raw) && Array.isArray(raw[0]) ? raw[0][1] : null;
        if (typeof t !== 'string' || !t) throw new GpuEvidenceError('nras_response_invalid');
        return t;
      })(),
      getJwks(fetchImpl),
    ]);

    const verifyWith = (keys) => jwtVerify(
      token,
      (header, sig) => {
        if (header.kid === undefined) throw new GpuEvidenceError('key_not_found');
        return keys(header, sig);
      },
      {
        algorithms: ['ES384'],
        issuer: NVIDIA_ISSUER,
        requiredClaims: ['exp', 'nbf', 'iat'],
        clockTolerance: CLOCK_TOLERANCE_S,
      }
    );

    let payload;
    try {
      try {
        ({ payload } = await verifyWith(jwks));
      } catch (e) {
        // Unknown kid: NVIDIA may have rotated keys — refetch once and retry.
        if (e?.code !== 'ERR_JWKS_NO_MATCHING_KEY') throw e;
        ({ payload } = await verifyWith(await getJwks(fetchImpl, { force: true })));
      }
    } catch (e) {
      if (e instanceof GpuEvidenceError) throw e;
      const reason = e?.code === 'ERR_JWT_EXPIRED' ? 'expired'
        : e?.code === 'ERR_JWKS_NO_MATCHING_KEY' ? 'key_not_found' : 'jwt_invalid';
      throw new GpuEvidenceError(reason, e);
    }
    checkClaims(payload, nonce);
  };
}
