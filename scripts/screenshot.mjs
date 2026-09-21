/*
 * ヘッドレス Chrome を CDP で操り、実際に描かれた画面を撮る（D31）。
 *
 *   node scripts/screenshot.mjs out.png "http://localhost:8779/spatialid/#map=6.2/43.4/142.6"
 *   node scripts/screenshot.mjs out.png "<url>" 30000 "<撮る前に評価するJS>"
 *
 * --screenshot + --virtual-time-budget は MapLibre の rAF ループで仮想時間が進み続け、
 * 終わらない。代わりにパネル自身が出す「描画 N 件」を待ってから撮る（出ないページ、
 * たとえば Open MCT のダッシュボードは待ち時間いっぱい待って撮る）。
 * 依存は Node 22 の組み込み WebSocket だけ。プロファイルは使い捨てで、利用者の
 * Chrome プロファイルには触れない。
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const [,, outPath, url, waitMsArg, evalJs] = process.argv;
const PORT = 9223, WAIT = Number(waitMsArg || 30000);
const PROFILE = process.env.PROFILE || fs.mkdtempSync(path.join(os.tmpdir(), 'doverture-shot-'));

const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
  '--headless=new', '--disable-gpu', '--enable-unsafe-swiftshader', '--hide-scrollbars',
  '--user-data-dir=' + PROFILE, '--no-first-run', '--no-default-browser-check',
  '--window-size=1400,900', '--remote-debugging-port=' + PORT, 'about:blank'
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ver = null;
for (let i = 0; i < 60 && !ver; i++) {
  try { ver = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json(); } catch { await sleep(250); }
}
if (!ver) { chrome.kill(); throw new Error('Chrome の起動を待てなかった'); }

const tab = await (await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent(url)}`,
                               { method: 'PUT' })).json();
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));

let id = 0; const waiters = new Map(); const logs = [];
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && waiters.has(m.id)) { waiters.get(m.id)(m.result); waiters.delete(m.id); }
  if (m.method === 'Runtime.consoleAPICalled') {
    const t = (m.params.args || []).map((a) => a.value).join(' ');
    logs.push(t);
  }
};
const send = (method, params = {}) =>
  new Promise((r) => { const n = ++id; waiters.set(n, r); ws.send(JSON.stringify({ id: n, method, params })); });

await send('Runtime.enable');
await send('Page.enable');

// パネルが「描画 N 件」を出すまで待つ。出なければ待ち切って撮り、ログを添えて返す。
const t0 = Date.now(); let ready = null;
while (Date.now() - t0 < WAIT) {
  ready = logs.find((l) => /描画 [\d,]+ 件/.test(l));
  if (ready) break;
  await sleep(500);
}
if (evalJs) { await send('Runtime.evaluate', { expression: evalJs }); await sleep(1500); }
await sleep(2500);   // 描画完了の直後はまだタイルが来ている
const shot = await send('Page.captureScreenshot', { format: 'png' });
fs.writeFileSync(outPath, Buffer.from(shot.data, 'base64'));
console.log(ready ? `準備OK: ${ready}` : `※「描画 N 件」が ${WAIT}ms 出なかった`);
for (const l of logs.slice(-6)) console.log('  console:', l);
console.log('->', outPath, (fs.statSync(outPath).size / 1000).toFixed(0) + ' KB');
ws.close(); chrome.kill();
process.exit(0);
