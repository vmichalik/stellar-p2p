//! Setup-only diagnostic for the approved private verifier. No bank request,
//! credentials, payment data, transcript disclosure, or release is involved.
use std::time::{Duration, Instant};
use async_tungstenite::tungstenite::Message;
use futures_util::StreamExt;
use serde_json::{json, Value};
use tokio::net::TcpStream;
use tokio_util::compat::TokioAsyncReadCompatExt;
use ws_stream_tungstenite::WsStream;
use tlsn::{config::{prover::ProverConfig, tls_commit::mpc::{MpcTlsConfig, NetworkSetting}}, Session};

type Error = Box<dyn std::error::Error + Send + Sync>;
type SecureWs = async_tungstenite::WebSocketStream<tokio_util::compat::Compat<tokio_native_tls::TlsStream<TcpStream>>>;

async fn connect(path: &str) -> Result<SecureWs, Error> {
    let host = std::env::var("TLSN_VERIFIER_HOST")?;
    let port: u16 = std::env::var("TLSN_VERIFIER_PORT")?.parse()?;
    let tcp = TcpStream::connect((host.as_str(), port)).await?;
    let connector = tokio_native_tls::TlsConnector::from(native_tls::TlsConnector::new()?);
    let stream = connector.connect(&host, tcp).await?.compat();
    let (ws, _) = async_tungstenite::client_async(format!("wss://{host}:{port}{path}"), stream).await?;
    Ok(ws)
}

async fn setup_once() -> Result<u128, Error> {
    let mut control = connect("/session").await?;
    control.send(Message::Text(json!({
        "type": "register", "maxSentData": 4096, "maxRecvData": 16384,
        "sessionData": { "diagnostic": "setup-only-no-bank-request" }
    }).to_string().into())).await?;
    let message = tokio::time::timeout(Duration::from_secs(8), control.next()).await?
        .ok_or("control connection closed")??;
    let value: Value = serde_json::from_str(message.to_text()?)?;
    if value["type"] != "session_registered" { return Err("registration failed".into()); }
    let id = value["sessionId"].as_str().ok_or("missing registration id")?;
    if !id.bytes().all(|b| b.is_ascii_hexdigit() || b == b'-') { return Err("invalid registration id".into()); }
    let ws = connect(&format!("/verifier?sessionId={id}")).await?;
    let (driver, mut handle) = Session::new(WsStream::new(ws)).split();
    let driver_task = tokio::spawn(driver);
    let prover = handle.new_prover(ProverConfig::builder().build()?)?;
    let config = MpcTlsConfig::builder().max_sent_data(4096).max_recv_data(16384)
        .network(NetworkSetting::Bandwidth).build()?;
    let started = Instant::now();
    let outcome = tokio::time::timeout(Duration::from_secs(30), prover.commit(config)).await;
    let elapsed = started.elapsed().as_millis();
    // This diagnostic deliberately stops before connecting to any application server.
    handle.close();
    let passed = matches!(&outcome, Ok(Ok(_)));
    drop(outcome);
    let _ = control.close(None).await;
    driver_task.abort();
    if passed { Ok(elapsed) } else { Err("setup did not complete inside 30 seconds".into()) }
}

#[tokio::main]
async fn main() -> Result<(), Error> {
    for attempt in 1..=2 {
        let elapsed = setup_once().await?;
        println!("setup-only attempt {attempt}: passed in {elapsed} ms; no bank request or disclosure");
    }
    Ok(())
}
