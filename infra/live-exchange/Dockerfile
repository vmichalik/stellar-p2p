# Reuse the already verified TLSNotary binary and WASM assets byte-for-byte.
FROM registry.fly.io/stellar-p2p-proof-vijay@sha256:d671ad22140f0e61e8e0f720a21bec0d343298dc79f94ba0a112856c654f5d29
USER root
WORKDIR /app/exchange
COPY integration/package.json integration/package-lock.json integration/
COPY policy/package.json policy/package-lock.json policy/
RUN npm ci --prefix integration --ignore-scripts --omit=dev && npm ci --prefix policy --ignore-scripts --omit=dev
COPY integration integration
COPY policy/src policy/src
COPY policy/vendor policy/vendor
COPY app app
COPY contracts/escrow/artifacts/pactlane_escrow.wasm contracts/escrow/artifacts/pactlane_escrow.wasm
COPY contracts/escrow/protocol contracts/escrow/protocol
COPY infra/proof-benchmark infra/proof-benchmark
COPY tlsn tlsn
RUN ln -s /app/bin infra/proof-benchmark/bin && ln -s /app/runtime infra/proof-benchmark/runtime && \
    ln -s ../../../integration/node_modules contracts/escrow/protocol/node_modules && \
    cp /app/benchmark/tlsn_wasm.js /app/benchmark/tlsn_wasm_bg.wasm tlsn/benchmark/ && \
    cp -r /app/benchmark/snippets tlsn/benchmark/snippets
USER 65532:65532
ENTRYPOINT ["/usr/bin/tini", "--", "node", "/app/exchange/infra/proof-benchmark/start.mjs"]
