/*
 * ビルド成果物そのものの検証。
 *
 * 実際に起きたこと：MapLibre 6 は main/shared/worker の3分割配布で、ワーカーの
 * 場所を自分の import.meta.url から導く。Vite がバンドルに取り込むと
 * assets/maplibre-gl-worker.mjs を探して 404 になり、ワーカーが起動せず、
 * ベクタが一切描かれないまま **エラーも出さずに沈黙した**。
 * 目視できない環境では、こういうものは成果物の側から捕まえるしかない。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const DIST = new URL('../../docs/spatialid/', import.meta.url).pathname;
let n = 0;
const t = (name, fn) => { fn(); n++; console.log('  ok  ' + name); };

const html = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8');
const files = fs.readdirSync(path.join(DIST, 'assets'));
const bundle = fs.readFileSync(
  path.join(DIST, 'assets', files.find((f) => f.endsWith('.js') && !f.includes('worker'))), 'utf8');

t('index.html が参照するアセットが全部存在する', () => {
  const refs = [...html.matchAll(/(?:src|href)="\.\/([^"]+)"/g)].map((m) => m[1]);
    assert.ok(refs.length >= 2, `参照が少なすぎる: ${refs}`);
  for (const r of refs) {
    assert.ok(fs.existsSync(path.join(DIST, r)), `${r} が存在しない`);
  }
});

t('MapLibre のワーカーが出力され、バンドルから参照されている', () => {
  const worker = files.filter((f) => /maplibre-gl-worker.*\.mjs$/.test(f));
  assert.equal(worker.length, 1, `ワーカーが ${worker.length} 個（1個であるべき）`);
  assert.ok(fs.statSync(path.join(DIST, 'assets', worker[0])).size > 5000, 'ワーカーが小さすぎる');
  assert.ok(bundle.includes(worker[0]),
            `バンドルが ${worker[0]} を参照していない（setWorkerUrl が効いていない）`);
});

t('バンドルが参照する assets/ のファイルが全部存在する', () => {
  const refs = new Set([...bundle.matchAll(/["'`]([^"'`]*\/assets\/[A-Za-z0-9._-]+\.(?:js|mjs|css|wasm))["'`]/g)]
    .map((m) => m[1].split('/assets/')[1]));
  for (const r of refs) {
    assert.ok(fs.existsSync(path.join(DIST, 'assets', r)), `assets/${r} が参照されているのに存在しない`);
  }
  console.log(`      （${refs.size} 件の参照を確認）`);
});

t('ファイル名にハッシュが入っていない', () => {
  for (const f of files) {
    assert.ok(!/-[A-Za-z0-9_-]{8}\.(js|mjs|css)$/.test(f),
              `${f} にハッシュらしき接尾辞がある（古い index.html が 404 になる）`);
  }
});

console.log(`\n${n} 件すべて通過（ビルド成果物を検証）`);
