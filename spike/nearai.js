// Spike: does @nearai/inference-sdk bundle in Vite and run in the browser
// under our COOP/COEP headers? Not product code.
import {
  AttestationClient,
  InferenceClient,
  verifyGatewayAttestation,
} from '@nearai/inference-sdk';

const out = document.getElementById('out');
const log = (...a) => {
  out.textContent += '\n' + a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x, null, 1))).join(' ');
};
const reset = (t) => { out.textContent = t; };
window.__spike = { results: [] };

const ms = (t0) => `${Math.round(performance.now() - t0)} ms`;

document.getElementById('gw').onclick = async () => {
  reset('Gateway attestation…');
  const t0 = performance.now();
  try {
    const ac = new AttestationClient();
    const fetched = await ac.fetchGatewayAttestation({ signingAlgo: 'ed25519' });
    log('fetched, nonce', fetched.clientBinding.nonce.slice(0, 16) + '…', ms(t0));
    const v = await verifyGatewayAttestation(fetched);
    const summary = {
      ok: true,
      tcbStatus: v.tcbStatus,
      advisoryIds: v.advisoryIds,
      signer: v.signer,
      tlsBinding: v.tlsBinding?.kind,
      keys: Object.keys(v),
      time: ms(t0),
    };
    log('VERIFIED', summary);
    window.__spike.results.push({ step: 'gateway', ...summary });
  } catch (e) {
    log('FAILED', String(e), e?.code || '', e?.stack?.split('\n').slice(0, 4).join('\n') || '');
    window.__spike.results.push({ step: 'gateway', ok: false, error: String(e) });
  }
};

document.getElementById('chat').onclick = async () => {
  const apiKey = document.getElementById('key').value.trim();
  const model = document.getElementById('model').value.trim();
  if (!apiKey) return reset('enter a key');
  reset(`E2EE chat with ${model}…`);
  const t0 = performance.now();
  try {
    const client = new InferenceClient({ apiKey, e2ee: true });
    const att = await client.verify(model);
    log('verify():', { models: att.models.length, gatewayTcb: att.gateway.tcbStatus, modelTcb: att.models.map((m) => m.tcbStatus) }, ms(t0));
    const completion = await client.chat.completions.create({
      model,
      messages: [{ role: 'user', content: 'Reply with exactly: private hello' }],
      max_tokens: 64,
    });
    log('answer:', completion.choices[0]?.message?.content ?? '', ms(t0));
    const verified = await client.verifyResponse(completion.id);
    log('verifyResponse:', { kind: verified.signatureKind, id: verified.id }, ms(t0));
    window.__spike.results.push({ step: 'chat', ok: true, kind: verified.signatureKind });
  } catch (e) {
    log('FAILED', String(e), e?.code || '');
    window.__spike.results.push({ step: 'chat', ok: false, error: String(e) });
  }
};
