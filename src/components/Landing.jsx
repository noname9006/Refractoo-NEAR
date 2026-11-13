import { useState, useEffect, useCallback, useMemo } from 'react';

function PrismMark() {
  return (
    <svg className="prism-mark" viewBox="0 0 48 32" fill="none" strokeLinecap="round" strokeLinejoin="round"
      style={{ height: 30, width: 46 }}>
      <g stroke="var(--ink)" strokeWidth="2"><circle cx="14" cy="16" r="9" /><circle cx="25" cy="16" r="9" /><path d="M0 16H27" /></g>
      <path d="M27 16L47 6" stroke="#ea3a3a" strokeWidth="2" />
      <path d="M27 16L47 10" stroke="#f5972b" strokeWidth="2" />
      <path d="M27 16L47 14" stroke="#56b04a" strokeWidth="2" />
      <path d="M27 16L47 18" stroke="#36a3e6" strokeWidth="2" />
      <path d="M27 16L47 22" stroke="#8a5bd0" strokeWidth="2" />
    </svg>
  );
}

// Passages from Eric Hughes' "A Cypherpunk's Manifesto" (1993).
// One is picked at random per visit and shown in a retro terminal style at the page foot.
const QUOTES = [
  `Privacy is necessary for an open society in the electronic age. Privacy is not secrecy. A private matter is something one doesn't want the whole world to know, but a secret matter is something one doesn't want anybody to know. Privacy is the power to selectively reveal oneself to the world.`,

  `Since we desire privacy, we must ensure that each party to a transaction have knowledge only of that which is directly necessary for that transaction. Since any information can be spoken of, we must ensure that we reveal as little as possible. In most cases personal identity is not salient. When I purchase a magazine at a store and hand cash to the clerk, there is no need to know who I am. When I ask my electronic mail provider to send and receive messages, my provider need not know to whom I am speaking or what I am saying or what others are saying to me; my provider only need know how to get the message there and how much I owe them in fees. When my identity is revealed by the underlying mechanism of the transaction, I have no privacy. I cannot here selectively reveal myself; I must always reveal myself.`,

  `Therefore, privacy in an open society requires anonymous transaction systems. Until now, cash has been the primary such system. An anonymous transaction system is not a secret transaction system. An anonymous system empowers individuals to reveal their identity when desired and only when desired; this is the essence of privacy.`,

  `Privacy in an open society also requires cryptography. If I say something, I want it heard only by those for whom I intend it. If the content of my speech is available to the world, I have no privacy. To encrypt is to indicate the desire for privacy, and to encrypt with weak cryptography is to indicate not too much desire for privacy. Furthermore, to reveal one's identity with assurance when the default is anonymity requires the cryptographic signature.`,

  `For privacy to be widespread it must be part of a social contract. People must come and together deploy these systems for the common good. Privacy only extends so far as the cooperation of one's fellows in society. We the Cypherpunks seek your questions and your concerns and hope we may engage you so that we do not deceive ourselves. We will not, however, be moved out of our course because some may disagree with our goals.`,
];

// Tokenise text and merge short words (< 3 chars) with the word to their right
// so they form a single wider redaction bar instead of a tiny stub.
function buildUnits(tokens) {
  const units = [];
  let i = 0;
  while (i < tokens.length) {
    const t = tokens[i];
    if (!t.trim()) {
      units.push(t);   // whitespace — kept as a plain string
      i++;
    } else {
      const spaceIdx = i + 1;
      const nextIdx  = i + 2;
      if (t.length < 3 && nextIdx < tokens.length && tokens[nextIdx]?.trim()) {
        // absorb the space + next word into one unit
        units.push(t + tokens[spaceIdx] + tokens[nextIdx]);
        i += 3;
      } else {
        units.push(t);
        i++;
      }
    }
  }
  return units;
}

// ~15% of word-units are redacted at any time.
// Hover/tap reveals the word and shifts the redaction to a random visible unit.
// Every 5 seconds one redacted unit reveals and one visible unit gets redacted.
function RedactedText({ text }) {
  const tokens     = useMemo(() => text.split(/(\s+)/), [text]);
  const units      = useMemo(() => buildUnits(tokens), [tokens]);
  const wordIdxs   = useMemo(
    () => units.reduce((acc, u, i) => (u.trim() ? [...acc, i] : acc), []),
    [units]
  );

  const [redacted, setRedacted] = useState(() => {
    const n = Math.max(1, Math.round(wordIdxs.length * 0.15));
    return new Set([...wordIdxs].sort(() => Math.random() - 0.5).slice(0, n));
  });

  useEffect(() => {
    const id = setInterval(() => {
      setRedacted(prev => {
        const rArr = [...prev];
        const vArr = wordIdxs.filter(i => !prev.has(i));
        if (!rArr.length || !vArr.length) return prev;
        const reveal = rArr[Math.floor(Math.random() * rArr.length)];
        const hide   = vArr[Math.floor(Math.random() * vArr.length)];
        const next   = new Set(prev);
        next.delete(reveal);
        next.add(hide);
        return next;
      });
    }, 5000);
    return () => clearInterval(id);
  }, [wordIdxs]);

  const handleReveal = useCallback(idx => {
    setRedacted(prev => {
      if (!prev.has(idx)) return prev;
      const vArr = wordIdxs.filter(i => !prev.has(i));
      const next = new Set(prev);
      next.delete(idx);
      if (vArr.length) next.add(vArr[Math.floor(Math.random() * vArr.length)]);
      return next;
    });
  }, [wordIdxs]);

  return units.map((u, i) => {
    if (!u.trim()) return u;   // whitespace — bare string
    if (redacted.has(i)) {
      return (
        <span
          key={i}
          className="rdct"
          onMouseEnter={() => handleReveal(i)}
          onTouchStart={e => { e.preventDefault(); handleReveal(i); }}
        >
          {u}
        </span>
      );
    }
    return <span key={i}>{u}</span>;
  });
}

export default function Landing() {
  const quote = useMemo(() => QUOTES[Math.floor(Math.random() * QUOTES.length)], []);

  const launch = (e) => { e.preventDefault(); window.location.assign('/app'); };

  return (
    <div className="ob">
      <div className="ob-inner fade-in">
        <div className="ob-card center" style={{ paddingTop: 0 }}>
          <div className="ob-brand"><span className="wm">refractoo</span></div>
          <div className="ob-icon"><PrismMark /></div>

          <div>
            <h1>Your privacy-first DeFi analyst</h1>
            <p className="muted" style={{ marginTop: 18, maxWidth: 400, color: 'color-mix(in srgb, var(--ink-2) 35%, var(--ink-3))', letterSpacing: '0.04em', lineHeight: 1.7 }}>
              Analyze your wallets — NEAR private balances included — with AI in a NEAR AI enclave<br />
              your browser verifies first — or fully on your device. You choose; the app shows who sees what
            </p>
          </div>

        </div>

        <a className="btn primary big" href="/app" onClick={launch} style={{ alignSelf: 'center', marginTop: -10 }}>Launch App</a>

        <figure className="manifesto">
          <blockquote><RedactedText text={quote} /></blockquote>
          <figcaption><a href="https://cdn.nakamotoinstitute.org/docs/cypherpunk-manifesto.txt" target="_blank" rel="noreferrer">— Eric Hughes</a></figcaption>
        </figure>
      </div>
    </div>
  );
}
