// What to tell the user about private-shard (NEAR Confidential Intents)
// activity, from the historyStatus confidentialIntents.js returns.
// Pure, so the copy is testable; rendered by Activity and the Shielded card.
//
// Copy rules: say what happened and what it does NOT mean. A refused history
// is not an error in the user's account and nothing is missing from public
// explorers — private-shard activity never appears there.

export const NEAR_ACTIVITY_URL = 'https://near.com/activity';

export function historyNote(status) {
  if (!status) return null;
  switch (status.state) {
    case 'ok':
      return null; // the rows themselves are shown
    case 'empty':
      return { tone: 'muted', short: 'no history yet', title: 'No private-shard activity yet', body: 'The NEAR Intents API has no swaps, deposits or withdrawals for this account.' };
    case 'restricted':
      return {
        tone: 'info',
        short: 'history: invite-only',
        title: 'Private-shard activity can’t be listed yet',
        body:
          'Your private NEAR balances are read; the list of past swaps is missing. You can view your activity on near.com'
          + (status.demo ? ' (Demo: this is the state a signed-in user sees today.)' : ''),
        link: { href: NEAR_ACTIVITY_URL, label: 'Open near.com/activity' },
      };
    default:
      return {
        tone: 'warn',
        short: 'history unavailable',
        title: 'Private-shard activity couldn’t be loaded',
        body: `The NEAR Intents API did not return the history${status.status ? ` (HTTP ${status.status})` : ''}`
          + `${status.message && !/^Intents API HTTP \d+$/.test(status.message) ? `: "${status.message}"` : ''}. `
          + 'Balances are unaffected; it is tried again on the next refresh.',
      };
  }
}
