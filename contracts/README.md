# ConfidentialDemo deployment (Arbitrum Sepolia)

The analyzer's CoFHE stack needs this contract deployed on a CoFHE-enabled chain.
CoFHE is **testnet-only** — Ethereum Sepolia, Arbitrum Sepolia and Base Sepolia.
Use **Arbitrum Sepolia** below; any of the three works.

## Steps

1. Clone the official starter (brings hardhat + cofhe plugins preconfigured):

   ```bash
   git clone https://github.com/FhenixProtocol/cofhe-hardhat-starter
   cd cofhe-hardhat-starter
   npm install
   ```

2. Copy `ConfidentialDemo.sol` from this folder into its `contracts/`.

3. Set your deployer key (needs Arbitrum Sepolia ETH — faucet:
   https://www.alchemy.com/faucets/arbitrum-sepolia):

   ```bash
   # .env in the starter repo
   PRIVATE_KEY=0x...
   ```

4. Deploy:

   ```bash
   npx hardhat run scripts/deploy.ts --network arb-sepolia
   ```

   (Add a deploy script targeting `ConfidentialDemo` if the starter doesn't
   have one — it's a no-constructor contract.)

5. Put the deployed address into the analyzer's `.env`, and switch the app to
   testnet mode — CoFHE has no mainnet deployment, so it is only probed there:

   ```
   VITE_NETWORK_MODE=testnet
   VITE_COFHE_DEMO_ADDRESS=0x...
   ```

   (`VITE_CONFIDENTIAL_DEMO_ADDRESS` is the old name and is still honoured.)

   To track more than one sealed value, deploy additional copies of
   `ConfidentialDemo.sol` (repeat steps 2–4 with a new address) and list them
   comma-separated in `VITE_COFHE_DEMO_ADDRESSES` instead:

   ```
   VITE_COFHE_DEMO_ADDRESSES=0xFirst...,0xSecond...
   ```

6. Write a value to have something to discover. CoFHE has no confidential-token
   standard, so unlike Zama there is no pre-existing balance to find — from the
   browser console with a wallet connected on Arbitrum Sepolia:

   ```js
   const m = await import('/src/fhe/cofhe.js');
   await m.writeSealedValue({
     address: '0x...',        // the deployed ConfidentialDemo
     value: 4200n,
     provider, signer,        // from the app's connected wallet
     chain: { chainId: 421614, name: 'Arbitrum Sepolia' },
   });
   ```

7. Reload. The **Shielded balances** card discovers the sealed value (shown as
   `•••••`, encrypted), and its reveal button decrypts it in-browser.

## Verifying the privacy claim (CP3)

Open DevTools → Network while revealing. The exchange must not carry plaintext —
decryption happens in-browser via the permit's sealing key.

Also check Application → IndexedDB afterwards: the revealed amount must appear
**nowhere** on disk. It lives in React state for the session only, which is why
`src/fhe/memory-storage.js` is handed to every FHE SDK instead of letting them
pick their own (default) persistent backend.
