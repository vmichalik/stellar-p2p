#![no_std]

use soroban_sdk::{contract, contractimpl, contracttype, symbol_short, Bytes, BytesN, Env};

// Cryptographic feasibility spike only. This authenticates signed claim bytes.
// It does not implement payment policy, source validation, replay consumption,
// intent binding, JSON parsing, escrow or settlement. No funds are handled.
#[contract]
pub struct ProofVerifier;

#[contracttype]
#[derive(Clone)]
pub struct Claim {
    pub provider: Bytes,
    pub parameters: Bytes,
    // Exact JCS-canonical context bytes, supplied by the proof adapter. No
    // payment semantics are inferred here from an unparsed context string.
    pub context: Bytes,
    pub owner: Bytes,
    pub timestamp: u64,
    pub epoch: u64,
}

fn decimal(env: &Env, mut n: u64) -> Bytes {
    let mut buf = [0u8; 20];
    let mut start = 20;
    loop {
        start -= 1;
        buf[start] = b'0' + (n % 10) as u8;
        n /= 10;
        if n == 0 {
            break;
        }
    }
    Bytes::from_slice(env, &buf[start..])
}

fn lower_hex(env: &Env, data: &BytesN<32>) -> Bytes {
    let alphabet = b"0123456789abcdef";
    let mut out = Bytes::from_slice(env, b"0x");
    for n in data.to_array() {
        out.push_back(alphabet[(n >> 4) as usize]);
        out.push_back(alphabet[(n & 15) as usize]);
    }
    out
}

fn lowercase_owner(env: &Env, value: &Bytes) -> Bytes {
    let mut out = Bytes::new(env);
    for c in value.iter() {
        out.push_back(if c >= b'A' && c <= b'F' {
            c + 32
        } else {
            c
        });
    }
    out
}

#[contractimpl]
impl ProofVerifier {
    pub fn __constructor(env: Env, trusted_signer: BytesN<20>) {
        env.storage()
            .instance()
            .set(&symbol_short!("signer"), &trusted_signer);
    }

    pub fn verify_claim(
        env: Env,
        claim: Claim,
        signature: BytesN<64>,
        recovery_id: u32,
    ) -> bool {
        if claim.owner.len() != 42 || claim.provider.len() == 0 {
            return false;
        }
        let mut info = claim.provider.clone();
        info.push_back(b'\n');
        info.append(&claim.parameters);
        info.push_back(b'\n');
        info.append(&claim.context);
        let identifier = env.crypto().keccak256(&info);

        let mut message = lower_hex(&env, &identifier.to_bytes());
        message.push_back(b'\n');
        message.append(&lowercase_owner(&env, &claim.owner));
        message.push_back(b'\n');
        message.append(&decimal(&env, claim.timestamp));
        message.push_back(b'\n');
        message.append(&decimal(&env, claim.epoch));

        let mut signed_message = Bytes::from_slice(&env, b"\x19Ethereum Signed Message:\n");
        signed_message.append(&decimal(&env, message.len() as u64));
        signed_message.append(&message);
        let digest = env.crypto().keccak256(&signed_message);
        let public_key = env.crypto().secp256k1_recover(&digest, &signature, recovery_id);
        let public_key_bytes: Bytes = public_key.into();
        let key_hash = env.crypto().keccak256(&public_key_bytes.slice(1..65));
        let key_hash_bytes: Bytes = key_hash.into();
        let address = BytesN::<20>::try_from(key_hash_bytes.slice(12..32)).unwrap();
        let trusted: BytesN<20> = env
            .storage()
            .instance()
            .get(&symbol_short!("signer"))
            .unwrap();
        address == trusted
    }
}

#[cfg(test)]
mod tests {
    extern crate std;
    use super::*;
    use serde::Deserialize;

    fn private_env() -> Env {
        Env::new_with_config(soroban_sdk::testutils::EnvTestConfig {
            capture_snapshot_at_drop: false,
        })
    }

    #[derive(Deserialize)]
    struct Vector {
        provider: std::string::String,
        parameters: std::string::String,
        context: std::string::String,
        owner: std::string::String,
        timestamp: u64,
        epoch: u64,
        signature: std::string::String,
        recovery_id: u32,
        trusted_signer: std::string::String,
    }

    fn vector() -> Vector {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../fixtures/claim.json");
        let input = std::fs::read_to_string(path).expect("Missing synthetic fixture");
        serde_json::from_str(&input).expect("Invalid synthetic fixture")
    }

    fn setup_mode(env: &Env, compiled_wasm: bool) -> (soroban_sdk::Address, Claim, BytesN<64>, u32) {
        let v = vector();
        let signer: [u8; 20] = hex::decode(v.trusted_signer)
            .unwrap()
            .try_into()
            .unwrap();
        let constructor_args = (BytesN::from_array(env, &signer),);
        let address = if compiled_wasm {
            let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("target/wasm32v1-none/release/reclaim_proof_gate.wasm");
            let wasm = std::fs::read(path).expect("Build the release WASM before running this test");
            env.register(wasm.as_slice(), constructor_args)
        } else {
            env.register(ProofVerifier, constructor_args)
        };
        let signature: [u8; 64] = hex::decode(v.signature)
            .unwrap()
            .try_into()
            .unwrap();
        let claim = Claim {
            provider: Bytes::from_slice(env, v.provider.as_bytes()),
            parameters: Bytes::from_slice(env, v.parameters.as_bytes()),
            context: Bytes::from_slice(env, v.context.as_bytes()),
            owner: Bytes::from_slice(env, v.owner.as_bytes()),
            timestamp: v.timestamp,
            epoch: v.epoch,
        };
        (address, claim, BytesN::from_array(env, &signature), v.recovery_id)
    }

    fn setup(env: &Env) -> (soroban_sdk::Address, Claim, BytesN<64>, u32) {
        setup_mode(env, false)
    }

    #[test]
    fn synthetic_claim_verifies_with_digest_computed_in_soroban() {
        let env = private_env();
        let (address, claim, sig, recovery_id) = setup(&env);
        let client = ProofVerifierClient::new(&env, &address);
        assert!(client.verify_claim(&claim, &sig, &recovery_id));
    }

    #[test]
    fn changing_any_signed_claim_component_is_rejected() {
        let env = private_env();
        let (address, claim, sig, recovery_id) = setup(&env);
        let client = ProofVerifierClient::new(&env, &address);
        for part in 0..6 {
            let mut changed = claim.clone();
            match part {
                0 => changed.provider.push_back(b'x'),
                1 => changed.parameters.push_back(b' '),
                2 => changed.context.push_back(b' '),
                3 => {
                    changed.owner.set(
                        2,
                        if changed.owner.get(2).unwrap() == b'0' { b'1' } else { b'0' },
                    );
                }
                4 => changed.timestamp += 1,
                _ => changed.epoch += 1,
            }
            assert!(!client.verify_claim(&changed, &sig, &recovery_id));
        }
    }

    #[test]
    fn untrusted_signer_is_rejected() {
        let env = private_env();
        let (_, claim, sig, recovery_id) = setup(&env);
        let wrong = BytesN::from_array(&env, &[0u8; 20]);
        let address = env.register(ProofVerifier, (wrong,));
        let client = ProofVerifierClient::new(&env, &address);
        assert!(!client.verify_claim(&claim, &sig, &recovery_id));
    }

    #[test]
    #[ignore = "build the release WASM first; see the archive README"]
    fn compiled_wasm_verifies_synthetic_claim_and_rejects_changed_fields() {
        // Separate default-budget environments prevent earlier calls consuming
        // later calls' budget. No snapshot files containing claims are written.
        for part in 0..7 {
            let env = private_env();
            let (address, mut claim, sig, recovery_id) = setup_mode(&env, true);
            match part {
                1 => claim.provider.push_back(b'x'),
                2 => claim.parameters.push_back(b' '),
                3 => claim.context.push_back(b' '),
                4 => {
                    claim.owner.set(
                        2,
                        if claim.owner.get(2).unwrap() == b'0' { b'1' } else { b'0' },
                    );
                }
                5 => claim.timestamp += 1,
                6 => claim.epoch += 1,
                _ => (),
            }
            let client = ProofVerifierClient::new(&env, &address);
            assert_eq!(client.verify_claim(&claim, &sig, &recovery_id), part == 0);
        }
    }
}
