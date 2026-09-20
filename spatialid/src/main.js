/*
 * doverture 空間ID(z14)パネル — MapLibre への接続部分だけ。
 *
 * データの形に関するロジックは ./data.js に分けてある（ブラウザ無しで node から
 * テストするため。test/data.test.mjs）。ここに書くのは、描画しないと確かめられない
 * ことだけに絞る。
 */
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { Z, x2lon, y2lat, DIVERGING, SEQ, METRICS, toGeoJSON, extents, boundsOf, fillExpr, zoomHint,
         CELL_OPACITY, photoOpacity } from './data.js';

const DATA = '../data/cells.json';
const ATTR =
  '<a href="https://www.gsi.go.jp/">国土地理院</a> 最適化ベクトルタイル(bvmap)・シームレス空中写真（kitaphoto17、CC BY 4.0） | ' +
  '<a href="https://overturemaps.org/">Overture Maps</a> / ' +
  '<a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors | ' +
  '国土数値情報 N03（測量法に基づく国土地理院長承認（複製）R 4JHf 430） | ' +
  'タイル配信 stars.optgeo.org';

const $ = (id) => document.getElementById(id);

/*
 * 自己診断バナー。
 * このセッションにはブラウザが無く、描画を目視できない。だから「どこまで進んで
 * どこで止まったか」をページ自身に画面へ書かせる。推測でやりとりしないため。
 */
const banner = document.createElement('div');
banner.id = 'banner';
document.body.appendChild(banner);
const steps = [];
function step(msg, kind) {
  steps.push(msg);
  banner.textContent = msg;
  banner.className = kind || '';
  console.log('[doverture] ' + msg);
}
function fail(msg, err) {
  console.error('[doverture] ' + msg, err);
  banner.textContent = `${msg}：${err && err.message ? err.message : err}`;
  banner.className = 'bad';
}

/** 失敗しても地図本体は生かす。真っ白にする代わりに、何が落ちたかを画面に出す。 */
function guard(what, fn) {
  try {
    return fn();
  } catch (err) {
    fail(`${what} に失敗`, err);
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
      // kitaphoto17: 低ズーム(z2-12)は kitaphoto（黒い nodata 画素を処理済み）、
      // 高ズーム(z13-17)は seamlessphoto512 の実データ。北海道＋北方領土に
      // 切り出されていて、doverture の母集団の範囲とそのまま一致する。
      // 生の seamlessphoto512 は低ズームに黒い nodata が残る（実測: z6 で 99 画素）。
      aerial: {
        type: 'raster',
        tiles: ['https://stars.optgeo.org/kitaphoto17/{z}/{x}/{y}'],
        tileSize: 512, minzoom: 2, maxzoom: 17,
        bounds: [137.8125, 40.979898, 151.875, 47.040182],
        attribution: ATTR
      }
    },
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': '#1a1a19' } },
      { id: 'aerial', type: 'raster', source: 'aerial', paint: { 'raster-opacity': 0.18 } }
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

step('地図を初期化しました。セルを読み込みます…');

map.on('load', async () => {
  updateBadge();
  try {
    step(`${DATA} を取得中…`);
    const res = await fetch(DATA, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    data = await res.json();
    step(`${data.rows.length.toLocaleString()} 行を受け取りました。組み立て中…`);
  } catch (err) {
    fail('セルのデータを読めませんでした', err);
    $('status').textContent = `データを読めませんでした（${err.message}）`;
    return;
  }

  geo = guard('セルの組み立て', () => toGeoJSON(data));
  if (!geo) return;

  map.addSource('cells', { type: 'geojson', data: geo });
  map.addLayer({
    id: 'cells', type: 'fill', source: 'cells',
    paint: { 'fill-color': '#383835', 'fill-opacity': CELL_OPACITY }
  });
  map.addLayer({
    id: 'cells-line', type: 'line', source: 'cells',
    paint: { 'line-color': '#1a1a19', 'line-width': 0.4, 'line-opacity': 0.35 },
    minzoom: 9
  });
  guard('指標の適用', apply);
  guard('下図の初期化', () =>
    map.setPaintProperty('aerial', 'raster-opacity', photoOpacity($('basemap').value)));
  $('status').textContent = `${data.rows.length.toLocaleString()} セル・基準 ${String(data.asOf).slice(0, 10)}`;
  step(`セル ${geo.features.length.toLocaleString()} 件を地図に追加しました。描画待ち…`);

  // 本当に描かれたかを地図自身に確かめさせる。0 件なら、追加できていても見えていない。
  map.once('idle', () => {
    let drawn = -1;
    try { drawn = map.queryRenderedFeatures({ layers: ['cells'] }).length; } catch (e) { /* noop */ }
    if (drawn > 0) {
      step(`描画 ${drawn.toLocaleString()} 件（画面内）`, 'ok');
      setTimeout(() => { banner.className = 'gone'; }, 4000);
    } else {
      fail('セルを追加したのに画面に描かれていません',
           new Error(`z${map.getZoom().toFixed(1)} / レイヤー ${map.getLayer('cells') ? 'あり' : 'なし'}`
                     + ` / 不透明度 ${JSON.stringify(map.getPaintProperty('cells', 'fill-opacity'))}`));
    }
  });

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
  guard('下図の切り替え', () =>
    map.setPaintProperty('aerial', 'raster-opacity', photoOpacity(e.target.value)));
