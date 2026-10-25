// Read-only setup diagnostic using the SHA256-checked official release's WASM.
// Uses an isolated browser and no account credentials. Optional public GET test
// is fixed to /robots.txt and never reveals a response body or authenticates a user.
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { readSetupRoute } from './setup-check.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const configuredOrigin = process.env.TLSN_PUBLIC_ORIGIN;
if (!configuredOrigin || !/^https:\/\/[a-z0-9.-]+(?::[0-9]+)?$/.test(configuredOrigin)) {
  throw new Error('Set TLSN_PUBLIC_ORIGIN to the private HTTPS verifier origin');
}
const socketOrigin = configuredOrigin.replace(/^https:/, 'wss:');
const extensionLogging = process.env.TLSN_SMOKE_LOGGING === 'extension';
const publicGet = process.env.TLSN_SMOKE_PUBLIC_GET === '1';
const budgets = JSON.parse(process.env.TLSN_SETUP_BUDGETS || '[[4096,16384],[4096,16384]]');
if (
  !Array.isArray(budgets) ||
  budgets.length > 4 ||
  budgets.some(
    (pair) =>
      !Array.isArray(pair) ||
      pair.length !== 2 ||
      pair.some((value) => !Number.isInteger(value) || value < 1024 || value > 16384),
  )
)
  throw new Error('Invalid setup budgets');
const workerSource = `
import init, { initialize, Prover } from './tlsn_wasm.js';
const origin = ${JSON.stringify(socketOrigin)};
const stats = { sent: 0, recv: 0, writes: 0, reads: 0, targetSent: 0, targetRecv: 0, lastProgress: null };
let consoleCalls = 0;
if (${extensionLogging}) {
  const patterns = [/connecting to verifier/i, /setup complete/i, /connecting to server/i, /sending request/i, /response received/i, /reveal\\(\\) called/i, /\\bfinalized\\b/i];
  for (const name of ['log','debug','info']) {
    const original=console[name];
    console[name]=(...args)=>{
      consoleCalls++; original.apply(console,args);
      const raw=args.map(String).join(' ');
      for(const pattern of patterns) if(pattern.test(raw)){postMessage({phase:'console-progress'});break;}
    };
  }
}
function open(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url); ws.binaryType = 'arraybuffer';
    const queue = []; let reader = null; let closed = false;
    ws.onopen = () => resolve({ ws,
      read: async () => queue.length ? queue.shift() : closed ? null : new Promise(r => { reader = r; }),
      write: async data => { stats.sent += data.length; stats.writes++; if(url.includes('/proxy?'))stats.targetSent+=data.length; ws.send(data.slice()); },
      close: async () => { closed = true; ws.close(); },
    });
    ws.onmessage = event => {
      const data = new Uint8Array(event.data); stats.recv += data.length; stats.reads++; if(url.includes('/proxy?'))stats.targetRecv+=data.length;
      if (reader) { const r = reader; reader = null; r(data); } else queue.push(data);
    };
    ws.onclose = () => { closed = true; if(reader) { const r=reader; reader=null; r(null); } };
    ws.onerror = () => reject(new Error('WS_FAILED'));
  });
}
async function register(maxSentData,maxRecvData) {
  return new Promise((resolve,reject) => {
    const ws = new WebSocket(origin + '/session');
    ws.onopen = () => ws.send(JSON.stringify({ type:'register', maxSentData, maxRecvData,
      sessionData:{diagnostic:'released-wasm-setup-only-no-bank-request'} }));
    ws.onerror = () => reject(new Error('REGISTRATION_FAILED'));
    ws.onmessage = event => {
      const value=JSON.parse(event.data);
      if(value.type==='session_registered') resolve({ws,id:value.sessionId});
    };
  });
}
try {
  await init();
  const hardwareConcurrency = navigator.hardwareConcurrency || 4;
  await initialize(${extensionLogging ? "{ level:'Info', crate_filters:[{name:'yamux',level:'Info'},{name:'uid_mux',level:'Info'}], span_events:undefined }" : 'null'}, hardwareConcurrency);
  postMessage({ phase:'initialized', hardwareConcurrency, crossOriginIsolated, extensionLogging:${extensionLogging} });
  const budgets=${JSON.stringify(budgets)};
  for(let index=0;index<budgets.length;index++) {
    const attempt=index+1;
    const [maxSentData,maxRecvData]=budgets[index];
    Object.assign(stats,{sent:0,recv:0,writes:0,reads:0,targetSent:0,targetRecv:0,lastProgress:null});
    const control=await register(maxSentData,maxRecvData);
    const io=await open(origin + '/verifier?sessionId=' + control.id);
    const prover = new Prover({ server_name:'app.revolut.com', mode:'Mpc',
      max_sent_data:maxSentData, max_sent_records:undefined, max_recv_data_online:undefined,
      max_recv_data:maxRecvData, max_recv_records_online:undefined, defer_decryption_from_start:undefined,
      network:'Bandwidth', client_auth:undefined, root_certs:undefined });
    prover.set_progress_callback(data => { stats.lastProgress = data.step; });
    const started=performance.now(); let timer;
    try {
      await Promise.race([prover.setup(io),new Promise((_,reject)=>{
        timer=setTimeout(()=>reject(new Error('MPC_SETUP_TIMEOUT')),30000);
      })]);
      postMessage({phase:'setup-result',attempt,passed:true,maxSentData,maxRecvData,elapsedMs:Math.round(performance.now()-started),consoleCalls,...stats});
      if (${publicGet}) {
        const targetIo=await open(origin + '/proxy?token=app.revolut.com');
        const encoded=new TextEncoder();
        const headers=new Map(Object.entries({Host:'app.revolut.com','Accept-Encoding':'identity',Connection:'close'})
          .map(([key,value])=>[key,Array.from(encoded.encode(value))]));
        let requestTimer;
        try {
          await Promise.race([prover.send_request(targetIo,{uri:'/robots.txt',method:'GET',headers,body:undefined}),
            new Promise((_,reject)=>{requestTimer=setTimeout(()=>reject(new Error('HTTP_REQUEST_TIMEOUT')),60000);})]);
          postMessage({phase:'public-get-result',passed:true,elapsedMs:Math.round(performance.now()-started),...stats});
        } catch {
          postMessage({phase:'public-get-result',passed:false,code:'HTTP_REQUEST_FAILED',elapsedMs:Math.round(performance.now()-started),...stats});
        } finally {clearTimeout(requestTimer);await targetIo.close();}
      }
    } catch(error) {
      postMessage({phase:'setup-result',attempt,passed:false,maxSentData,maxRecvData,
        code:error?.message==='MPC_SETUP_TIMEOUT'?'MPC_SETUP_TIMEOUT':'SETUP_FAILED',
        elapsedMs:Math.round(performance.now()-started),consoleCalls,...stats});
      break;
    } finally {
      clearTimeout(timer); await io.close(); control.ws.close();
      try { prover.free(); } catch {}
    }
  }
  postMessage({phase:'done'});
} catch { postMessage({phase:'init-or-transport-failed'}); }
`;
const files = new Map([
  ['/tlsn_wasm.js', ['tlsn_wasm.js', 'text/javascript']],
  ['/tlsn_wasm_bg.wasm', ['tlsn_wasm_bg.wasm', 'application/wasm']],
  [
    '/snippets/web-spawn-05868593a72e2d44/js/spawn.js',
    ['snippets/web-spawn-05868593a72e2d44/js/spawn.js', 'text/javascript'],
  ],
]);
const server = createServer(async (req, res) => {
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
  res.setHeader('Cache-Control', 'no-store');
  if (req.url === '/') {
    res.setHeader('Content-Type', 'text/html');
    res.end(`<title>Released WASM setup diagnostic</title><script>
      window.results=[]; window.finished=false;
      const worker=new Worker('/worker.mjs',{type:'module'});
      worker.onmessage=e=>{ window.results.push(e.data); if(['done','init-or-transport-failed'].includes(e.data.phase)){window.finished=true;worker.terminate();} };
      worker.onerror=event=>{window.results.push({phase:'worker-error',message:String(event.message).slice(0,1200)});window.finished=true;worker.terminate();};
    </script>`);
  } else if (req.url === '/worker.mjs') {
    res.setHeader('Content-Type', 'text/javascript');
    res.end(workerSource);
  } else if (files.has(req.url)) {
    const [, type] = files.get(req.url);
    try {
      const asset = await readSetupRoute('/setup-check' + req.url, configuredOrigin);
      res.setHeader('Content-Type', type);
      res.end(asset.body);
    } catch {
      res.writeHead(404);
      res.end();
    }
  } else {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((resolve) => server.listen(17849, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({
    executablePath: process.env.TLSN_CHROME_EXECUTABLE || undefined,
    headless: true,
    chromiumSandbox: true,
  });
  const page = await browser.newPage();
  const publicRuntimeErrors = [];
  page.on('console', (message) => {
    if (publicGet && message.type() === 'error' && publicRuntimeErrors.length < 12)
      publicRuntimeErrors.push(message.text().slice(0, 1200));
  });
  await page.goto('http://127.0.0.1:17849/');
  await page.waitForFunction(() => window.finished, {}, { timeout: 75000 });
  const results = await page.evaluate(() => window.results);
  process.stdout.write(
    JSON.stringify({
      diagnosticOnly: true,
      authenticatedBankRequestMade: false,
      publicGetRequestAttempted: publicGet,
      results,
      publicRuntimeErrors,
    }) + '\n',
  );
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
