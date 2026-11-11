// Catalog of confidential-DeFi apps, per network mode.
//
// SCOPE — read this before adding entries.
//
// This is a LINK LIST, not a positions list. Every app here is somewhere the user
// can go; none of them contributes a number to the portfolio. That restraint is
// deliberate and mirrors the rule already stated in data/defi.js: a protocol gets
// a position row only when its on-chain position interface has been verified,
// because the alternative is inventing figures.
//
// Where confidential DeFi actually stands as of this writing: the confidential
// tokens themselves (Zama's ERC-7984 wrappers) are the real, readable position —
// and those are already surfaced by data/shielded.js. Beyond them, Zama operates
// a staking app whose positions look readable but whose interface has NOT been
// verified here, and the rest of the landscape is either testnet-only or has no
// stable position-read interface. So:
//
//   positions: false  → link only. This is the default and the honest one.
//   positions: true   → only after the read path is implemented AND verified.
//
// Do not promote an entry to `positions: true` just because a protocol exists.

const ZAMA_APPS = [
  {
    stack: 'zama',
    name: 'Zama App',
    what: 'Check confidential balances, shield, unshield and transfer privately.',
    url: 'https://app.zama.org/',
    category: 'Confidential tokens',
    positions: false,
  },
  {
    stack: 'zama',
    name: 'Zama Staking',
    what: 'Stake ZAMA and manage staking positions.',
    url: 'https://staking.zama.org/',
    category: 'Staking',
    // Staking positions are likely readable on-chain. Left false until the
    // contract interface is verified and wired into data/defi.js — see the scope
    // note above.
    positions: false,
  },
];

const FHENIX_DOCS = {
  stack: 'cofhe',
  name: 'Fhenix CoFHE',
  what: 'Confidential contract tooling. No consumer app verified — docs and SDK.',
  url: 'https://cofhe-docs.fhenix.zone',
  category: 'Developer',
  positions: false,
};

const INCO_DOCS = {
  stack: 'inco',
  name: 'Inco Lightning',
  what: 'Confidential tokens and contracts on Base. No consumer app verified — docs and SDK.',
  url: 'https://docs.inco.org',
  category: 'Developer',
  positions: false,
};

const APPS = {
  mainnet: [...ZAMA_APPS, INCO_DOCS],
  // On testnet the same Zama app serves Sepolia; CoFHE's only "app" is whatever
  // confidential contract you deployed yourself (contracts/ConfidentialDemo.sol).
  testnet: [...ZAMA_APPS, FHENIX_DOCS, INCO_DOCS],
};

// Apps for a mode, narrowed to the stacks actually enabled. Passing the active
// stack ids keeps the list honest: no point linking Inco's docs in a mode where
// the Inco adapter is switched off.
export function fheApps(mode, enabledStackIds) {
  const list = APPS[mode] || [];
  if (!enabledStackIds?.length) return list;
  const enabled = new Set(enabledStackIds);
  return list.filter((a) => enabled.has(a.stack));
}
