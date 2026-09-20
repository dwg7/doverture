/*
 * openmct-plugin.js — 北海道 tabular map を Open MCT のツリーに載せるプラグイン。
 *
 * 構成 (dwg7/cafebabe の Open MCT 実地ノウハウに従う):
 *   - objects.addProvider + composition.addProvider + objectViews.addProvider の三点セットだけを使う。
 *   - Telemetry API (request/subscribe) や Display Layout は使わない。
 *     値の取得は各「指標 (source)」の fetchValues() を view の中で直接呼び、setInterval で再描画する。
 *   - ルートは独自 type 'tabularmaps.map' (creatable: false) で、既定の Grid View 等が競合しないようにする。
 *
 * 使い方:
 *   openmct.install(TabularMapsPlugin({
 *     dataUrl: './data/',                     // layout-v08.json, municipalities.json, sapporo-wards.json の置き場
 *     includeNorthernTerritoriesVillages: true,  // 北方領土の6村を含めるか (既定 true。false で179市町村だけ。画面上のボタンでも切替可)
 *     sources: [
 *       { key: 'demo', name: 'デモ指標', refreshMs: 5000,
 *         fetchValues: async () => ({ label: '…', unit: '…', asOf: '…', min: 0, max: 100, values: { '01100': 12.3 } }) },
 *       { key: 'static', name: '静的JSON', valuesUrl: './data/some-series.json' }   // 同じ形の JSON を GET
 *     ]
 *   }));
 *
 * 指標 (series) の形: { label, unit, asOf, min, max, values: { <5桁コード>: number } }
 * 値が無い市町村は「無データ」色になる。ダッシュボードのデータがセルの塗りを自由に使い、
 * 振興局色は無データ時の既定表示にだけ使う (CLAUDE.md「メタデータとフットプリントの分離」)。
 */
window.TabularMapsPlugin = function TabularMapsPlugin(options) {
  'use strict';
  const NAMESPACE = (options && options.namespace) || 'tabularmaps';
  const dataUrl = (options && options.dataUrl) || './data/';
  const sources = (options && options.sources) || [];
  const includeNTV = !(options && options.includeNorthernTerritoriesVillages === false);
  const ROOT_KEY = 'root';
  const REGION_KEY = 'regions';

  let dataPromise = null;
  function loadData() {
    if (!dataPromise) {
      dataPromise = Promise.all([
        fetch(dataUrl + 'layout-v08.json').then((r) => r.json()),
        fetch(dataUrl + 'municipalities.json').then((r) => r.json()),
        fetch(dataUrl + 'sapporo-wards.json').then((r) => r.json())
      ]).then(([layout, municipalities, wards]) => ({ layout, municipalities, wards }));
    }
    return dataPromise;
  }

  return function install(openmct) {
    openmct.types.addType('tabularmaps.map', {
      name: 'tabular map',
      description: '北海道179市町村を16×16に圧縮した表形式地図',
      creatable: false
    });

    const objects = new Map();
    objects.set(ROOT_KEY, { identifier: { namespace: NAMESPACE, key: ROOT_KEY }, name: '北海道 tabular map',
                            type: 'tabularmaps.map', location: 'ROOT', tabularmap: { kind: 'root' } });
    objects.set(REGION_KEY, { identifier: { namespace: NAMESPACE, key: REGION_KEY }, name: '全道図 (振興局)',
                              type: 'tabularmaps.map', tabularmap: { kind: 'regions' } });
    const children = [{ namespace: NAMESPACE, key: REGION_KEY }];
    for (const s of sources) {
      const key = 'source:' + s.key;
      objects.set(key, { identifier: { namespace: NAMESPACE, key }, name: s.name || s.key,
                         type: 'tabularmaps.map', tabularmap: { kind: 'source', source: s.key } });
      children.push({ namespace: NAMESPACE, key });
    }
    const sourceByKey = new Map(sources.map((s) => [s.key, s]));

    openmct.objects.addRoot({ namespace: NAMESPACE, key: ROOT_KEY });
    openmct.objects.addProvider(NAMESPACE, {
      get(identifier) {
        const o = objects.get(identifier.key);
        return o ? Promise.resolve(o) : Promise.reject(new Error('Unknown object ' + identifier.key));
      }
    });
    openmct.composition.addProvider({
      appliesTo(domainObject) {
        return domainObject.identifier.namespace === NAMESPACE && domainObject.identifier.key === ROOT_KEY;
      },
      load() { return Promise.resolve(children); }
    });

    async function fetchSeries(source) {
      if (typeof source.fetchValues === 'function') return source.fetchValues();
      if (source.valuesUrl) return fetch(source.valuesUrl, { cache: 'no-store' }).then((r) => r.json());
      return null;
    }

    openmct.objectViews.addProvider({
      key: 'tabularmaps.view',
      name: 'tabular map',
      canView(domainObject) {
        return domainObject.identifier.namespace === NAMESPACE && domainObject.type === 'tabularmaps.map';
      },
      view(domainObject) {
        let map = null, timer = null, host = null, disposed = false;
        return {
          show(element) {
            host = document.createElement('div');
            host.className = 'tm-openmct-host';
            host.style.height = '100%';
            element.appendChild(host);
            loadData().then((data) => {
              if (disposed) return;
              const kind = domainObject.tabularmap.kind;
              const source = kind === 'source' ? sourceByKey.get(domainObject.tabularmap.source) : null;
              map = window.TabularMap.create(host, {
                layout: data.layout, municipalities: data.municipalities, wards: data.wards,
                mode: 'region', title: domainObject.name, includeNorthernTerritoriesVillages: includeNTV,
                onSelect: (code, cell) => { if (source && source.onSelect) source.onSelect(code, cell); }
              });
              if (kind === 'root') {
                const note = document.createElement('div');
                note.className = 'tm-openmct-note';
                note.textContent = '左のツリーから指標を選ぶと、その値でセルが塗られます。東端の列の6村は北方領土の村で、「北方領土の6村を含めない」で179市町村だけの表示にできます。';
                host.appendChild(note);
              }
              if (source) {
                const tick = () => fetchSeries(source).then((s) => { if (!disposed && s) map.setSeries(s); })
                  .catch(() => { /* 指標側の失敗は前回の表示を残す */ });
                tick();
                if (source.refreshMs) timer = setInterval(tick, source.refreshMs);
              }
            });
          },
          destroy() {
            disposed = true;
            if (timer) clearInterval(timer);
            if (map) map.destroy();
            if (host && host.parentNode) host.parentNode.removeChild(host);
          }
        };
      }
    });
  };
};
