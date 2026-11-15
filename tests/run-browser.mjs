// node tests/run-browser.mjs
// Runs tests/browser/*.html in headless Chrome or Edge over the DevTools protocol (no Foundry needed):
// the pages import the real module code and check what it draws. Skips, with a note, when no
// browser is installed (set CHROME_PATH to point at one).
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PAGES = fs.readdirSync(path.join(ROOT, 'tests', 'browser')).filter((f) => f.endsWith('.html'));
const MIME = { '.html': 'text/html', '.mjs': 'text/javascript', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };

function findBrowser() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ];
  return candidates.find((c) => c && fs.existsSync(c));
}

const browserPath = findBrowser();
if (!browserPath) {
  console.log('browser tests skipped: no Chrome or Edge found (set CHROME_PATH)');
  process.exit(0);
}

const server = http.createServer((req, res) => {
  const file = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const serverPort = server.address().port;

const debugPort = 9600 + Math.floor(Math.random() * 300);
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'iconic-browser-test-'));
const chrome = spawn(browserPath, [
  '--headless=new', `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--disable-extensions',
  ...(process.env.CI ? ['--no-sandbox'] : []), // CI runners cannot create Chrome's sandbox
  'about:blank',
], { stdio: 'ignore' });

async function waitJson(url) {
  for (let i = 0; i < 80; i++) {
    try { return await (await fetch(url)).json(); } catch { await new Promise((r) => setTimeout(r, 250)); }
  }
  throw new Error('the browser did not start');
}

let failed = 0;
try {
  const page = (await waitJson(`http://127.0.0.1:${debugPort}/json`)).find((t) => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve) => { ws.onopen = resolve; });
  let id = 0;
  const pending = new Map();
  const logs = [];
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    } else if (msg.method === 'Runtime.exceptionThrown') {
      logs.push(msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text);
    }
  };
  const send = (method, params = {}) => new Promise((resolve) => {
    const n = ++id;
    pending.set(n, resolve);
    ws.send(JSON.stringify({ id: n, method, params }));
  });
  await send('Runtime.enable');
  await send('Page.enable');

  for (const file of PAGES) {
    logs.length = 0;
    await send('Page.navigate', { url: `http://127.0.0.1:${serverPort}/tests/browser/${file}` });
    const res = await send('Runtime.evaluate', {
      expression: 'new Promise((resolve, reject) => { const t0 = Date.now(); const poll = () => window.__done ? resolve(window.__results) : (Date.now() - t0 > 30000 ? reject(new Error("timeout")) : setTimeout(poll, 50)); poll(); })',
      awaitPromise: true,
      returnByValue: true,
    });
    const results = res.result?.result?.value;
    if (!results) {
      failed++;
      console.error(`FAIL ${file}: the page did not finish`, logs.join(' | '), JSON.stringify(res.result?.exceptionDetails ?? res.error ?? ''));
      continue;
    }
    for (const r of results) {
      if (r.ok) console.log(`PASS  ${r.name}`);
      else {
        failed++;
        console.error(`FAIL  ${r.name}: ${r.detail}`);
      }
    }
    if (logs.length) console.error('page errors:', logs.join(' | '));
  }
  ws.close();
} finally {
  chrome.kill();
  server.close();
  setTimeout(() => {
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* the browser may still hold files */ }
    process.exit(failed ? 1 : 0);
  }, 800);
}
