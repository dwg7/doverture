# docs/ — GitHub Pages（main ブランチの `/docs` を静的配信）

Open MCT 4.3.1 を unpkg の CDN から読む**ビルドなし**の静的ページ。
`m3xx-fleet` / `sas0` / `kikimimi` / `tabularmaps/do` と同じ構成。

## 見る

```bash
./scripts/serve.py          # 既定 8779
```

`python3 -m http.server` は使わない——`Cache-Control` を送らないため、ブラウザの
ヒューリスティックキャッシュが古い JS を配信し続け、**ハードリロードでも直らない**
（cafebabe `patterns/local-dev-pitfalls.md`、`kitavolca` が遭遇）。`scripts/serve.py` は
`no-store` を明示する。それでも古いものが出るときは、別ポート（`./scripts/serve.py 8780`）で
キャッシュの名前空間から逃げる。

ポート **8779** は doverture 固定。slate 上では複数セッションが並行するため、
他プロジェクトのサーバーを自分のものと誤認する事故を避ける（`tabularmaps/do` の知見）。

ビルド成果物の**ファイル名にハッシュは使わない**（`assets/app.js` 固定）。GitHub Pages は
CSS/JS を約10分キャッシュするので、ハッシュ名だと古い `index.html` が存在しないファイルを
指して 404 になり、真っ白な画面という硬い壊れ方をする。

## 構成

```
index.html              Open MCT シェル。window.SharedWorker = undefined の回避策込み
doverture-sources.js    tabularmaps のグリッドに載せる指標 (source) 定義
data/municipal.json     scripts/rollup.py がセンサスCSVから生成（集計値のみ）
vendor/do/              tabularmaps/do からの複製（下記）
spatialid/              z14 空間IDパネル（Vite + MapLibre GL JS 6、未着手）
```

## vendor/do — 採択元

[tabularmaps/do](https://github.com/tabularmaps/do) の Open MCT プラグインと描画コアを
複製したもの。**複製元コミット: `2439872`（2026-09-19）**。

複製したファイル: `tabularmap.js` / `openmct-plugin.js` / `style.css` /
`data/{layout-v08,municipalities,sapporo-wards}.json`

複製であって fork ではない。do 側が更新されたら、上記コミットからの差分を見て
取り込むかどうかを判断する。北方領土6村の扱いと表記は do 側の既定
（政府の慣行の言い回しのみを使う）にそのまま従い、doverture 側で独自の判断を持ち込まない。

## 公開するもの・しないもの

公開するのは**セル・市区町村単位の集計値のみ**。そこから元の建物フットプリントは
復元できない。タイル・ジオメトリ・地物単位のテーブルは公開しない
（CLAUDE.md「やらないこと」、DECISIONS.md D5）。

## 出典

- 国土地理院「最適化ベクトルタイル（bvmap）」（原典：数値地図（国土基本情報））
- 国土数値情報 行政区域（N03 2023）／国土交通省。
  測量法に基づく国土地理院長承認（複製）R 4JHf 430
- Overture Maps Foundation / OpenStreetMap contributors（ODbL）
- 東アジア建物フットプリント（doi:10.5281/zenodo.8174931）
- タイル配信：`stars.optgeo.org`（Overture buildings の PMTiles は Taro Matsuzawa 氏による生成）
