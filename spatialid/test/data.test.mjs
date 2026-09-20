/* ブラウザ無しで走る検証。実データ(docs/data/cells.json)に対して形と値を確かめる。 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { toGeoJSON, extents, boundsOf, fillExpr, zoomHint, METRICS, DIVERGING, x2lon, y2lat,
         CELL_OPACITY, PHOTO_OPACITY, photoOpacity } from '../src/data.js';

const doc = JSON.parse(fs.readFileSync(new URL('../../docs/data/cells.json', import.meta.url), 'utf8'));
let n = 0;
const t = (name, fn) => { fn(); n++; console.log('  ok  ' + name); };

t('toGeoJSON が全セルを Feature にする', () => {
  const g = toGeoJSON(doc);
  assert.equal(g.type, 'FeatureCollection');
  assert.equal(g.features.length, doc.rows.length);
  globalThis.__geo = g;
});

t('各 Feature が閉じた4隅の矩形を持ち、外環が反時計回り(RFC 7946)', () => {
  const g = globalThis.__geo.features;
  for (const f of [g[0], g[Math.floor(g.length / 2)], g[g.length - 1]]) {
    const r = f.geometry.coordinates[0];
    assert.equal(r.length, 5);
    assert.deepEqual(r[0], r[4]);
    let a = 0;
    for (let i = 0; i < r.length - 1; i++) a += r[i][0] * r[i + 1][1] - r[i + 1][0] * r[i][1];
    assert.ok(a > 0, `外環が時計回り（符号付き面積 ${a}）`);
    const lons = r.map((p) => p[0]), lats = r.map((p) => p[1]);
    assert.ok(Math.max(...lons) > Math.min(...lons), '経度に幅がある');
    assert.ok(Math.max(...lats) > Math.min(...lats), '緯度に高さがある');
  }
});

t('矩形が北海道の範囲に収まる', () => {
  for (const f of globalThis.__geo.features) {
    const [lon, lat] = f.geometry.coordinates[0][0];
    assert.ok(lon > 139 && lon < 149.5, `経度 ${lon}`);
    assert.ok(lat > 41 && lat < 46, `緯度 ${lat}`);
  }
});

t('派生プロパティが定義どおり', () => {
  for (const f of globalThis.__geo.features.slice(0, 2000)) {
    const p = f.properties;
    if (p.bv > 0) assert.ok(Math.abs(p.ratio - p.ov / p.bv) < 1e-9);
    else assert.equal(p.ratio, -1);
    assert.equal(p.empty, p.bv === 0 && p.ov === 0 ? 1 : 0);
    assert.equal(p.osm + p.eab + p.oth, p.ov, `内訳の合計が Overture 総数と一致 (${p.x}/${p.y})`);
  }
});

t('extents / boundsOf が使える範囲を返す', () => {
  const ex = extents(globalThis.__geo);
  assert.ok(ex.size > 0);
  for (const [code, b] of ex) {
    const [[w, s], [e, nn]] = boundsOf(b);
    assert.ok(e > w && nn > s, `${code} の範囲が潰れている`);
  }
});

t('fillExpr が全指標で正しい形の式になる', () => {
  for (const m of METRICS) {
    const e = fillExpr(m);
    assert.equal(e[0], 'case');
    const step = e[3];
    assert.equal(step[0], 'step');
    assert.ok(step.length >= 5 && step.length % 2 === 1, `${m.key} の step の引数の数が不正（'step', input, out0 のあとは閾値と色の対）`);
    for (let i = 3; i + 2 < step.length; i += 2) {
      assert.ok(step[i + 2] > step[i], `${m.key} の閾値が昇順でない`);
    }
  }
});

t('発散尺度の閾値が昇順で、色が7つ', () => {
  assert.equal(DIVERGING.length, 7);
  for (let i = 1; i < DIVERGING.length; i++) assert.ok(DIVERGING[i][0] > DIVERGING[i - 1][0]);
});

t('zoomHint がズームに応じて変わる', () => {
  assert.equal(zoomHint(6).what, '全道の模様');
  assert.equal(zoomHint(10).what, '模様を読む');
  assert.equal(zoomHint(12).what, 'セルを押して内訳');
  assert.equal(zoomHint(15).what, '写真で実物を確認');
  assert.ok(zoomHint(14).px === 256);
});

t('タイル座標の往復が合う', () => {
  assert.ok(Math.abs(x2lon(0) + 180) < 1e-9);
  assert.ok(Math.abs(y2lat(0) - 85.0511) < 0.01);
});

t('セルと写真の不透明度が、引くと入れ替わる', () => {
  const at = (expr, z) => {                       // interpolate 式を手で評価する
    const st = expr.slice(3);
    for (let i = 0; i + 3 < st.length; i += 2) {
      if (z >= st[i] && z <= st[i + 2]) {
        const f = (z - st[i]) / (st[i + 2] - st[i]);
        return st[i + 1] + f * (st[i + 3] - st[i + 1]);
      }
    }
    return z < st[0] ? st[1] : st[st.length - 1];
  };
  assert.ok(at(CELL_OPACITY, 6) > 0.9, '引いたときセルは濃い');
  assert.ok(at(PHOTO_OPACITY, 6) < 0.3, '引いたとき写真は薄い');
  assert.ok(at(CELL_OPACITY, 16) < 0.4, '寄ったときセルは薄い');
  assert.ok(at(PHOTO_OPACITY, 16) > 0.9, '寄ったとき写真は濃い');
  assert.ok(at(CELL_OPACITY, 6) > at(CELL_OPACITY, 16), 'セルは単調に薄くなる');
  assert.ok(at(PHOTO_OPACITY, 6) < at(PHOTO_OPACITY, 16), '写真は単調に濃くなる');
});

t('photoOpacity のモードが効く', () => {
  assert.equal(photoOpacity('none'), 0);
  assert.equal(photoOpacity('photo'), 0.95);
  assert.equal(photoOpacity('auto'), PHOTO_OPACITY);
});

console.log(`\n${n} 件すべて通過（セル ${doc.rows.length.toLocaleString()} 件で検証）`);
