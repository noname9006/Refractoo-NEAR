// A NEAR AI answer receipt as a portable file.
//
// Holds the exact request/response bytes the SDK captured, the enclave's
// signature over them and the signer the attestation vouched for, so anyone
// can re-run the SDK's own signature check later, offline, with no key and
// no network: `verifyReceiptBundle()` here, `#/verify` in the app, or
// tests/receipt.test.mjs against fixtures/nearai-receipt/.
//
// What a bundle establishes OFFLINE: these bytes were signed by this key, and
// one flipped byte breaks it. What it does NOT establish offline: that the key
// lives in a genuine TDX enclave right now. That was checked live, when the
// answer arrived (the `liveChecks` copied from the receipt); re-proving it
// needs a fresh TDX quote + NVIDIA evidence bound to a new nonce.
import { sha256 } from '@noble/hashes/sha2';
import { bytesToHex } from '@noble/hashes/utils';

export const RECEIPT_TYPE = 'refractoo.nearai-receipt.v1';

const b64 = (u8) => {
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(s);
};
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const hex = (u8) => bytesToHex(sha256(u8));

// JSON-safe copy (the SDK's objects may hold Uint8Arrays / class instances).
function plain(v) {
  if (v instanceof Uint8Array) return { $bytes: b64(v) };
  if (Array.isArray(v)) return v.map(plain);
  if (v && typeof v === 'object') {
    const o = {};
    for (const [k, x] of Object.entries(v)) if (typeof x !== 'function' && x !== undefined) o[k] = plain(x);
    return o;
  }
  return v;
}

/** Evidence {requestBody, responseBody, signature, attestation, kind} + receipt → bundle object. */
export function buildReceiptBundle(evidence, { receipt = null, model = null, checks = null, capturedAt = new Date().toISOString() } = {}) {
  if (!evidence?.requestBody || !evidence?.responseBody) throw new Error('no captured bytes for this answer');
  return {
    type: RECEIPT_TYPE,
    capturedAt,
    model,
    kind: evidence.kind,
    signer: plain(evidence.attestation?.signer ?? evidence.signature?.signer ?? null),
    signature: plain(evidence.signature),
    requestBody: b64(evidence.requestBody),
    responseBody: b64(evidence.responseBody),
    sha256: { requestBody: hex(evidence.requestBody), responseBody: hex(evidence.responseBody) },
    // The live checks as they stood when the answer arrived. Recorded, not re-proven offline.
    liveChecks: checks ? checks.map(({ id, ok, detail }) => ({ id, ok, detail })) : null,
    receipt: receipt ? plain({ provider: receipt.provider, tier: receipt.tier, e2ee: receipt.e2ee, response: receipt.response }) : null,
  };
}

export const ESTABLISHED_OFFLINE = [
  'The response bytes in this file were signed by the key named in `signer`.',
  'The signature covers the exact request and response bytes: one flipped byte fails.',
];
export const NOT_ESTABLISHED_OFFLINE = [
  'That the signing key lives in a genuine Intel TDX enclave with an NVIDIA GPU in CC mode: checked live when the answer arrived (see liveChecks), not re-proven from this file. "Check signer against NEAR AI now" re-proves it live, with a fresh nonce.',
  'Freshness: the attestation was bound to a browser nonce at the time; this file carries no new nonce.',
  'That the key is NEAR AI’s: compare `signer` with the address the gateway attests for this model today.',
];

/**
 * Re-runs the SDK's own verifier on the bundle's bytes, as stored and with one
 * byte flipped. Pure apart from importing the SDK. Never throws on bad input.
 * @returns {{ ok, signature:{ok,code}, tamper:{ok,code,byteIndex}, hashes:{ok}, kind, signer, established, notEstablished }}
 */
export async function verifyReceiptBundle(bundle, { pinnedSigner = null } = {}) {
  const fail = (code) => ({ ok: false, signature: { ok: false, code }, tamper: null, hashes: { ok: false }, kind: bundle?.kind ?? null, signer: null, established: [], notEstablished: NOT_ESTABLISHED_OFFLINE });
  if (!bundle || bundle.type !== RECEIPT_TYPE) return fail('bundle.wrong_type');
  let req, res;
  try { req = unb64(bundle.requestBody); res = unb64(bundle.responseBody); } catch { return fail('bundle.bad_base64'); }
  const hashesOk = hex(req) === bundle.sha256?.requestBody && hex(res) === bundle.sha256?.responseBody;
  const signerAddr = String(bundle.signer?.signingAddress || '');
  if (pinnedSigner && signerAddr.toLowerCase() !== String(pinnedSigner).toLowerCase()) return { ...fail('signer.not_pinned'), signer: signerAddr };

  const { verifyModelResponse, verifyGatewayResponse } = await import('@nearai/inference-sdk');
  const verify = bundle.kind === 'provider_tee' ? verifyModelResponse : bundle.kind === 'gateway' ? verifyGatewayResponse : null;
  if (!verify) return fail('bundle.unknown_kind');
  const attestation = { signer: bundle.signer };
  const run = (responseBody) => {
    try { verify({ requestBody: req, responseBody, signature: bundle.signature, attestation }); return { ok: true, code: null }; }
    catch (e) { return { ok: false, code: e?.failure?.code || e?.code || String(e?.message || e) }; }
  };
  const signature = run(res);
  const i = res.length >> 1;
  const forged = Uint8Array.from(res); forged[i] ^= 0x01;
  const tamper = { ...run(forged), byteIndex: i };
  const ok = signature.ok && hashesOk && tamper.ok === false;
  return { ok, signature, tamper, hashes: { ok: hashesOk }, kind: bundle.kind, signer: signerAddr, established: ok ? ESTABLISHED_OFFLINE : [], notEstablished: NOT_ESTABLISHED_OFFLINE };
}

/**
 * LIVE, no API key: asks NEAR AI Cloud for fresh model attestations (new nonce
 * from this client), verifies each report (Intel TDX quote + NVIDIA GPU
 * evidence, bound to that nonce) and looks for the bundle's signer among them.
 * A match means: the key that signed this receipt is, right now, the key of an
 * attested enclave for that model. Network required; nothing from the bundle
 * except model name and signer address is sent.
 */
export async function checkSignerLive(bundle, { attestationClient, gpuVerifier } = {}) {
  const t0 = Date.now();
  const model = bundle?.model;
  const signer = String(bundle?.signer?.signingAddress || '').toLowerCase();
  const algo = bundle?.signer?.signingAlgo || 'ecdsa';
  if (!model || !signer) return { ok: false, error: 'bundle has no model or signer' };
  const sdk = await import('@nearai/inference-sdk');
  const { createSkewTolerantGpuVerifier } = await import('./nrasVerifier.js');
  const client = attestationClient || new sdk.AttestationClient();
  const fetched = await client.fetchModelAttestations({ model, signingAlgo: algo });
  const verifiers = { gpuEvidence: gpuVerifier || createSkewTolerantGpuVerifier() };
  const reports = [];
  for (const attestation of fetched.attestations) {
    try {
      const v = await sdk.verifyModelAttestation({ attestation, clientBinding: fetched.clientBinding, verifiers });
      reports.push({ ok: true, signer: String(v.signer?.signingAddress || '').toLowerCase(), tcbStatus: v.tcbStatus, gpuEvidence: v.gpuEvidence });
    } catch (e) {
      reports.push({ ok: false, error: e?.failure?.code || String(e?.message || e) });
    }
  }
  const match = reports.find((r) => r.ok && r.signer === signer) || null;
  return {
    ok: !!match,
    model,
    signer,
    nonce: fetched.clientBinding?.nonce || null,
    verifiedReports: reports.filter((r) => r.ok).length,
    totalReports: reports.length,
    match,
    at: new Date().toISOString(),
    ms: Date.now() - t0,
  };
}

export function receiptFileName(bundle) {
  const id = String(bundle?.receipt?.response?.id || 'answer').replace(/[^A-Za-z0-9_-]/g, '').slice(-24);
  return `nearai-receipt-${id}.json`;
}
