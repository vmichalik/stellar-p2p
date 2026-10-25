# Archived signature experiment

This is an earlier Reclaim-format signature adapter and Soroban verification spike. The active project uses TLSNotary. These files are retained as a reference for claim encoding and signer recovery; do not reconnect the retired service as part of setup.

The contract verifies signed claim bytes against a configured signer. It has no source validation, payment policy, order binding, replay protection or escrow. A successful signature check cannot release funds.

The original private proof and service-specific provider configuration are excluded. Tests here use a public disposable fixture key and fabricated claim data. The fixture contains no bank record, service attestor or funded wallet.

## Run the synthetic checks

```sh
npm --prefix archive/reclaim ci
npm run test:legacy
cargo test --locked --manifest-path archive/reclaim/contract/Cargo.toml
```

The compiled-WASM test is ignored by default. To exercise it, build the module and run that test explicitly:

```sh
stellar contract build --locked \
  --manifest-path archive/reclaim/contract/Cargo.toml
cargo test --locked --manifest-path archive/reclaim/contract/Cargo.toml \
  compiled_wasm_verifies_synthetic_claim_and_rejects_changed_fields -- --ignored
```

The Rust target, compatible toolchain and Stellar CLI must already be installed. The checked tool versions are Rust 1.99.1 and Stellar CLI 28.1.0 on Apple Silicon macOS. This SDK requires the Stellar CLI build step to prepare the contract spec correctly. No command here deploys a contract or retrieves a bank proof.

`scripts/generate-fixture.mjs` regenerates the deterministic, public JSON fixture. The old live-proof inspection and provider-discovery scripts were omitted because they depend on the retired service or private account material.
