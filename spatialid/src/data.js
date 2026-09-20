/*
 * data.js — MapLibre に依存しない純粋なロジック。
 *
 * 分離してある理由：このセッションにはブラウザが無く、描画は目視できない。
 * ブラウザ無しで検証できるのは「データの形」に関するバグだけなので、
 * そこだけを MapLibre から切り離して node でテストできるようにしてある。
 * （実際、MapLibre の GeoJSONSource._data を覗いていたバグはこの分離が無くて出た）
 */

export const Z = 14;
const N = 2 ** Z;

export const x2lon = (x) => (x / N) * 360 - 180;
export const y2lat = (y) => {
  const n = Math.PI - (2 * Math.PI * y) / N;
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
};

/** 発散尺度（DECISIONS.md D10 と同一）。境界値・色・ラベル。 */
export const DIVERGING = [
  [0.70, '#9ec5f4', 'bvmap が大きく多い（〜0.70）'],
  [0.85, '#5598e7', 'bvmap が多い（0.70〜0.85）'],
  [0.95, '#256abf', 'bvmap がやや多い（0.85〜0.95）'],
  [1.05, '#6e6d67', 'ほぼ互角（0.95〜1.05）'],
  [1.30, '#a83232', 'Overture がやや多い（1.05〜1.30）'],
  [1.80, '#d95f5f', 'Overture が多い（1.30〜1.80）'],
  [Infinity, '#f2a3a3', 'Overture が大きく多い（1.80〜）']
];

/** 逐次ランプ（青・単色）。暗い面では明るいほど大きい。 */
export const SEQ = ['#184f95', '#256abf', '#3987e5', '#6da7ec', '#9ec5f4', '#cde2fb'];

export const METRICS = [
  { key: 'ratio', name: 'どちらが多く捉えているか（Overture ÷ bvmap）', kind: 'diverging', prop: 'ratio' },
  { key: 'bv',  name: 'bvmap 建物数（国土地理院）', kind: 'seq', prop: 'bv',  stops: [1, 5, 20, 80, 300, 1200], unit: '件' },
  { key: 'ov',  name: 'Overture 建物数',           kind: 'seq', prop: 'ov',  stops: [1, 5, 20, 80, 300, 1200], unit: '件' },
  { key: 'oth', name: 'Microsoft ほか（OSM・東アジア学術以外）', kind: 'seq', prop: 'oth', stops: [1, 3, 10, 30, 100, 400], unit: '件' },
  { key: 'othShare', name: 'Overture に占める Microsoft ほかの割合', kind: 'seq', prop: 'othShare', stops: [0, 5, 10, 20, 35, 50], unit: '%' },
  { key: 'osmShare', name: 'Overture に占める OSM 由来の割合',      kind: 'seq', prop: 'osmShare', stops: [40, 60, 75, 85, 95, 100], unit: '%' }
];

/** cells.json -> GeoJSON。セルの矩形はここで (14,x,y) から組み立てる。 */
export function toGeoJSON(doc) {
  if (!doc || !Array.isArray(doc.cols) || !Array.isArray(doc.rows)) {
    throw new Error('cells.json の形が想定と違います（cols / rows が要ります）');
  }
  const i = Object.fromEntries(doc.cols.map((c, k) => [c, k]));
  for (const need of ['x', 'y', 'code', 'bv', 'ov', 'osm', 'eab', 'oth']) {
    if (i[need] === undefined) throw new Error(`cells.json に列 ${need} がありません`);
  }
  const features = new Array(doc.rows.length);
  for (let k = 0; k < doc.rows.length; k++) {
    const r = doc.rows[k];
    const x = r[i.x], y = r[i.y];
    const bv = r[i.bv], ov = r[i.ov], osm = r[i.osm], eab = r[i.eab], oth = r[i.oth];
    const w = x2lon(x), e = x2lon(x + 1), n = y2lat(y), s = y2lat(y + 1);
    features[k] = {
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: [[[w, n], [e, n], [e, s], [w, s], [w, n]]] },
      properties: {
        x, y, code: r[i.code], bv, ov, osm, eab, oth,
        bvArea: r[i.bvArea] ?? 0, ovArea: r[i.ovArea] ?? 0,
        ratio: bv > 0 ? ov / bv : -1,
        othShare: ov > 0 ? (oth / ov) * 100 : -1,
        osmShare: ov > 0 ? (osm / ov) * 100 : -1,
        empty: bv === 0 && ov === 0 ? 1 : 0
      }
    };
  }
  return { type: 'FeatureCollection', features };
}

/** 市区町村コード -> セルの外接範囲 [xmin, ymin, xmax, ymax]。 */
export function extents(geo) {
  const m = new Map();
  for (const f of geo.features) {
    const p = f.properties;
    const b = m.get(p.code) || [Infinity, Infinity, -Infinity, -Infinity];
    b[0] = Math.min(b[0], p.x); b[1] = Math.min(b[1], p.y);
    b[2] = Math.max(b[2], p.x); b[3] = Math.max(b[3], p.y);
    m.set(p.code, b);
  }
  return m;
}

/** 外接範囲 -> fitBounds に渡す [[w,s],[e,n]]。 */
export const boundsOf = (b) => [[x2lon(b[0]), y2lat(b[3] + 1)], [x2lon(b[2] + 1), y2lat(b[1])]];

/** 塗り色の MapLibre 式。未算出(-1)は無データ色へ落とす。 */
export function fillExpr(metric) {
  let paint;
  if (metric.kind === 'diverging') {
    paint = ['step', ['get', 'ratio'], DIVERGING[0][1]];
    for (let i = 0; i < DIVERGING.length - 1; i++) paint.push(DIVERGING[i][0], DIVERGING[i + 1][1]);
  } else {
    paint = ['step', ['get', metric.prop], SEQ[0]];
    for (let k = 1; k < SEQ.length; k++) paint.push(metric.stops[k], SEQ[k]);
  }
  return ['case', ['<', ['get', metric.prop], 0], '#383835', paint];
}

/** z14セル1辺の画面上のピクセル数と、そのズームで何ができるか。 */
export function zoomHint(zoom) {
  const px = 256 * Math.pow(2, zoom - Z);
  const what = px < 2 ? '全道の模様' : px < 24 ? '模様を読む' : px < 200 ? 'セルを押して内訳' : '写真で実物を確認';
  return { px, what };
}

/*
 * ズームで主役を入れ替える。
 *
 * 引いているとき（模様を読む）はセルを濃く・写真を薄く、
 * 寄ったとき（実物を確かめる）はセルを薄く・写真を濃く。
 * z6 ではセル1辺が約1pxしかないので、ここで薄くすると写真しか見えなくなる。
 */
export const CELL_OPACITY = [
  'interpolate', ['linear'], ['zoom'],
  2, 0.96, 10, 0.94, 12, 0.82, 14, 0.5, 16, 0.28
];
export const PHOTO_OPACITY = [
  'interpolate', ['linear'], ['zoom'],
  2, 0.18, 8, 0.22, 11, 0.45, 13, 0.75, 15, 0.95
];

/** 下図の見せ方。auto はズーム連動、photo は常に濃く、none は消す。 */
export function photoOpacity(mode) {
  if (mode === 'photo') return 0.95;
  if (mode === 'none') return 0;
  return PHOTO_OPACITY;
}
