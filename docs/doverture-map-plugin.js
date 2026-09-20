/*
 * doverture 空間IDマップを Open MCT のビューとして載せるプラグイン。
 *
 * このページ自体はビルドを持たない（Open MCT を CDN から読む静的構成）。
 * 一方パネルは MapLibre GL JS v6 を使うので ES モジュールでしか配れない。
 * そこで **ビューを開いたときに動的 import する** —— ホスト側にバンドラは要らず、
 * 重い 1MB のバンドルもツリーでこのビューを選ぶまで読み込まれない。
 *
 * iframe は使わない。sandbox 属性まわりの問題に繰り返し遭遇するため、
 * ネイティブ埋め込みにする（cafebabe patterns/maplibre-gl-js-embedding.md、sas0 の実例）。
 * ビュー破棄時に panel.destroy() を必ず呼ぶ（WebGL コンテキストのリーク防止、同）。
 */
window.DovertureMapPlugin = function DovertureMapPlugin(options) {
  'use strict';
  const NAMESPACE = (options && options.namespace) || 'doverture';
  const MODULE = (options && options.module) || './spatialid/assets/doverture-panel.js';
  const ROOT_KEY = 'root';
  const MAP_KEY = 'z14map';

  return function install(openmct) {
    openmct.types.addType('doverture.map', {
      name: 'doverture 空間IDマップ',
      description: '北海道の z14 空間IDセルごとの建物件数を、データソース別に塗り分ける地図',
      creatable: false,
      cssClass: 'icon-map'
    });

    const objects = new Map([
      [ROOT_KEY, { identifier: { namespace: NAMESPACE, key: ROOT_KEY },
                   name: 'doverture 空間IDマップ', type: 'doverture.map', location: 'ROOT' }],
      [MAP_KEY, { identifier: { namespace: NAMESPACE, key: MAP_KEY },
                  name: 'z14 セル地図（bvmap / Overture）', type: 'doverture.map' }]
    ]);

    openmct.objects.addRoot({ namespace: NAMESPACE, key: ROOT_KEY });
    openmct.objects.addProvider(NAMESPACE, {
      get(identifier) {
        const o = objects.get(identifier.key);
        return o ? Promise.resolve(o) : Promise.reject(new Error('Unknown object ' + identifier.key));
      }
    });
    openmct.composition.addProvider({
      appliesTo(o) { return o.identifier.namespace === NAMESPACE && o.identifier.key === ROOT_KEY; },
      load() { return Promise.resolve([{ namespace: NAMESPACE, key: MAP_KEY }]); }
    });

    openmct.objectViews.addProvider({
      key: 'doverture.mapview',
      name: '空間IDマップ',
      cssClass: 'icon-map',
      canView(o) { return o.identifier.namespace === NAMESPACE && o.identifier.key === MAP_KEY; },
      view() {
        let panel = null, host = null, disposed = false;
        return {
          show(element) {
            host = document.createElement('div');
            host.style.cssText = 'position:absolute;inset:0;';
            element.style.position = element.style.position || 'relative';
            element.appendChild(host);
            import(MODULE).then((m) => {
              if (disposed) return;
              panel = m.mount(host);
            }).catch((err) => {
              console.error('[doverture] 空間IDマップの読み込みに失敗:', err);
              host.innerHTML = '<div style="padding:16px;color:#f2a3a3;font:13px system-ui">'
                + '空間IDマップを読み込めませんでした：' + (err && err.message ? err.message : err)
                + '<br><a style="color:#86b6ef" href="./spatialid/">単体ページで開く</a></div>';
            });
          },
          destroy() {
            disposed = true;
            if (panel) { panel.destroy(); panel = null; }
            if (host) { host.remove(); host = null; }
          }
        };
      }
    });
  };
};
