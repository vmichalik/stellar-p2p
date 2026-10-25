# Stellar testnet rehearsal

The recorded rehearsal deployed the reviewed escrow and exercised funding, reservation, payment lock, signed release, replay rejection and mutual recovery using PLTEST. [Transaction evidence](../../evidence/release/testnet-rehearsal-2026-10-25.json).

For another deployment, pin the accepted source commit, optimized WASM hash, network passphrase, RPC, token, decimals, policy public key and authorized deployer. Review the fee cap before signing. Use the approved wallet or CLI credential mechanism; keep keys outside Git.

## Capture one complete order

Record funding, reservation, lock and release transaction hashes for the same order. Reconcile buyer, seller and escrow balances. Check replay without a second payout. Use a separate held order for recovery and obtain both wallets’ approval for the exact allocation.

Keep the asset and network named in the receipt. PLTEST records testnet contract behavior; an authenticated bank-to-USDC trade needs its own matching evidence and receipt.

For the planned small mainnet trade, follow the [mainnet runbook](../../docs/release/mainnet-test.md).
