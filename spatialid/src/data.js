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

/*
 * 指標。値はタイルに入っている生の属性（bv/ov/osm/eab/oth）から**式で**導く。
 * タイル側に派生値を持たせないのは、比率の定義を変えるたびにタイルを焼き直したく
 * ないから。value は MapLibre 式、valid は「値が計算できるか」の式。
 */
const n = (k) => ['to-number', ['get', k], 0];
const RATIO = ['/', n('ov'), n('bv')];
const SHARE = (k) => ['*', ['/', n(k), n('ov')], 100];

export const METRICS = [
  { key: 'ratio', name: 'どちらが多く捉えているか（Overture ÷ bvmap）',
    kind: 'diverging', value: RATIO, valid: ['>', n('bv'), 0] },
  { key: 'bv', name: 'bvmap 建物数（国土地理院）', kind: 'seq',
    value: n('bv'), valid: true, stops: [1, 5, 20, 80, 300, 1200], unit: '件' },
  { key: 'ov', name: 'Overture 建物数', kind: 'seq',
    value: n('ov'), valid: true, stops: [1, 5, 20, 80, 300, 1200], unit: '件' },
  { key: 'oth', name: 'Microsoft ほか（OSM・東アジア学術以外）', kind: 'seq',
    value: n('oth'), valid: true, stops: [1, 3, 10, 30, 100, 400], unit: '件' },
  { key: 'othShare', name: 'Overture に占める Microsoft ほかの割合', kind: 'seq',
    value: SHARE('oth'), valid: ['>', n('ov'), 0], stops: [0, 5, 10, 20, 35, 50], unit: '%' },
  { key: 'osmShare', name: 'Overture に占める OSM 由来の割合', kind: 'seq',
    value: SHARE('osm'), valid: ['>', n('ov'), 0], stops: [40, 60, 75, 85, 95, 100], unit: '%' }
];

/** 建物が1件も無いセルを隠すフィルタ。タイルに empty 属性は無いので式で判定する。 */
export const NONEMPTY = ['any', ['>', n('bv'), 0], ['>', n('ov'), 0]];

/** bbox [w,s,e,n] -> fitBounds に渡す [[w,s],[e,n]]。 */
export const boundsOf = (b) => [[b[0], b[1]], [b[2], b[3]]];

/** 塗り色の MapLibre 式。未算出(-1)は無データ色へ落とす。 */
export const NODATA = '#383835';

export function fillExpr(metric) {
  let paint;
  if (metric.kind === 'diverging') {
    paint = ['step', metric.value, DIVERGING[0][1]];
    for (let i = 0; i < DIVERGING.length - 1; i++) paint.push(DIVERGING[i][0], DIVERGING[i + 1][1]);
  } else {
    paint = ['step', metric.value, SEQ[0]];
    for (let k = 1; k < SEQ.length; k++) paint.push(metric.stops[k], SEQ[k]);
  }
  return metric.valid === true ? paint : ['case', metric.valid, paint, NODATA];
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
