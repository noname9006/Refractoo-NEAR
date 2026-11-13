import { trustRows, TRUST_COLUMNS } from '../../data/trustBoundaries.js';

// "Every party, and what it sees" — a row per party this app talks to (see
// data/trustBoundaries.js). Rows for the AI tier not in use are dimmed.

const GROUPS = [
  ['you', 'You'],
  ['app', 'This app’s hosting'],
  ['public', 'Public data sources'],
  ['near', 'NEAR private shard (Confidential Intents)'],
  ['ai', 'AI tiers'],
];
const MARK = { yes: 'Sees', no: 'No', part: 'Partly' };
// The badge already says yes/no; drop a leading "No — " / "Yes — " and bare "No"/"Yes".
const detail = (t) => String(t).replace(/^(No|Yes)( — |$)/, '');

export default function TrustBoundaries({ prefs }) {
  const rows = trustRows(prefs);
  return (
    <div className="tier-scroll">
      <table className="trust-table">
        <thead>
          <tr>
            <th>Party</th>
            {TRUST_COLUMNS.map(([k, label]) => <th key={k}>{label}</th>)}
            <th>What else it learns</th>
          </tr>
        </thead>
        {GROUPS.map(([g, title]) => (
          <tbody key={g}>
            <tr className="trust-group"><th colSpan={TRUST_COLUMNS.length + 2}>{title}</th></tr>
            {rows.filter((r) => r.group === g).map((r) => (
              <tr key={r.id} className={[r.offTier && 'off', r.group === 'you' && 'self'].filter(Boolean).join(' ')} data-party={r.id}>
                <th scope="row">{r.party}{r.offTier && <span className="trust-off"> · tier not in use</span>}</th>
                {TRUST_COLUMNS.map(([k]) => (
                  <td key={k} className={`tv-${r[k].v}`}>
                    <span className="trust-mark">{MARK[r[k].v]}</span>
                    {detail(r[k].t) && <span className="trust-t">{detail(r[k].t)}</span>}
                  </td>
                ))}
                <td className="trust-other">{r.other}</td>
              </tr>
            ))}
          </tbody>
        ))}
      </table>
    </div>
  );
}
