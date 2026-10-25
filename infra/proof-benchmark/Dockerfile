# Source and legitimate protocol settings are pinned; this image has a labelled
# public-only registration admission guard in addition to the reviewed target restrictions.
FROM rust:1.99.1-bookworm@sha256:8bf7188ae46ad73b801c8d405eedc13ce63a7852b562885743a56890723549a8 AS verifier-build
WORKDIR /build
RUN apt-get update && apt-get install -y --no-install-recommends \
    pkg-config libssl-dev git ca-certificates && rm -rf /var/lib/apt/lists/*
COPY servers/Cargo.toml servers/Cargo.lock ./
COPY servers/verifier/Cargo.toml ./verifier/
COPY servers/swissbank/Cargo.toml ./swissbank/
RUN mkdir -p verifier/src swissbank/src && \
    printf 'fn main() {}\n' > verifier/src/main.rs && \
    printf 'fn main() {}\n' > swissbank/src/main.rs
RUN cargo fetch --locked
COPY servers/verifier/src ./verifier/src
ARG CARGO_BUILD_JOBS=2
RUN touch verifier/src/main.rs && \
    cargo build --release --locked --package tlsn-verifier-server --jobs "$CARGO_BUILD_JOBS"

FROM node:26.7.0-bookworm-slim@sha256:ee507d1bb1ba6902cbe0fe1e618610146dbb1b350708cbf41f7a300f1ec7396e
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates libssl3 tini && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=verifier-build /build/target/release/tlsn-verifier-server /app/bin/tlsn-verifier-server
COPY benchmark /app/benchmark
COPY extension-check.mjs extension-check.html extension-check.plugin.mjs /app/
COPY response-check.mjs response-check.html revolut.plugin.mjs /app/
COPY runtime/config.yaml /app/runtime/config.yaml
COPY configuration.mjs start.mjs /app/
RUN chmod 0444 /app/runtime/config.yaml
ENV NODE_OPTIONS=--max-old-space-size=256
USER 65532:65532
EXPOSE 8080
ENTRYPOINT ["/usr/bin/tini", "--", "node", "/app/start.mjs"]
