/*
 * doverture-sources.js — tabularmaps/do のグリッドに載せる指標 (source) 定義。
 *
 * 値はすべて docs/data/municipal.json （scripts/rollup.py がセンサスCSVから生成）
 * から作る。公開するのは集計値だけで、ジオメトリも地物単位の表も出さない
 * （CLAUDE.md「やらないこと」の線引き）。
 *
 * センサスの途中でも動く。まだ採れていない市区町村は値を持たない（「無データ」色）。
 */
(function () {
  'use strict';

  const DATA_URL = './data/municipal.json';
  let cache = null;
  function load() {
    // キャッシュは持つが、refreshMs で呼ばれるたびに取り直せるよう毎回新しい Promise にする
    cache = fetch(DATA_URL, { cache: 'no-store' }).then((r) => r.json());
    return cache;
  }

  /** 採り終えた市区町村だけを値にする。途中のものは混ぜない（半端な数で色を塗らない）。 */
  function complete(d) {
    const out = {};
    for (const [code, m] of Object.entries(d.municipalities)) {
      if (m.cells_total > 0 && m.cells >= m.cells_total) out[code] = m;
    }
    return out;
  }

  function asOf(d) {
    const pct = ((d.cellsDone / d.cellsTotal) * 100).toFixed(1);
    return d.cellsDone >= d.cellsTotal
      ? `センサス完了（${d.cellsTotal.toLocaleString()}セル） ${d.asOf.slice(0, 10)}`
      : `センサス進行中 ${d.cellsDone.toLocaleString()}/${d.cellsTotal.toLocaleString()}セル（${pct}%）`;
  }

  /** 一つの指標を組み立てる。pick が null を返した市区町村は無データ扱い。 */
  function metric(key, name, label, unit, pick, extra) {
    return Object.assign({
      key: key,
      name: name,
      refreshMs: 120000,
      fetchValues: () => load().then((d) => {
        const ms = complete(d);
        const values = {};
        const notes = {};
        for (const [code, m] of Object.entries(ms)) {
          const v = pick(m);
          if (v === null || v === undefined || !isFinite(v)) continue;
          values[code] = Math.round(v * 100) / 100;
          notes[code] = `${(d.names && d.names[code]) || code}  `
            + `bvmap ${m.bvmap_n.toLocaleString()} 件 / `
            + `Overture ${m.ov_n.toLocaleString()} 件（OSM ${m.ov_osm.toLocaleString()} / `
            + `東アジア学術 ${m.ov_eab.toLocaleString()}）  `
            + `${m.cells} セル・${Math.round(m.area_km2).toLocaleString()} km²`;
        }
        return Object.assign({ label, unit, values, notes, asOf: asOf(d) }, extra || {});
      })
    });
  }

  window.DOVERTURE_SOURCES = [
    metric('ratio', 'Overture / bvmap（件数比）',
      'Overture ÷ bvmap', '倍',
      (m) => (m.bvmap_n > 0 ? m.ov_n / m.bvmap_n : null)),

    metric('bvmap_n', 'bvmap 建物数（国土地理院）',
      'bvmap 建物数', '件', (m) => m.bvmap_n),

    metric('ov_n', 'Overture 建物数',
      'Overture 建物数', '件', (m) => m.ov_n),

    metric('bv_density', 'bvmap 建物密度',
      'bvmap 建物密度', '件/km²',
      (m) => (m.area_km2 > 0 ? m.bvmap_n / m.area_km2 : null)),

    metric('osm_share', 'Overture のうち OSM 由来',
      'OSM 由来の割合', '%',
      (m) => (m.ov_n > 0 ? (m.ov_osm / m.ov_n) * 100 : null),
      { min: 0, max: 100 }),

    metric('eab_share', 'Overture のうち東アジア学術データ由来',
      '東アジア学術データ由来の割合', '%',
      (m) => (m.ov_n > 0 ? (m.ov_eab / m.ov_n) * 100 : null),
      { min: 0, max: 100 }),

    // D9: ov_other は Overture のうち OSM でも東アジア学術データでもないもの。
    // キャッシュ全数の集計ではほぼすべて Microsoft ML Buildings だったが、
    // per-cell の内訳はセンサス完了後のキャッシュ後処理で確定させる。
    metric('other_share', 'Overture のうち OSM・東アジア学術以外（ほぼ Microsoft）',
      'OSM・東アジア学術以外の割合', '%',
      (m) => (m.ov_n > 0 ? (m.ov_other / m.ov_n) * 100 : null),
      { min: 0, max: 100 }),

    metric('bv_size', 'bvmap 建物の平均面積',
      'bvmap 建物の平均面積', 'm²',
      (m) => (m.bvmap_n > 0 ? m.bvmap_area_m2 / m.bvmap_n : null)),

    // センサス進行中だけ意味がある指標。完了後は全市区町村 100% になる。
    Object.assign(metric('progress', 'センサス進捗', '採取済みセルの割合', '%',
      (m) => null, { min: 0, max: 100 }), {
      refreshMs: 30000,
      fetchValues: () => load().then((d) => {
        const values = {};
        for (const [code, m] of Object.entries(d.municipalities)) {
          if (m.cells_total > 0) values[code] = Math.round((m.cells / m.cells_total) * 1000) / 10;
        }
        return { label: '採取済みセルの割合', unit: '%', min: 0, max: 100, values, asOf: asOf(d) };
      })
    })
  ];
})();
