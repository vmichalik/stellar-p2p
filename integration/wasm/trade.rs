use std::{io::Write, path::PathBuf, process::{Command, Stdio}};
use pactlane_escrow::{EscrowClient, PaymentClaim, State, Terms};
use serde_json::{json, Value};
use soroban_sdk::{symbol_short, testutils::{Address as _, Ledger}, token, Address, Bytes, BytesN, Env, String as SString};

const NETWORK: &str = "Test SDF Network ; September 2015";

fn root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..")
}

fn node(phase: &str, input: &Value) -> Value {
    let mut child = Command::new("node")
        .arg(root().join("integration/policy-bridge.mjs"))
        .arg(phase)
        .current_dir(root())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn().expect("start local Node integration bridge");
    child.stdin.take().unwrap().write_all(input.to_string().as_bytes()).unwrap();
    let result = child.wait_with_output().unwrap();
    assert!(result.status.success(), "local bridge failed: {}", std::string::String::from_utf8_lossy(&result.stderr));
    serde_json::from_slice(&result.stdout).expect("bridge JSON")
}

fn text<'a>(value: &'a Value, key: &str) -> &'a str {
    value[key].as_str().expect(key)
}

fn address(env: &Env, value: &str) -> Address {
    Address::from_string(&SString::from_str(env, value))
}

fn bytes32(env: &Env, value: &str) -> BytesN<32> {
    BytesN::from_array(env, &hex::decode(value).unwrap().try_into().unwrap())
}

#[test]
fn app_policy_and_compiled_escrow_release_once_after_a_timely_synthetic_payment() {
    let wasm_path = std::env::var("PACTLANE_ESCROW_WASM").expect("set PACTLANE_ESCROW_WASM; this rehearsal requires compiled WASM");
    let wasm = std::fs::read(wasm_path).expect("read compiled escrow artifact");
    let env = Env::new_with_config(soroban_sdk::testutils::EnvTestConfig { capture_snapshot_at_drop: false });
    // Synthetic actor authorization only. The separate escrow suite checks
    // missing/wrong actor auth; this rehearsal checks the actual policy signature.
    env.mock_all_auths();
    env.ledger().set_timestamp(1_000);
    env.ledger().set_network_id(env.crypto().sha256(&Bytes::from_slice(&env, NETWORK.as_bytes())).to_array());

    let prepared = node("prepare", &json!({}));
    let seller = Address::generate(&env);
    let buyer = Address::generate(&env);
    let admin = Address::generate(&env);
    let token = env.register_stellar_asset_contract_v2(admin).address();
    let amount: i128 = text(&prepared, "tokenAtoms").parse().unwrap();
    assert_eq!(amount, 220_000_000);
    token::StellarAssetClient::new(&env, &token).mint(&seller, &amount);
    let contract = env.register(wasm.as_slice(), (token.clone(), bytes32(&env, text(&prepared, "signerPublicKeyHex"))));
    let client = EscrowClient::new(&env, &contract);
    let terms = Terms {
        seller: seller.clone(), token_amount: amount,
        fiat_minor: text(&prepared, "fiatMinor").parse().unwrap(),
        currency: symbol_short!("EUR"), rail: symbol_short!("revolut"),
        recipient: bytes32(&env, text(&prepared, "recipient")),
        offer_expires_at: 4_000, reservation_seconds: 900,
    };
    let id = client.fund(&terms);
    client.reserve(&id, &buyer);
    assert_eq!(client.get_order(&id).state, State::Reserved);
    client.begin_payment(&id);
    let paying = client.get_order(&id);
    assert_eq!(paying.state, State::Paying);
    let balances = token::Client::new(&env, &token);
    assert_eq!(balances.balance(&contract), amount);
    assert_eq!(balances.balance(&buyer), 0);

    // Prove a timely synthetic payment after pay_by. Escrow remains held while
    // the app's first verification attempt fails; no bank request is made.
    env.ledger().set_timestamp(2_000);
    env.ledger().set_sequence_number(100);
    let nonce = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
    let temp = std::env::temp_dir().join(format!("pactlane-rehearsal-{}-{nonce}", std::process::id()));
    std::fs::create_dir_all(&temp).unwrap();
    let domain = json!({ "network_passphrase": NETWORK, "contract": contract.to_string().to_string() });
    let snapshot = json!({
        "network_passphrase": NETWORK, "contract": contract.to_string().to_string(),
        "confirmed": true, "ledgerTimestamp": "2000", "ledgerSequence": "100", "paymentUsed": false,
        "config": { "token": token.to_string().to_string(), "signer": prepared["signerPublicKeyHex"] },
        "offerData": { "recipientSalt": prepared["recipientSalt"] },
        "order": {
            "id": id.to_string(), "state": "Paying", "buyer": buyer.to_string().to_string(),
            "reserved_at": paying.reserved_at.to_string(), "locked_at": paying.locked_at.to_string(), "pay_by": paying.pay_by.to_string(),
            "terms": {
                "seller": seller.to_string().to_string(), "token_amount": amount.to_string(), "fiat_minor": terms.fiat_minor.to_string(),
                "currency": "EUR", "rail": "revolut", "recipient": prepared["recipient"],
                "offer_expires_at": "4000", "reservation_seconds": "900"
            }
        }
    });
    let issued = node("issue", &json!({ "domain": domain, "snapshot": snapshot, "storePath": temp.join("replay.sqlite").to_str().unwrap(), "uiState": prepared["uiState"] }));
    assert_eq!(issued["signed"]["syntheticOnly"], true);
    let c = &issued["signed"]["claim"];
    let claim = PaymentClaim {
        order_id: text(c, "order_id").parse().unwrap(), seller: address(&env, text(c, "seller")), buyer: address(&env, text(c, "buyer")),
        token: address(&env, text(c, "token")), token_amount: text(c, "token_amount").parse().unwrap(), fiat_minor: text(c, "fiat_minor").parse().unwrap(),
        currency: symbol_short!("EUR"), rail: symbol_short!("revolut"), recipient: bytes32(&env, text(c, "recipient")),
        reserved_at: text(c, "reserved_at").parse().unwrap(), pay_by: text(c, "pay_by").parse().unwrap(), paid_at: text(c, "paid_at").parse().unwrap(),
        expires_at: text(c, "expires_at").parse().unwrap(), nullifier: bytes32(&env, text(c, "nullifier")),
    };
    assert_eq!(hex::encode(client.claim_digest(&claim).to_array()), text(&issued["signed"], "digestHex"));
    let signature = BytesN::from_array(&env, &hex::decode(text(&issued["signed"], "signatureHex")).unwrap().try_into().unwrap());
    client.release(&claim, &signature);
    assert_eq!(client.get_order(&id).state, State::Released);
    assert_eq!(balances.balance(&buyer), amount);
    assert_eq!(balances.balance(&seller), 0);
    assert_eq!(balances.balance(&contract), 0);
    assert!(client.payment_used(&claim.nullifier));
    assert!(client.try_release(&claim, &signature).is_err());
    assert_eq!(balances.balance(&buyer), amount);

    let completed = node("complete", &json!({
        "domain": domain, "snapshot": snapshot, "storePath": temp.join("replay.sqlite").to_str().unwrap(), "issued": issued,
        "balances": { "buyer": balances.balance(&buyer).to_string(), "seller": balances.balance(&seller).to_string(), "escrow": balances.balance(&contract).to_string() }
    }));
    assert_eq!(completed["uiStatus"], "completed");
    assert_eq!(completed["buyerAtoms"], amount.to_string());
    assert_eq!(completed["policyReplayRejected"], true);
    assert_eq!(completed["duplicateUiSettlementRejected"], true);
    if let Ok(path) = std::env::var("PACTLANE_REHEARSAL_REPORT") {
        std::fs::write(path, serde_json::to_vec_pretty(&completed).unwrap()).unwrap();
    }
    std::fs::remove_dir_all(temp).unwrap();
}
