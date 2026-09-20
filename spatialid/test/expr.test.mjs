/*
 * 塗りの式を MapLibre 本体のコンパイラで検証し、実際に評価する。
 * ブラウザは要らない。式の形の誤り・閾値の取り違えはここで止まる。
 */
import assert from 'node:assert/strict';
import { createPropertyExpression, latest } from '@maplibre/maplibre-gl-style-spec';
import { METRICS, DIVERGING, fillExpr, CELL_OPACITY, PHOTO_OPACITY } from '../src/data.js';

// MapLibre 本体が持っている仕様定義をそのまま使う（自前で書くと嘘の検査になる）
const COLOR = latest['paint_fill']['fill-color'];
const NUM = latest['paint_fill']['fill-opacity'];

let n = 0;
const t = (name, fn) => { fn(); n++; console.log('  ok  ' + name); };
function compile(expr, spec, key = 'fill-color') {
  const r = createPropertyExpression(expr, key, spec);
  if (r.result !== 'success') {
    throw new Error('式がコンパイルできない: ' + r.value.map((e) => e.message).join('; '));
  }
  return r.value;
}
const rgba = (c) => '#' + [c.r, c.g, c.b].map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('');

t('全指標の fill-color が MapLibre の式としてコンパイルできる', () => {
  for (const m of METRICS) compile(fillExpr(m), COLOR);
});

t('発散尺度が階級どおりの色を返す', () => {
  const ex = compile(fillExpr(METRICS[0]), COLOR);
  const at = (ratio) => rgba(ex.evaluate({ zoom: 10 }, { properties: { ratio } }));
  const cases = [[0.50, 0], [0.69, 0], [0.70, 1], [0.84, 1], [0.85, 2], [0.94, 2],
                 [0.95, 3], [1.04, 3], [1.05, 4], [1.29, 4], [1.30, 5], [1.79, 5],
                 [1.80, 6], [9.9, 6]];
  for (const [r, level] of cases) {
    assert.equal(at(r), DIVERGING[level][1].toLowerCase(),
                 `比 ${r} は L${level}（${DIVERGING[level][2]}）のはず`);
  }
});

t('算出できないセル(-1)は無データ色になる', () => {
  for (const m of METRICS) {
    const ex = compile(fillExpr(m), COLOR);
    const f = { properties: { ratio: -1, bv: -1, ov: -1, oth: -1, othShare: -1, osmShare: -1 } };
    assert.equal(rgba(ex.evaluate({ zoom: 10 }, f)), '#383835', `${m.key} の無データ色`);
  }
});

t('逐次指標が段階どおりに明るくなる', () => {
  for (const m of METRICS.filter((x) => x.kind === 'seq')) {
    const ex = compile(fillExpr(m), COLOR);
    const lum = (v) => {
      const c = ex.evaluate({ zoom: 10 }, { properties: { [m.prop]: v } });
      return c.r + c.g + c.b;
    };
    const lo = lum(m.stops[0]), hi = lum(m.stops[m.stops.length - 1] * 10);
    assert.ok(hi > lo, `${m.key}: 大きい値ほど明るくなるべき（${lo} -> ${hi}）`);
  }
});

t('不透明度がズームで主役を入れ替える', () => {
  const cell = compile(CELL_OPACITY, NUM, 'fill-opacity');
  const photo = compile(PHOTO_OPACITY, NUM, 'raster-opacity');
  const c = (z) => cell.evaluate({ zoom: z });
  const p = (z) => photo.evaluate({ zoom: z });
  assert.ok(c(6) > 0.9,  `引いたときセルは濃い（${c(6)}）`);
  assert.ok(p(6) < 0.3,  `引いたとき写真は薄い（${p(6)}）`);
  assert.ok(c(16) < 0.4, `寄ったときセルは薄い（${c(16)}）`);
  assert.ok(p(16) > 0.9, `寄ったとき写真は濃い（${p(16)}）`);
  for (let z = 3; z <= 16; z++) {
    assert.ok(c(z) >= c(z + 1) - 1e-9, `セルはz${z}で単調でない`);
    assert.ok(p(z) <= p(z + 1) + 1e-9, `写真はz${z}で単調でない`);
  }
  // 引いたときにセルが写真に埋もれないこと（今回の「写真しか見えない」の再発防止）
  assert.ok(c(6) - p(6) > 0.5, `z6 でセルが写真に埋もれている（セル ${c(6)} / 写真 ${p(6)}）`);
});

console.log(`\n${n} 件すべて通過（MapLibre の式コンパイラで検証）`);
