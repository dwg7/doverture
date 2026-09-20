/*
 * doverture 空間ID(z14)パネル — MapLibre への接続部分だけ。
 *
 * データの形に関するロジックは ./data.js に分けてある（ブラウザ無しで node から
 * テストするため。test/data.test.mjs）。ここに書くのは、描画しないと確かめられない
 * ことだけに絞る。
 */
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { Z, x2lon, y2lat, DIVERGING, SEQ, METRICS, toGeoJSON, extents, boundsOf, fillExpr, zoomHint }
  from './data.js';

const DATA = '../data/cells.json';
const ATTR =
  '<a href="https://www.gsi.go.jp/">国土地理院</a> 最適化ベクトルタイル(bvmap)・シームレス空中写真 | ' +
  '<a href="https://overturemaps.org/">Overture Maps</a> / ' +
  '<a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors | ' +
  '国土数値情報 N03（測量法に基づく国土地理院長承認（複製）R 4JHf 430） | ' +
  'タイル配信 stars.optgeo.org';

const $ = (id) => document.getElementById(id);

/** 失敗しても地図本体は生かす。真っ白にする代わりに、何が落ちたかを画面に出す。 */
function guard(what, fn) {
  try {
    return fn();
  } catch (err) {
    console.error(`[doverture] ${what} に失敗:`, err);
    const s = $('status');
    if (s) s.textContent = `${what} に失敗しました（${err.message}）`;
    return undefined;
  }
}

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
  // 名前空間化しておくと、アプリ独自の状態を同じハッシュに同居させられる
  // （cafebabe patterns/maplibre-gl-js-embedding.md）
  hash: 'map'
});
map.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), 'top-right');
map.addControl(new maplibregl.ScaleControl({ maxWidth: 120, unit: 'metric' }), 'bottom-right');

// コンテナが 0x0 のまま初期化されると地図が真っ黒になる（Map はコンストラクタ時に
// サイズを一度だけ測る）。後から正しいサイズが取れた時点で復旧させる。
// cafebabe patterns/maplibre-gl-js-output-testing.md（vientiane-planning-map 由来）
window.addEventListener('resize', () => map.resize());
document.addEventListener('visibilitychange', () => { if (!document.hidden) map.resize(); });

const sel = $('metric'), legend = $('legend'), readout = $('readout');
for (const m of METRICS) sel.add(new Option(m.name, m.key));

const badge = document.createElement('div');
badge.id = 'zoomBadge';
document.body.appendChild(badge);
function updateBadge() {
  const z = map.getZoom();
  const { px, what } = zoomHint(z);
  badge.textContent = `z${z.toFixed(1)}　1セル ${px < 1 ? px.toFixed(1) : Math.round(px)}px　${what}`;
}
map.on('move', updateBadge);

let data = null;
let geo = null;

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
    ends.innerHTML =
      `<span>${m.stops[0]}${m.unit}</span><span>${m.stops[m.stops.length - 1]}${m.unit}〜</span>`;
    legend.append(bar, ends);
  }
  const nd = document.createElement('div');
  nd.className = 'sw';
  nd.innerHTML = `<i style="background:#383835"></i>建物ゼロ / 算出できず`;
  legend.appendChild(nd);
}

function apply() {
  const m = METRICS.find((x) => x.key === sel.value) || METRICS[0];
  map.setPaintProperty('cells', 'fill-color', fillExpr(m));
  const f = $('showEmpty').checked ? null : ['==', ['get', 'empty'], 0];
  map.setFilter('cells', f);
  map.setFilter('cells-line', f);
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
  $('zoomHere').onclick = (ev) => {
    ev.preventDefault();
    map.fitBounds([[x2lon(p.x), y2lat(p.y + 1)], [x2lon(p.x + 1), y2lat(p.y)]],
                  { padding: 80, duration: 800 });
  };
}

map.on('load', async () => {
  updateBadge();
  try {
    const res = await fetch(DATA, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    data = await res.json();
  } catch (err) {
    $('status').textContent = `データを読めませんでした（${err.message}）`;
    return;
  }

  geo = guard('セルの組み立て', () => toGeoJSON(data));
  if (!geo) return;

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
  guard('指標の適用', apply);
  $('status').textContent = `${data.rows.length.toLocaleString()} セル・基準 ${String(data.asOf).slice(0, 10)}`;

  // 通るだけで出す。クリックを要求すると「どこを押せばいいか」が分からない。
  let last = null;
  map.on('mousemove', 'cells', (e) => {
    const p = e.features[0].properties;
    const id = p.x + '/' + p.y;
    if (id !== last) { last = id; guard('セルの読み取り', () => show(p)); }
    map.getCanvas().style.cursor = 'pointer';
  });
  map.on('mouseleave', 'cells', () => { map.getCanvas().style.cursor = ''; });
  map.on('click', 'cells', (e) => guard('セルの読み取り', () => show(e.features[0].properties)));

  guard('市区町村ジャンプの用意', () => {
    const jump = $('jump');
    const extent = extents(geo);
    [...extent.keys()]
      .map((c) => [c, (data.names && data.names[c]) || c])
      .sort((a, b) => a[0].localeCompare(b[0]))
      .forEach(([c, n]) => jump.add(new Option(`${n}（${c}）`, c)));
    jump.onchange = () => {
      const b = extent.get(jump.value);
      if (b) map.fitBounds(boundsOf(b), { padding: 60, duration: 900 });
    };
  });
});

sel.onchange = () => guard('指標の適用', apply);
$('showEmpty').onchange = () => guard('指標の適用', apply);
$('basemap').onchange = (e) =>
  map.setPaintProperty('aerial', 'raster-opacity', e.target.value === 'aerial' ? 0.85 : 0);
