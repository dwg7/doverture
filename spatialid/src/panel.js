/*
 * doverture 空間ID(z14)パネル — 任意のコンテナに載せられる形。
 *
 * スタンドアロンのページ(src/main.js)からも、Open MCT のビュー(src/embed.js 経由)からも
 * 同じものを使う。DOM は全部ここで作り、.dvt-root の下に閉じる。
 *
 * データの形に関するロジックは ./data.js（ブラウザ無しで node からテストする）。
 * ここに書くのは、描画しないと確かめられないことだけ。
 */
import * as maplibregl from 'maplibre-gl';
import mlCss from 'maplibre-gl/dist/maplibre-gl.css?inline';
import ownCss from './style.css?inline';
import { Protocol } from 'pmtiles';
// MapLibre v6 は worker を別ファイルで配り、その場所を自分の import.meta.url から
// 導く。バンドルに取り込むと存在しないパスを見に行って 404 になり、ワーカーが
// 起動しないまま沈黙する（DECISIONS.md D18/D19）。明示的に教える。
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { Z, x2lon, y2lat, DIVERGING, SEQ, METRICS, NONEMPTY, boundsOf, fillExpr, zoomHint,
         CELL_OPACITY, photoOpacity } from './data.js';

maplibregl.setWorkerUrl(maplibreWorkerUrl);
maplibregl.addProtocol('pmtiles', new Protocol().tile);

const ATTR =
  '<a href="https://www.gsi.go.jp/">国土地理院</a> 最適化ベクトルタイル(bvmap)・シームレス空中写真（kitaphoto17、CC BY 4.0） | ' +
  '<a href="https://overturemaps.org/">Overture Maps</a> / ' +
  '<a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors | ' +
  '国土数値情報 N03（測量法に基づく国土地理院長承認（複製）R 4JHf 430） | ' +
  'タイル配信 stars.optgeo.org';
const SRC_LAYER = 'cells';

/** スタイルを一度だけ差し込む（複数インスタンスでも1回）。 */
let styled = false;
function injectStyles() {
  if (styled) return;
  styled = true;
  const el = document.createElement('style');
  el.dataset.doverture = 'panel';
  el.textContent = mlCss + '\n' + ownCss;
  document.head.appendChild(el);
}

const el = (tag, cls, html) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html != null) n.innerHTML = html;
  return n;
};

/**
 * パネルを container に載せる。
 * @param {HTMLElement} container
 * @param {{dataBase?: string}} [opts] dataBase は cells.pmtiles などの置き場所（末尾 /）
 * @returns {{destroy: () => void}}
 */
export function createPanel(container, opts = {}) {
  injectStyles();
  const base = opts.dataBase || new URL('../../data/', import.meta.url).href;
  const TILES = new URL('doverture-cells.pmtiles', base).href;
  const EXTENTS = new URL('municipal-extents.json', base).href;

  const root = el('div', 'dvt-root');
  const mapEl = el('div', 'dvt-map');
  const panel = el('div', 'dvt-panel');
  const readout = el('div', 'dvt-readout');
  const banner = el('div', 'dvt-banner');
  const badge = el('div', 'dvt-badge');
  readout.hidden = true;
  root.append(mapEl, panel, readout, banner, badge);
  container.appendChild(root);

  panel.append(
    el('h1', 'dvt-title', 'doverture<span>北海道 z14 空間IDセル</span>'),
    el('details', 'dvt-howto', `<summary>使い方</summary>
      <table>
        <tr><th>ズーム</th><th>セル</th><th>できること</th></tr>
        <tr><td>z5–7</td><td>z7–9（14–56km）</td><td>全道の分布</td></tr>
        <tr><td>z8–11</td><td>z10–13（3.5–28km）</td><td>振興局・市町村の傾向</td></tr>
        <tr><td>z12–13</td><td>z14（1.8km）</td><td>セルを見て内訳</td></tr>
        <tr><td>z14–17</td><td>z14（拡大）</td><td>写真で実物を確認</td></tr>
      </table>
      <p><b>どのズームでもセルは約64px</b>——空間IDの階層をそのままタイルの階層に
      使っているので、引くと粗いセル、寄ると細かいセルに自動で切り替わります。<br>
      <b>セルの上を通るだけで数字</b>が出ます。建物ゼロのセルは既定で隠しています
      （全体の約半分）。面は<b>常に透過</b>していて、下の空中写真が透けます。</p>`)
  );
  const mkSelect = (labelText) => {
    panel.appendChild(el('label', null, labelText));
    const s = document.createElement('select');
    panel.appendChild(s);
    return s;
  };
  const jump = mkSelect('市区町村へ移動');
  jump.add(new Option('— 選ぶ —', ''));
  const sel = mkSelect('指標');
  for (const m of METRICS) sel.add(new Option(m.name, m.key));
  const legend = el('div', 'dvt-legend');
  panel.appendChild(legend);
  const basemap = mkSelect('下図');
  for (const [v, t] of [['auto', '自動（引くとデータ／寄ると写真）'], ['photo', '写真を常に濃く'], ['none', '写真なし']]) {
    basemap.add(new Option(t, v));
  }
  const showEmptyLabel = el('label', 'dvt-row');
  const showEmpty = document.createElement('input');
  showEmpty.type = 'checkbox';
  showEmptyLabel.append(showEmpty, document.createTextNode(' 建物ゼロのセルも塗る'));
  panel.appendChild(showEmptyLabel);
  const status = el('p', 'dvt-status', '読み込み中…');
  panel.appendChild(status);

  const step = (msg, kind) => { banner.textContent = msg; banner.className = 'dvt-banner' + (kind ? ' ' + kind : ''); console.log('[doverture] ' + msg); };
  const fail = (msg, err) => {
    console.error('[doverture] ' + msg, err);
    banner.textContent = `${msg}：${err && err.message ? err.message : err}`;
    banner.className = 'dvt-banner dvt-bad';
    status.textContent = `${msg}（${err && err.message ? err.message : err}）`;
  };
  const guard = (what, fn) => { try { return fn(); } catch (err) { fail(`${what} に失敗`, err); return undefined; } };

  const map = new maplibregl.Map({
    container: mapEl,
    style: {
      version: 8,
      sources: {
        cells: { type: 'vector', url: 'pmtiles://' + TILES },
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
    center: [142.6, 43.4], zoom: 6.2, maxZoom: 17,
    hash: opts.hash === false ? false : 'map'
  });
  map.on('error', (e) => fail(`MapLibre エラー${e && e.sourceId ? `（${e.sourceId}）` : ''}`, (e && e.error) || e));
  map.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), 'top-right');
  map.addControl(new maplibregl.ScaleControl({ maxWidth: 120, unit: 'metric' }), 'bottom-right');

  // コンテナが 0x0 のまま初期化されると地図が真っ黒になる（Map はコンストラクタ時に
  // 一度だけサイズを測る）。ホストが後からサイズを与える場合に復旧させる。
  // cafebabe patterns/maplibre-gl-js-output-testing.md（vientiane-planning-map 由来）
  const onResize = () => map.resize();
  window.addEventListener('resize', onResize);
  document.addEventListener('visibilitychange', onResize);
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(onResize) : null;
  if (ro) ro.observe(container);

  const updateBadge = () => {
    const z = map.getZoom();
    const { px, level, what } = zoomHint(z);
    badge.textContent = `z${z.toFixed(1)}　セル z${level}・${Math.round(px)}px　${what}`;
  };
  map.on('move', updateBadge);

  function drawLegend(m) {
    legend.innerHTML = '';
    if (m.kind === 'diverging') {
      for (const [, color, label] of DIVERGING) legend.appendChild(el('div', 'dvt-sw', `<i style="background:${color}"></i>${label}`));
    } else {
      const bar = el('div', 'dvt-bar');
      bar.style.background = `linear-gradient(90deg, ${SEQ.join(',')})`;
      legend.append(bar, el('div', 'dvt-ends',
        `<span>${m.stops[0]}${m.unit}</span><span>${m.stops[m.stops.length - 1]}${m.unit}〜</span>`));
    }
    legend.appendChild(el('div', 'dvt-sw', `<i style="background:#383835"></i>建物ゼロ / 算出できず`));
  }

  function apply() {
    const m = METRICS.find((x) => x.key === sel.value) || METRICS[0];
    map.setPaintProperty('cells', 'fill-color', fillExpr(m));
    const f = showEmpty.checked ? null : NONEMPTY;
    map.setFilter('cells', f);
    map.setFilter('cells-line', f);
    drawLegend(m);
  }

  function show(p, lngLat) {
    const pct = (a, b) => (b > 0 ? ((a / b) * 100).toFixed(1) + '%' : '—');
    const lv = p.lv || 14;
    readout.hidden = false;
    readout.innerHTML = `
      <h2>${p.name || p.code}　<span style="color:var(--dvt-muted);font-weight:400">空間ID z${lv}${p.cells > 1 ? `（z14セル ${p.cells} 個ぶん）` : ''}</span></h2>
      <table>
        <tr><td>bvmap（国土地理院）</td><td>${(+p.bv).toLocaleString()} 件</td></tr>
        <tr><td>Overture 合計</td><td>${(+p.ov).toLocaleString()} 件</td></tr>
        <tr><td>　OSM 由来</td><td>${(+p.osm).toLocaleString()}（${pct(+p.osm, +p.ov)}）</td></tr>
        <tr><td>　東アジア学術</td><td>${(+p.eab).toLocaleString()}（${pct(+p.eab, +p.ov)}）</td></tr>
        <tr><td>　Microsoft ほか</td><td>${(+p.oth).toLocaleString()}（${pct(+p.oth, +p.ov)}）</td></tr>
        <tr><td>Overture ÷ bvmap</td><td>${+p.bv > 0 ? (+p.ov / +p.bv).toFixed(2) : '—'}</td></tr>
        <tr><td>建物面積 bvmap / Overture</td><td>${Math.round(+p.bvA / 1000).toLocaleString()} / ${Math.round(+p.ovA / 1000).toLocaleString()} 千m²</td></tr>
      </table>
      <a href="#" class="dvt-zoom">この区画を拡大して写真で見る</a>
      <p class="dvt-hint">拡大すると下図の空中写真で、実際に建物があるか確かめられます。</p>`;
    readout.querySelector('.dvt-zoom').onclick = (ev) => {
      ev.preventDefault();
      if (lngLat) map.easeTo({ center: lngLat, zoom: Math.max(map.getZoom(), 15.5), duration: 800 });
    };
  }

  step('地図を初期化しています…');
  map.on('load', async () => {
    updateBadge();
    guard('セルのレイヤー追加', () => {
      map.addLayer({ id: 'cells', type: 'fill', source: 'cells', 'source-layer': SRC_LAYER,
                     paint: { 'fill-color': '#383835', 'fill-opacity': CELL_OPACITY } });
      map.addLayer({ id: 'cells-line', type: 'line', source: 'cells', 'source-layer': SRC_LAYER,
                     paint: { 'line-color': '#1a1a19', 'line-width': 0.4, 'line-opacity': 0.35 }, minzoom: 9 });
    });
    guard('指標の適用', apply);
    guard('下図の初期化', () => map.setPaintProperty('aerial', 'raster-opacity', photoOpacity(basemap.value)));
    step('セルのレイヤーを追加しました。タイルの到着待ち…');

    let last = null;
    map.on('mousemove', 'cells', (e) => {
      const p = e.features[0].properties;
      const id = `${p.lv}/${p.code}/${p.bv}/${p.ov}`;
      if (id !== last) { last = id; guard('セルの読み取り', () => show(p, e.lngLat)); }
      map.getCanvas().style.cursor = 'pointer';
    });
    map.on('mouseleave', 'cells', () => { map.getCanvas().style.cursor = ''; });

    try {
      const ext = await (await fetch(EXTENTS, { cache: 'no-store' })).json();
      Object.entries(ext).sort((a, b) => a[0].localeCompare(b[0]))
        .forEach(([c, v]) => jump.add(new Option(`${v.name}（${c}）`, c)));
      jump.onchange = () => {
        const v = ext[jump.value];
        if (v) map.fitBounds(boundsOf(v.bbox), { padding: 60, duration: 900 });
      };
    } catch (err) { fail('市区町村ジャンプの用意に失敗', err); }

    // 本当に描かれたかを地図自身に確かめさせる。idle は来ないことがあるので時間でも見る。
    let reported = false;
    const check = (why) => {
      if (reported) return;
      const q = (f, d) => { try { return f(); } catch (e) { return d; } };
      const drawn = q(() => map.queryRenderedFeatures({ layers: ['cells'] }).length, -1);
      const state = [`契機=${why}`, `z${map.getZoom().toFixed(1)}`,
        `ソース読込済=${q(() => map.isSourceLoaded('cells'), '?')}`,
        `ソース内地物=${q(() => map.querySourceFeatures('cells', { sourceLayer: SRC_LAYER }).length, -1)}`,
        `描画地物=${drawn}`].join(' / ');
      console.log('[doverture] 状態: ' + state);
      if (drawn > 0) {
        reported = true;
        status.textContent = `PMTiles から ${drawn.toLocaleString()} セル描画中`;
        step(`描画 ${drawn.toLocaleString()} 件（画面内）`, 'dvt-ok');
        setTimeout(() => { banner.className = 'dvt-banner dvt-gone'; }, 4000);
      } else if (why !== 'idle') {
        fail('セルが画面に描かれていません', new Error(state));
      }
    };
    map.once('idle', () => check('idle'));
    setTimeout(() => check('3秒'), 3000);
    setTimeout(() => check('10秒'), 10000);
  });

  sel.onchange = () => guard('指標の適用', apply);
  showEmpty.onchange = () => guard('指標の適用', apply);
  basemap.onchange = () => guard('下図の切り替え', () =>
    map.setPaintProperty('aerial', 'raster-opacity', photoOpacity(basemap.value)));

  return {
    map,
    destroy() {
      // 埋め込み先がビューを破棄・再構築する場合、確実に呼ぶ。呼ばないと
      // 作り直すたびに WebGL コンテキストがリークする（cafebabe / sas0）。
      window.removeEventListener('resize', onResize);
      document.removeEventListener('visibilitychange', onResize);
      if (ro) ro.disconnect();
      try { map.remove(); } catch (e) { /* noop */ }
      root.remove();
    }
  };
}
