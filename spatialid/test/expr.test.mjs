/*
 * 塗りの式を MapLibre 本体のコンパイラで検証し、**実際に配るタイルの地物**で評価する。
 *
 * 教訓：以前このテストは `{ratio: 1.2}` のような合成した属性で通っていた。
 * ところが PMTiles に切り替えたとき ratio/empty はタイルに存在せず、
 * フィルタが全地物を除外して何も描かれなかった。テストは緑のままだった。
 * **式は、実データの属性で評価しないと検証したことにならない。**
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createPropertyExpression, latest, featureFilter } from '@maplibre/maplibre-gl-style-spec';
import { PMTiles } from 'pmtiles';
import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';
import { METRICS, DIVERGING, NONEMPTY, NODATA, fillExpr, CELL_OPACITY, PHOTO_OPACITY, zoomHint }
  from '../src/data.js';

const COLOR = latest['paint_fill']['fill-color'];
const NUM = latest['paint_fill']['fill-opacity'];
let n = 0;
const t = (name, fn) => { fn(); n++; console.log('  ok  ' + name); };
const ta = async (name, fn) => { await fn(); n++; console.log('  ok  ' + name); };

function compile(expr, spec, key = 'fill-color') {
  const r = createPropertyExpression(expr, key, spec);
  if (r.result !== 'success') throw new Error('コンパイル不可: ' + r.value.map((e) => e.message).join('; '));
  return r.value;
}
const hex = (c) => '#' + [c.r, c.g, c.b].map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('');

/* ---- 実タイルから地物の属性を取り出す ---- */
class FileSource {
  constructor(p) { this.p = p; this.fd = fs.openSync(p, 'r'); }
  getKey() { return this.p; }
  async getBytes(o, l) {
    const b = Buffer.alloc(l); fs.readSync(this.fd, b, 0, l, o);
    return { data: b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) };
  }
}
const pm = new PMTiles(new FileSource(
  new URL('../../docs/data/doverture-cells.pmtiles', import.meta.url).pathname));

async function featuresAt(z, x, y) {
  const t2 = await pm.getZxy(z, x, y);
  assert.ok(t2 && t2.data, `z${z}/${x}/${y} のタイルが無い`);
  const layer = new VectorTile(new PbfReader(new Uint8Array(t2.data))).layers.cells;
  assert.ok(layer, 'cells レイヤーが無い');
  return Array.from({ length: layer.length }, (_, i) => ({ properties: layer.feature(i).properties }));
}

const tileOf = (lon, lat, z) => {
  const r = (lat * Math.PI) / 180;
  return [z, Math.floor(((lon + 180) / 360) * (1 << z)),
          Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * (1 << z))];
};

const sapporo = await featuresAt(...tileOf(141.35, 43.06, 12));
const whole = await featuresAt(...tileOf(143.0, 43.5, 4));

await ta('タイルの地物に必要な属性が揃っている', async () => {
  assert.ok(sapporo.length > 0, '札幌の z12 タイルが空');
  for (const k of ['bv', 'ov', 'osm', 'eab', 'oth', 'code', 'lv']) {
    assert.ok(k in sapporo[0].properties, `属性 ${k} が無い（${Object.keys(sapporo[0].properties)}）`);
  }
});

t('全指標の fill-color がコンパイルでき、実タイルの地物で色になる', () => {
  for (const m of METRICS) {
    const ex = compile(fillExpr(m), COLOR);
    const colors = sapporo.map((f) => hex(ex.evaluate({ zoom: 12 }, f)));
    const real = colors.filter((c) => c !== NODATA.toLowerCase());
    assert.ok(real.length > 0,
      `${m.key}: 札幌の ${sapporo.length} 地物すべてが無データ色になった（属性名の食い違いを疑う）`);
  }
});

t('発散尺度が実タイルの比率どおりの階級を返す', () => {
  const ex = compile(fillExpr(METRICS[0]), COLOR);
  let checked = 0;
  for (const f of sapporo) {
    const bv = +f.properties.bv, ov = +f.properties.ov;
    if (!(bv > 0)) continue;
    const r = ov / bv;
    const want = DIVERGING.find((d) => r < d[0])[1].toLowerCase();
    assert.equal(hex(ex.evaluate({ zoom: 12 }, f)), want, `比 ${r.toFixed(3)} の階級`);
    checked++;
  }
  assert.ok(checked > 10, `検証できた地物が ${checked} 件しかない`);
});

t('建物ゼロを隠すフィルタが、実タイルで全部を消さない', () => {
  const pass = featureFilter(NONEMPTY, 'layers[0].filter');
  for (const [name, feats] of [['札幌 z12', sapporo], ['全道 z4', whole]]) {
    const kept = feats.filter((f) => pass.filter({ zoom: 12 }, f));
    assert.ok(kept.length > 0, `${name}: フィルタが ${feats.length} 地物を全部消した`);
    assert.ok(kept.length <= feats.length);
    console.log(`      ${name}: ${kept.length}/${feats.length} 件が残る`);
  }
});

t('セルがどのズームでもサブピクセルにならない（ピラミッドの保証）', () => {
  // かつて低ズームでセルを不透明にしていたのは、z14 セルを全ズームで描いて
  // 1px になっていたから（D16）。ピラミッドを入れた今は比が一定になるので、
  // 面を透過させても模様が読める。その前提をここで固定する。
  for (let z = 4; z <= 17; z += 0.5) {
    const { px } = zoomHint(z);
    assert.ok(px >= 32, `z${z} でセルが ${px.toFixed(1)}px（細かすぎる）`);
  }
  assert.equal(Math.round(zoomHint(6).px), 64, 'z12 未満では 64px 一定のはず');
  assert.equal(Math.round(zoomHint(10).px), 64);
  assert.ok(zoomHint(16).px > zoomHint(12).px, 'z12 以降は拡大とともに大きくなる');
});

t('面は全ズームで透過し、写真も常に見えている', () => {
  const cell = compile(CELL_OPACITY, NUM, 'fill-opacity');
  const photo = compile(PHOTO_OPACITY, NUM, 'raster-opacity');
  const c = (z) => cell.evaluate({ zoom: z }), p = (z) => photo.evaluate({ zoom: z });
  for (let z = 3; z <= 19; z++) {
    const lo = z >= 16 ? 0.15 : 0.35;   // 寄ったら輪郭に主役を譲る
    assert.ok(c(z) >= lo && c(z) <= 0.80, `z${z} のセル不透明度 ${c(z).toFixed(2)} が範囲外`);
    assert.ok(p(z) >= 0.50, `z${z} の写真不透明度 ${p(z).toFixed(2)} では下図が見えない`);
    assert.ok(c(z) < 0.85, `z${z} でセルが不透明すぎる（写真が透けない）`);
  }
  for (let z = 3; z <= 18; z++) {
    assert.ok(c(z) >= c(z + 1) - 1e-9 && p(z) <= p(z + 1) + 1e-9, `z${z} で単調でない`);
  }
  console.log(`      z6: セル ${c(6).toFixed(2)} / 写真 ${p(6).toFixed(2)}　`
            + `z16: セル ${c(16).toFixed(2)} / 写真 ${p(16).toFixed(2)}`);
});

console.log(`\n${n} 件すべて通過（実タイルの地物で評価）`);
