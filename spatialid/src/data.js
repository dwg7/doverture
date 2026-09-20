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
// 面積比。取得精度の差に鈍い方の物差し（D31）
const AREA_RATIO = ['/', n('ovA'), n('bvA')];
const SHARE = (k) => ['*', ['/', n(k), n('ov')], 100];

export const METRICS = [
  { key: 'ratio', name: 'Overture ÷ bvmap（件数）',
    kind: 'diverging', value: RATIO, valid: ['>', n('bv'), 0],
    note: '件数の比。bvmap は都市計画区域の外では小さな建物を採っていないため、'
        + '区域外では分母が小さくなって比が上がる（D30）。密度を揃えても内外で +0.52 違う。' },
  { key: 'aratio', name: 'Overture ÷ bvmap（面積）',
    kind: 'diverging', value: AREA_RATIO, valid: ['>', n('bvA'), 0],
    note: '延べ面積の比。小さな建物は面積をほとんど持たないので、bvmap の取得精度の差に鈍い。'
        + '区域の内外差は件数比の +0.52 に対して +0.11 まで落ちる。' },
  { key: 'bv', name: 'bvmap 建物数', kind: 'seq',
    value: n('bv'), valid: true, stops: [1, 5, 20, 80, 300, 1200], unit: '件' },
  { key: 'ov', name: 'Overture 建物数', kind: 'seq',
    value: n('ov'), valid: true, stops: [1, 5, 20, 80, 300, 1200], unit: '件' },
  { key: 'oth', name: 'Microsoft ほかの件数', kind: 'seq',
    value: n('oth'), valid: true, stops: [1, 3, 10, 30, 100, 400], unit: '件' },
  { key: 'othShare', name: 'Microsoft ほかの割合', kind: 'seq',
    value: SHARE('oth'), valid: ['>', n('ov'), 0], stops: [0, 5, 10, 20, 35, 50], unit: '%' },
  { key: 'osmShare', name: 'OSM 由来の割合', kind: 'seq',
    value: SHARE('osm'), valid: ['>', n('ov'), 0], stops: [40, 60, 75, 85, 95, 100], unit: '%' }
];

/** 建物が1件も無いセルを隠すフィルタ。タイルに empty 属性は無いので式で判定する。 */
export const NONEMPTY = ['any', ['>', n('bv'), 0], ['>', n('ov'), 0]];

/*
 * 建物の輪郭（z14以上）。セルの集計では見えない「実際に何が建っていることに
 * なっているか」を、空中写真の上に直接重ねる。D11/D12 の検証ループを、
 * 抽出目視ではなく地図上で回せるようにするためのもの。
 *
 * 配色：CVD 分離は ΔE 18.3(deutan) / 35.6(normal) で余裕がある。明度帯からは
 * 意図的に外した——この線が乗るのは平坦な図面の面ではなく空中写真で、
 * 任意の明るさの背景から抜けるには帯の上側が要る。
 * 色だけに頼らないよう、Overture は破線にしてある（二重符号化）。
 */
/** Overture の `@geometry_source` のうち、OSM を表す値。 */
export const OSM_SOURCE = 'OpenStreetMap';
export const IS_OSM = ['==', ['get', '@geometry_source'], OSM_SOURCE];
export const IS_NOT_OSM = ['!=', ['get', '@geometry_source'], OSM_SOURCE];

export const FOOTPRINT = {
  // **z16 未満で出してはいけない。**
  // bvmap の BldA は z16 以外では間引かれている（同じ地面で z14 は z16 の 4.5%、
  // z15 は 17%。D2）。輪郭を z14 から出すと、間引かれた bvmap と完全な Overture を
  // 並べることになり、**このプロジェクトが一日かけて避けた誤った比較を画面上で
  // 再現する**。ソース側も minzoom:16/maxzoom:16 に絞り、MapLibre が z16 タイルしか
  // 使えないようにしてある。
  minzoom: 16,
  /*
   * 色は「どのデータセットか」、線種は「誰が見たか」を表す。
   * OSM は人が現地・画像を見て引いた線なので実線、Microsoft と研究データは
   * 自動検出で**誰も検証していない**ので点線。D12 で共和町の Microsoft 検出が
   * 16点中15点まで建物でなかったことが、そのまま線種に出る。
   */
  bvmap:       { color: '#3ee0e0', name: 'bvmap', dash: null },
  overtureOsm: { color: '#ff5a5a', name: 'Overture（OSM 由来）', dash: null },
  overtureAi:  { color: '#ff5a5a', name: 'Overture（未検証）',
                 dash: [0.6, 1.8], cap: 'round' }
};

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

/** タイルの設計。セルは**どのズームでも z14**、タイルは z12 まで（以降は overzoom）。 */
export const MAXZOOM = 12;

/**
 * 画面上でセル1辺が何pxになるか。セルのレベルは常に Z(=14)。
 *
 * MapLibre のベクタタイルは 512px 扱いなので、表示ズーム d での z14 セルの
 * 1辺は 512 * 2^(d - 14) px。d=6 で約2px、d=10 で32px、d=14 で512px。
 *
 * かつてはタイルのズームごとにセルのレベルを変え、1辺を常に64pxに保っていた。
 * 見た目は安定するが、**ズームを変えるたびに別の集計単位の統計を見ている**
 * ことになり、模様の変化がデータ由来か集計単位由来か区別できなくなる。
 * 今はレベルを固定したので、ズームしても同じ統計を拡大縮小しているだけになる（D29）。
 */
export function zoomHint(zoom) {
  const level = Z;
  const px = 512 * Math.pow(2, zoom - level);
  const what = px < 4 ? '全道の地肌'
             : px < 24 ? 'z14セルの模様'
             : px < 400 ? 'セルを押して内訳'
             : '写真で実物を確認';
  return { px, level, what };
}

/*
 * 面はどのズームでも透過させ、下図の写真を透かす。
 *
 * セルは低ズームで1〜2pxまで細かくなる（D29）。かつて z14 セルを全ズームで
 * 描いていた頃に薄くして失敗した状況に戻るが（D16）、あのときの誤りは
 * 「セルが細かいこと」ではなく「細かいうえに薄いこと」だった。セルは陸域を
 * 隙間なく覆うので、不透明度さえ足りていれば点描ではなく地肌として読める。
 * そこで**引いているときほど面を濃く**し、寄るほど薄くして写真に主役を譲る。
 * 作業の流れ（引いて分布を読み、寄って実物を確かめる）とも向きが一致する。
 */
export const CELL_OPACITY = [
  'interpolate', ['linear'], ['zoom'],
  2, 0.80, 8, 0.78, 10, 0.72, 12, 0.58, 14, 0.42, 16, 0.30, 18, 0.18
];
export const PHOTO_OPACITY = [
  'interpolate', ['linear'], ['zoom'],
  2, 0.55, 8, 0.62, 11, 0.75, 13, 0.88, 15, 0.96
];

/*
 * 低ズームの下図は、色と明るさを落として後ろへ下げる。
 *
 * 実画面で撮って分かったこと（D31）：z6 の海域に、四角いタイル単位の色違いが
 * はっきり出る。低ズームの空中写真が衛星モザイクと地理院タイルの混成だからで、
 * 上流の素性であってこちらのバグではない。
 *
 * D29 で低ズームが「全道の地肌を読む」主役の縮尺になったので、そこで下図が
 * 継ぎ目を主張してくるのは邪魔でしかない。寄ったときの下図は建物を確かめる
 * 証拠なので色は要るが、引いたときの下図は文脈でしかない。**引いたら彩度と
 * 明るさを落とし、寄るほど元に戻す。**
 */
export const PHOTO_SATURATION = [
  'interpolate', ['linear'], ['zoom'], 4, -0.85, 9, -0.70, 13, 0
];
export const PHOTO_BRIGHTNESS_MAX = [
  'interpolate', ['linear'], ['zoom'], 4, 0.70, 9, 0.82, 13, 1
];

/** 下図の見せ方。auto はズーム連動、photo は常に濃く、none は消す。 */
export function photoOpacity(mode) {
  if (mode === 'photo') return 0.95;
  if (mode === 'none') return 0;
  return PHOTO_OPACITY;
}
