# Sources and attribution

The product idea is inspired by [ZKP2P](https://www.zkp2p.xyz/). This project is an independent Stellar prototype and does not claim affiliation.

The active proof integration targets [TLSNotary’s browser extension](https://github.com/tlsnotary/tlsn-extension), release `0.1.0.1501`, source commit `68bbd380d6e1a89d79748e5294661c752f5d1205`, with TLSNotary `0.1.0-alpha.15`. The local verifier patch is derived from that pinned upstream source. `scripts/prepare-tlsn.py` fetches the source and released runtime into ignored local tooling, checks hashes and preserves upstream files. Downloaded code and binaries are not committed here. Review upstream licensing and dependency notices before redistributing them.

The archived experiment reproduces the older Reclaim claim-envelope encoding independently and uses [Soroban SDK](https://github.com/stellar/rs-soroban-sdk) `29.0.1`. It is retained as a signature-compatibility reference. The active flow has no Reclaim SDK or service dependency.

Useful primary references:

- [TLSNotary extension quickstart](https://tlsnotary.org/docs/quick_start/browser_extension/)
- [TLSNotary plugins](https://tlsnotary.org/docs/extension/plugins/)
- [TLSNotary verifier](https://tlsnotary.org/docs/extension/verifier/)
- [Stellar developer documentation](https://developers.stellar.org/)
- [HackMeridian build guide](https://www.hackmeridian.com/build)

This private development repo does not grant a public license to the project’s original code. Third-party code retains its own terms.
