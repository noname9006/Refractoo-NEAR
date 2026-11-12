// NEAR wallet connection via @hot-labs/near-connect (HOT, Meteor, Intear,
// MyNearWallet, Nightly, …). Used for one thing: a NEP-413 signature that
// proves account ownership to the NEAR Intents API. No transactions, no access
// keys added (sign-in requests no function-call key).
//
// Lazy-loaded: the connector and its wallet manifest are fetched only when the
// user clicks "Sign with NEAR wallet".

let connectorPromise = null;

function getConnector() {
  if (!connectorPromise) {
    connectorPromise = import('@hot-labs/near-connect').then(({ NearConnector }) => new NearConnector({
      network: 'mainnet',
      // Only offer wallets that can sign NEP-413 messages.
      features: { signMessage: true },
    })).catch((e) => { connectorPromise = null; throw e; });
  }
  return connectorPromise;
}

// Opens the wallet picker if needed. → { accountId, publicKey?, wallet }
export async function connectNearWallet() {
  const connector = await getConnector();
  try {
    const { wallet, accounts } = await connector.getConnectedWallet();
    if (accounts?.[0]?.accountId) return { accountId: accounts[0].accountId, publicKey: accounts[0].publicKey, wallet };
  } catch { /* none connected yet */ }
  const wallet = await connector.connect();
  const accounts = await wallet.getAccounts();
  if (!accounts?.[0]?.accountId) throw new Error('The NEAR wallet returned no account');
  return { accountId: accounts[0].accountId, publicKey: accounts[0].publicKey, wallet };
}

// signMessage adapter for nearIdentity(): the wallet signs the NEP-413 payload.
export function nearWalletSigner({ wallet, accountId }) {
  return ({ message, recipient, nonce }) =>
    wallet.signMessage({ message, recipient, nonce, signerId: accountId, network: 'mainnet' });
}

export async function disconnectNearWallet() {
  if (!connectorPromise) return;
  try { await (await connectorPromise).disconnect(); } catch { /* already gone */ }
}
