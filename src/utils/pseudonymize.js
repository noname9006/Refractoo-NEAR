// Pseudonymization for prompts that leave the device (NEAR AI TEE, external API).
//
// The on-device model sees the real FACTS. Anything sent off-device first goes
// through pseudonymize():
//   • identifiers → stable placeholders: cluster wallets → WALLET_1.., other EVM
//     addresses → ADDR_1.., tx hashes → TX_1.., NEAR accounts → NEAR_1..
//     (full 0x…40-hex, the short "0x1234…abcd" form used in risk flags, and
//     NEAR named/implicit accounts)
//   • numbers → N significant figures, per tier (default: exact for the NEAR AI
//     TEE, whose operator can't read the prompt; 4 for an external API, ≤0.05%
//     error). An exact multi-asset balance set is a fingerprint that can be
//     matched back to one address on a block explorer.
//     Rounding, not random noise: noise of the same size hides no more, fresh
//     noise per request can be averaged away, and it reads as an exact figure.
//   • ISO dates → year-month (only when rounding)
//   • a dataNote telling the model what was replaced / rounded
// The user's question is pseudonymized with the same map, and restore() swaps
// placeholders in the model's answer back to the real short addresses —
// locally, so the user reads their own addresses and the provider never does.
//
// What this does NOT hide: which assets and chains you hold, rough magnitudes,
// and the question itself. The "who sees what" panel says so.

const EVM_FULL = /0x[a-fA-F0-9]{40}(?![a-fA-F0-9])/g;
const EVM_SHORT = /0x([a-fA-F0-9]{4})(?:…|\.{2,3})([a-fA-F0-9]{4})(?![a-fA-F0-9])/g;
const TX_HASH = /0x[a-fA-F0-9]{64}(?![a-fA-F0-9])/g;
// Named accounts (alice.near, sub.alice.near, *.tg) and 64-hex implicit accounts.
const NEAR_NAMED = /\b(?:[a-z0-9](?:[a-z0-9_-]*[a-z0-9])?\.)+(?:near|tg)\b/g;
const NEAR_IMPLICIT = /\b[a-f0-9]{64}\b/g;
const ISO_DATE = /^(\d{4}-\d{2})-\d{2}(?:T[\d:.]+Z?)?$/;

// Keys whose numbers are small counts or shares that identify nothing; kept exact.
const KEEP_EXACT = /(count|Count|walletCount|txTotal|txCount|Pct|pct)$/;

// Amount precision for off-device prompts: significant figures, 0 = exact.
export const PRECISION_OPTIONS = [0, 4, 3, 2];
export const DEFAULT_PRECISION = { nearai: 0, external: 4 };

// prefs → significant figures for a tier (0 = exact). Pure, for tests and UI.
export function precisionFor(prefs, tier) {
  const v = prefs?.roundRemote?.[tier];
  return PRECISION_OPTIONS.includes(v) ? v : (DEFAULT_PRECISION[tier] ?? 4);
}

export function roundSig(n, sig = 4) {
  if (!Number.isFinite(n) || n === 0) return n;
  const mag = Math.floor(Math.log10(Math.abs(n)));
  const factor = 10 ** (sig - 1 - mag);
  const r = Math.round(n * factor) / factor;
  // Clean binary noise (0.30000000000000004).
  return Number(r.toPrecision(sig));
}

const shortAddr = (a) => `${a.slice(0, 6)}…${a.slice(-4)}`;

// sigFigs: 0 = keep numbers and dates exact (identifiers are still replaced).
export function createPseudonymizer(clusterAddresses = [], { sigFigs = 0 } = {}) {
  const toLabel = new Map(); // canonical id (lowercase) → label
  const fromLabel = new Map(); // label → display string for restore()
  const counters = { WALLET: 0, ADDR: 0, TX: 0, NEAR: 0 };
  const cluster = clusterAddresses.map((a) => String(a).toLowerCase());

  // Pre-assign cluster wallets in cluster order so WALLET_1 is stable.
  // Display keeps the original casing (EIP-55 checksum).
  clusterAddresses.forEach((orig, i) => {
    const a = cluster[i];
    if (toLabel.has(a)) return;
    const label = `WALLET_${++counters.WALLET}`;
    toLabel.set(a, label);
    fromLabel.set(label, /^0x[a-f0-9]{40}$/.test(a) ? shortAddr(String(orig)) : String(orig));
  });

  const labelFor = (id, kind, display) => {
    const k = id.toLowerCase();
    if (!toLabel.has(k)) {
      const label = `${kind}_${++counters[kind]}`;
      toLabel.set(k, label);
      fromLabel.set(label, display);
    }
    return toLabel.get(k);
  };

  // Short "0x1234…abcd" → the full address it abbreviates, if we know one.
  const resolveShort = (head, tail) => {
    const h = `0x${head}`.toLowerCase();
    const t = tail.toLowerCase();
    for (const id of toLabel.keys()) {
      if (id.length === 42 && id.startsWith(h) && id.endsWith(t)) return id;
    }
    return null;
  };

  function text(s) {
    if (typeof s !== 'string' || !s) return s;
    return s
      .replace(TX_HASH, (m) => labelFor(m, 'TX', `${m.slice(0, 10)}…`))
      .replace(EVM_FULL, (m) => labelFor(m, cluster.includes(m.toLowerCase()) ? 'WALLET' : 'ADDR', shortAddr(m)))
      .replace(EVM_SHORT, (m, head, tail) => {
        const full = resolveShort(head, tail);
        return full ? toLabel.get(full) : labelFor(m, 'ADDR', m);
      })
      .replace(NEAR_IMPLICIT, (m) => labelFor(m, 'NEAR', `${m.slice(0, 8)}…`))
      .replace(NEAR_NAMED, (m) => labelFor(m, cluster.includes(m.toLowerCase()) ? 'WALLET' : 'NEAR', m));
  }

  function value(v, key = '') {
    if (typeof v === 'number') return !sigFigs || KEEP_EXACT.test(key) ? v : roundSig(v, sigFigs);
    if (typeof v === 'string') {
      const d = sigFigs ? ISO_DATE.exec(v) : null;
      return d ? d[1] : text(v);
    }
    if (Array.isArray(v)) return v.map((x) => value(x, key));
    if (v && typeof v === 'object') {
      const out = {};
      for (const [k, x] of Object.entries(v)) out[k] = value(x, k);
      return out;
    }
    return v;
  }

  // Placeholders → real short identifiers in model output. Models sometimes
  // write "Wallet 1" or "wallet_1", so match kind + number loosely; the
  // trailing \b keeps WALLET_1 from matching inside WALLET_12.
  // Only "Wallet 1" gets the loose space form: "NEAR 2" / "TX 1" are ordinary
  // prose ("stake NEAR 2 times"), so those need the exact underscore.
  const LABEL_RE = /\b(?:(WALLET)[_ ]|(ADDR|TX|NEAR)_)(\d+)\b/gi;
  function restore(s) {
    if (typeof s !== 'string' || !s || !fromLabel.size) return s;
    return s.replace(LABEL_RE, (m, w, kind, n) => fromLabel.get(`${(w || kind).toUpperCase()}_${n}`) ?? m);
  }

  return { text, value, restore, get size() { return fromLabel.size; } };
}

// Note for the model, matching what was actually done.
export function privacyNote(sigFigs) {
  const ids =
    `PRIVACY: identifiers in these FACTS are placeholders (WALLET_n = the user's own wallets, ` +
    `ADDR_n / NEAR_n = other accounts, TX_n = transactions). Write placeholders exactly as given ` +
    `(e.g. WALLET_1) as if they were the real addresses — the app swaps the real ones back in ` +
    `before the user reads your answer — and never mention placeholders, pseudonymization or this note.`;
  if (!sigFigs) return ids;
  return (
    `${ids} All amounts and USD values are rounded to ${sigFigs} significant figures: present ` +
    `them as approximate (e.g. "~$124,500"). This overrides the "use EXACTLY" rules.`
  );
}

// facts + question → what is safe to send, plus restore() for the answer.
export function pseudonymizeForRemote(facts, question, { sigFigs = 0 } = {}) {
  const p = createPseudonymizer(facts?.addresses || [], { sigFigs });
  const sent = p.value(facts || {});
  sent.dataNotes = [privacyNote(sigFigs), ...(Array.isArray(sent.dataNotes) ? sent.dataNotes : [])];
  return { facts: sent, question: p.text(question), restore: p.restore, labels: p.size, sigFigs };
}
