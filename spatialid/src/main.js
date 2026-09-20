/*
 * doverture 空間ID(z14)パネル
 *
 * 北海道の z14 セル（= 空間ID ZFXY の f=0 面）ごとの建物件数を、データソース別に
 * 塗り分ける。セルの矩形は (14, x, y) から組み立てる——配信するのは件数だけで、
 * ジオメトリは持たない（CLAUDE.md「やらないこと」）。
 *
 * 配色は DECISIONS.md D10 と同じ7階級の発散尺度。暗い面 #1a1a19 に対して
 * 青アーム・赤アームを個別に検証済み。
 */
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

const DATA = '../data/cells.json';
const ATTR =
  '<a href="https://www.gsi.go.jp/">国土地理院</a> 最適化ベクトルタイル(bvmap)・シームレス空中写真 | ' +
  '<a href="https://overturemaps.org/">Overture Maps</a> / ' +
  '<a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors | ' +
  '国土数値情報 N03（測量法に基づく国土地理院長承認（複製）R 4JHf 430） | ' +
  'タイル配信 stars.optgeo.org';

/* ---- 発散尺度（D10 と同一） ---------------------------------------------- */
const DIVERGING = [
  [0.70, '#9ec5f4', 'bvmap が大きく多い（〜0.70）'],
  [0.85, '#5598e7', 'bvmap が多い（0.70〜0.85）'],
  [0.95, '#256abf', 'bvmap がやや多い（0.85〜0.95）'],
  [1.05, '#6e6d67', 'ほぼ互角（0.95〜1.05）'],
  [1.30, '#a83232', 'Overture がやや多い（1.05〜1.30）'],
  [1.80, '#d95f5f', 'Overture が多い（1.30〜1.80）'],
  [Infinity, '#f2a3a3', 'Overture が大きく多い（1.80〜）']
];
/** 逐次ランプ（青・単色）。暗い面では明るいほど大きい値。 */
const SEQ = ['#184f95', '#256abf', '#3987e5', '#6da7ec', '#9ec5f4', '#cde2fb'];

/** 指標の定義。expr は塗り色の MapLibre 式、legend は凡例の作り方。 */
const METRICS = [
  {
    key: 'ratio', name: 'どちらが多く捉えているか（Overture ÷ bvmap）',
    kind: 'diverging',
    expr: () => {
      const e = ['step', ['get', 'ratio'], DIVERGING[0][1]];
      for (let i = 0; i < DIVERGING.length - 1; i++) e.push(DIVERGING[i][0], DIVERGING[i + 1][1]);
      return e;
    },
    valid: (p) => p.bv > 0 && p.ov > 0
  },
  { key: 'bv',  name: 'bvmap 建物数（国土地理院）', kind: 'seq', prop: 'bv',  stops: [1, 5, 20, 80, 300, 1200], unit: '件' },
  { key: 'ov',  name: 'Overture 建物数',           kind: 'seq', prop: 'ov',  stops: [1, 5, 20, 80, 300, 1200], unit: '件' },
  { key: 'oth', name: 'Microsoft ほか（OSM・東アジア学術以外）', kind: 'seq', prop: 'oth', stops: [1, 3, 10, 30, 100, 400], unit: '件' },
  { key: 'othShare', name: 'Overture に占める Microsoft ほかの割合', kind: 'seq', prop: 'othShare', stops: [0, 5, 10, 20, 35, 50], unit: '%' },
  { key: 'osmShare', name: 'Overture に占める OSM 由来の割合',      kind: 'seq', prop: 'osmShare', stops: [40, 60, 75, 85, 95, 100], unit: '%' }
];

/* ---- タイル座標 → 経緯度 -------------------------------------------------- */
const Z = 14, N = 2 ** Z;
const x2lon = (x) => (x / N) * 360 - 180;
const y2lat = (y) => {
  const n = Math.PI - (2 * Math.PI * y) / N;
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
};

const map = new maplibregl.Map({
  container: 'map',
  style: {
    version: 8,
    sources: {
      aerial: {
        type: 'raster',
        tiles: ['https://stars.optgeo.org/seamlessphoto512/{z}/{x}/{y}'],
        tileSize: 512, minzoom: 1, maxzoom: 17, attribution: ATTR
      }
    },
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': '#1a1a19' } },
      { id: 'aerial', type: 'raster', source: 'aerial', paint: { 'raster-opacity': 0.85 } }
    ]
  },
  center: [142.6, 43.4],
  zoom: 6.2,
  maxZoom: 17,
  hash: true
});
map.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), 'top-right');
const badge = document.createElement('div');
badge.id = 'zoomBadge';
document.body.appendChild(badge);
/** セル1辺が画面上で何pxになるかを出す。使い方の表と同じ目盛りを、実際の値で見せる。 */
function updateBadge() {
  const z = map.getZoom();
  const px = 256 * Math.pow(2, z - Z);   // z14セル1辺のピクセル数
  const what = px < 2 ? '全道の模様' : px < 24 ? '模様を読む' : px < 200 ? 'セルを押して内訳' : '写真で実物を確認';
  badge.textContent = `z${z.toFixed(1)}　1セル ${px < 1 ? px.toFixed(1) : Math.round(px)}px　${what}`;
}
map.on('move', updateBadge);
map.on('load', updateBadge);
map.addControl(new maplibregl.ScaleControl({ maxWidth: 120, unit: 'metric' }), 'bottom-right');

const $ = (id) => document.getElementById(id);
const sel = $('metric'), status = $('status'), legend = $('legend'), readout = $('readout');
for (const m of METRICS) sel.add(new Option(m.name, m.key));

let data = null;
let geo = null;   // toGeoJSON の結果。MapLibre の非公開APIを覗かずに済ませるため保持する

function toGeoJSON(doc) {
  const i = Object.fromEntries(doc.cols.map((c, k) => [c, k]));
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
        bvArea: r[i.bvArea], ovArea: r[i.ovArea],
        ratio: bv > 0 ? ov / bv : -1,
        othShare: ov > 0 ? (oth / ov) * 100 : -1,
        osmShare: ov > 0 ? (osm / ov) * 100 : -1,
        empty: bv === 0 && ov === 0 ? 1 : 0
      }
    };
  }
  return { type: 'FeatureCollection', features };
}

function seqExpr(prop, stops) {
  const e = ['step', ['get', prop], SEQ[0]];
  for (let k = 1; k < SEQ.length; k++) e.push(stops[k], SEQ[k]);
  return e;
}

function drawLegend(m) {
  legend.innerHTML = '';
  if (m.kind === 'diverging') {
    for (const [, color, label] of DIVERGING) {
      const d = document.createElement('div');
      d.className = 'sw';
      d.innerHTML = `<i style="background:${color}"></i>${label}`;
      legend.appendChild(d);
    }
  } else {
    const bar = document.createElement('div');
    bar.className = 'bar';
    bar.style.background = `linear-gradient(90deg, ${SEQ.join(',')})`;
    const ends = document.createElement('div');
    ends.className = 'ends';
    ends.innerHTML = `<span>${m.stops[0]}${m.unit}</span><span>${m.stops[m.stops.length - 1]}${m.unit}〜</span>`;
    legend.append(bar, ends);
  }
  const nd = document.createElement('div');
  nd.className = 'sw';
  nd.innerHTML = `<i style="background:#383835"></i>建物ゼロ / 対象外`;
  legend.appendChild(nd);
}

function apply() {
  const m = METRICS.find((x) => x.key === sel.value);
  const paint = m.kind === 'diverging' ? m.expr() : seqExpr(m.prop, m.stops);
  map.setPaintProperty('cells', 'fill-color',
    ['case', ['<', ['get', m.kind === 'diverging' ? 'ratio' : m.prop], 0], '#383835', paint]);
  const hideEmpty = !$('showEmpty').checked;
  map.setFilter('cells', hideEmpty ? ['==', ['get', 'empty'], 0] : null);
  map.setFilter('cells-line', hideEmpty ? ['==', ['get', 'empty'], 0] : null);
  drawLegend(m);
}

function show(p) {
  const name = (data.names && data.names[p.code]) || p.code;
  const pct = (a, b) => (b > 0 ? ((a / b) * 100).toFixed(1) + '%' : '—');
  readout.hidden = false;
  readout.innerHTML = `
    <h2>${name}　<span style="color:var(--muted);font-weight:400">z14/${p.x}/${p.y}</span></h2>
    <table>
      <tr><td>bvmap（国土地理院）</td><td>${p.bv.toLocaleString()} 件</td></tr>
      <tr><td>Overture 合計</td><td>${p.ov.toLocaleString()} 件</td></tr>
      <tr><td>　OSM 由来</td><td>${p.osm.toLocaleString()}（${pct(p.osm, p.ov)}）</td></tr>
      <tr><td>　東アジア学術</td><td>${p.eab.toLocaleString()}（${pct(p.eab, p.ov)}）</td></tr>
      <tr><td>　Microsoft ほか</td><td>${p.oth.toLocaleString()}（${pct(p.oth, p.ov)}）</td></tr>
      <tr><td>Overture ÷ bvmap</td><td>${p.bv > 0 ? (p.ov / p.bv).toFixed(2) : '—'}</td></tr>
      <tr><td>建物面積 bvmap / Overture</td><td>${Math.round(p.bvArea / 1000).toLocaleString()} / ${Math.round(p.ovArea / 1000).toLocaleString()} 千m²</td></tr>
    </table>
    <a href="#" id="zoomHere">この区画を拡大して写真で見る</a>
    <p class="hint">拡大すると下図の空中写真で、実際に建物があるか確かめられます。</p>`;
  document.getElementById('zoomHere').onclick = (ev) => {
    ev.preventDefault();
    map.fitBounds([[x2lon(p.x), y2lat(p.y + 1)], [x2lon(p.x + 1), y2lat(p.y)]], { padding: 80, duration: 800 });
  };
}

map.on('load', async () => {
  try {
    const res = await fetch(DATA, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    data = await res.json();
  } catch (err) {
    status.textContent = `データを読めませんでした（${err.message}）`;
    return;
  }
  geo = toGeoJSON(data);
  map.addSource('cells', { type: 'geojson', data: geo });
  map.addLayer({
    id: 'cells', type: 'fill', source: 'cells',
    paint: { 'fill-color': '#383835', 'fill-opacity': 0.72 }
  });
  map.addLayer({
    id: 'cells-line', type: 'line', source: 'cells',
    paint: { 'line-color': '#1a1a19', 'line-width': 0.4, 'line-opacity': 0.5 },
    minzoom: 9
  });
  apply();
  const done = data.rows.length;
  status.textContent = `${done.toLocaleString()} セル・基準 ${data.asOf.slice(0, 10)}`;

  // 通るだけで出す。クリックを要求すると「どこを押せばいいか」が分からない。
  let last = null;
  map.on('mousemove', 'cells', (e) => {
    const p = e.features[0].properties;
    const id = p.x + '/' + p.y;
    if (id !== last) { last = id; show(p); }
    map.getCanvas().style.cursor = 'pointer';
  });
  map.on('mouseleave', 'cells', () => { map.getCanvas().style.cursor = ''; });
  map.on('click', 'cells', (e) => show(e.features[0].properties));

  // 市区町村ジャンプ。セルの外接矩形へ飛ぶ。
  const jump = $('jump');
  const extent = new Map();
  for (const f of geo.features) {
    const p = f.properties;
    const b = extent.get(p.code) || [Infinity, Infinity, -Infinity, -Infinity];
    b[0] = Math.min(b[0], p.x); b[1] = Math.min(b[1], p.y);
    b[2] = Math.max(b[2], p.x); b[3] = Math.max(b[3], p.y);
    extent.set(p.code, b);
  }
  [...extent.keys()]
    .map((c) => [c, (data.names && data.names[c]) || c])
    .sort((a, b) => a[0].localeCompare(b[0]))
    .forEach(([c, n]) => jump.add(new Option(`${n}（${c}）`, c)));
  jump.onchange = () => {
    const b = extent.get(jump.value);
    if (!b) return;
    map.fitBounds([[x2lon(b[0]), y2lat(b[3] + 1)], [x2lon(b[2] + 1), y2lat(b[1])]],
                  { padding: 60, duration: 900 });
  };
});

sel.onchange = apply;
$('showEmpty').onchange = apply;
$('basemap').onchange = (e) =>
  map.setPaintProperty('aerial', 'raster-opacity', e.target.value === 'aerial' ? 0.85 : 0);
