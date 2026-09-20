/* ブラウザ無しで走る検証。実際に配る PMTiles と補助データを確かめる。 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PMTiles, FetchSource } from 'pmtiles';
import { boundsOf, zoomHint, METRICS, DIVERGING, FOOTPRINT, CELL_OPACITY, x2lon, y2lat }
  from '../src/data.js';

const DOCS = new URL('../../docs/', import.meta.url);
let n = 0;
const t = (name, fn) => { fn(); n++; console.log('  ok  ' + name); };
const ta = async (name, fn) => { await fn(); n++; console.log('  ok  ' + name); };

/** ローカルファイルを Range で読む最小の PMTiles ソース。 */
class FileSource {
  constructor(path) { this.path = path; this.fd = fs.openSync(path, 'r'); }
  getKey() { return this.path; }
  async getBytes(offset, length) {
    const buf = Buffer.alloc(length);
    fs.readSync(this.fd, buf, 0, length, offset);
    return { data: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) };
  }
}

const pmPath = new URL('data/doverture-cells.pmtiles', DOCS);
const pm = new PMTiles(new FileSource(pmPath.pathname));

await ta('PMTiles のヘッダが想定どおり', async () => {
  const h = await pm.getHeader();
  assert.equal(h.minZoom, 4, 'minzoom');
  assert.equal(h.maxZoom, 12, 'maxzoom は 12（以降は overzoom）');
  assert.ok(h.tileType === 1, 'ベクタタイル(MVT)');
  assert.ok(h.numAddressedTiles > 3000, `タイル数 ${h.numAddressedTiles}`);
  assert.ok(h.maxLat > 45 && h.minLat < 42, '北海道の緯度範囲を覆う');
  assert.ok(h.minLon < 140 && h.maxLon > 148, '北海道＋北方領土の経度範囲を覆う');
});

await ta('メタデータに cells レイヤーと必要な属性がある', async () => {
  const m = await pm.getMetadata();
  const layers = (m.vector_layers || []).map((l) => l.id);
  assert.ok(layers.includes('cells'), `レイヤー: ${layers.join(',')}`);
  const f = m.vector_layers.find((l) => l.id === 'cells').fields;
  for (const need of ['bv', 'ov', 'osm', 'eab', 'oth', 'code', 'lv', 'cells']) {
    assert.ok(need in f, `属性 ${need} が無い`);
  }
});

await ta('タイルが実際に取り出せる（札幌・各ズーム）', async () => {
  const tile = (lon, lat, z) => {
    const r = (lat * Math.PI) / 180;
    return [z, Math.floor(((lon + 180) / 360) * (1 << z)),
            Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * (1 << z))];
  };
  for (const z of [4, 8, 10, 12]) {
    const [zz, x, y] = tile(141.35, 43.06, z);
    const t2 = await pm.getZxy(zz, x, y);
    assert.ok(t2 && t2.data.byteLength > 0, `z${z} のタイルが空`);
  }
});

t('市区町村の外接範囲が使える形', () => {
  const ext = JSON.parse(fs.readFileSync(new URL('data/municipal-extents.json', DOCS), 'utf8'));
  assert.ok(Object.keys(ext).length >= 190, `件数 ${Object.keys(ext).length}`);
  for (const [code, v] of Object.entries(ext)) {
    assert.match(code, /^\d{5}$/, `コード ${code}`);
    assert.ok(v.name && v.name.length > 0, `${code} に名前が無い`);
    const [[w, s], [e, nn]] = boundsOf(v.bbox);
    assert.ok(e > w && nn > s, `${code} の範囲が潰れている`);
    assert.ok(w > 139 && e < 149.5 && s > 41 && nn < 46, `${code} が北海道の外`);
  }
});

t('zoomHint がセルのレベルとpxを返す', () => {
  assert.equal(zoomHint(6).level, 8, 'z6 では z8 セル');
  assert.equal(zoomHint(10).level, 12);
  assert.equal(zoomHint(12).level, 14, 'z12 以降は z14 で頭打ち');
  assert.equal(zoomHint(16).level, 14);
  assert.equal(zoomHint(15).what, '写真で実物を確認');
});

t('発散尺度の閾値が昇順で、色が7つ', () => {
  assert.equal(DIVERGING.length, 7);
  for (let i = 1; i < DIVERGING.length; i++) assert.ok(DIVERGING[i][0] > DIVERGING[i - 1][0]);
});

t('建物輪郭の設定が、写真の上で読める条件を満たす', () => {
  // bvmap の BldA は z16 以外では間引かれている（D2）。間引かれた bvmap と完全な
  // Overture を並べて見せないために、輪郭は z16 未満で出してはいけない。
  assert.ok(FOOTPRINT.minzoom >= 16,
            `輪郭の minzoom が ${FOOTPRINT.minzoom}：z16 未満では bvmap が間引かれている`);
  const a = FOOTPRINT.bvmap.color, b = FOOTPRINT.overture.color;
  assert.notEqual(a, b);
  // 色だけに頼らない（二重符号化）。Overture は破線。
  assert.ok(Array.isArray(FOOTPRINT.overture.dash) && FOOTPRINT.overture.dash.length === 2,
            'Overture に破線指定が無い（色だけの区別になる）');
  assert.ok(!FOOTPRINT.bvmap.dash, 'bvmap は実線のままであるべき');
  // 高ズームではセルが薄くなり、輪郭が主役になること
  const st = CELL_OPACITY.slice(3);
  const last = st[st.length - 1];
  assert.ok(last <= 0.20, `最高ズームのセル不透明度 ${last} では輪郭が埋もれる`);
});

t('タイル座標の往復が合う', () => {
  assert.ok(Math.abs(x2lon(0) + 180) < 1e-9);
  assert.ok(Math.abs(y2lat(0) - 85.0511) < 0.01);
});

console.log(`\n${n} 件すべて通過（配る PMTiles そのものを検証）`);
