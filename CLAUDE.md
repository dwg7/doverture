# CLAUDE.md

**Repository:** `dwg7/doverture`
**Title:** Hokkaido Overture — 北海道で建物フットプリントを各データソースで突き合わせる探索的conflation研究
**Description:** 複数の建物フットプリントデータソース（Overture統合データ／OSM単体／AI生成データ単体）を、国土地理院の最適化ベクトルタイル（bvmap）が配信する建物データと突き合わせ、北海道の様々な土地利用・居住形態に、各データ取得アプローチがどう向き合えているかを、空間ID／市区町村単位の統計として記述する。両側のデータとも`stars.optgeo.org`のクラウドネイティブなタイルエンドポイントから取得し、ダウンロード・ETLの手間を最小化する。

## このプロジェクトの立ち位置

北海道は、都市部・農村部・山間部・別荘地・過疎集落など多様な土地利用形態を持ち、かつ公共測量の実施状況にも地域差がある。Overtureに参加する各イニシアティブ（政府系の測量、OSMのようなcrowd-sourced活動、衛星画像からのAI検出）は、それぞれ異なるやり方でこの土地の居住の実態を捉えようとしている。

dovertureは、どのアプローチが「正しい」かを判定する審査員ではない。**同じ山頂（北海道の実際の居住の姿）を、異なるルートで目指す登山競争・克服スポーツを、爽やかに観察する**、というのがこのプロジェクトの立ち位置。国土地理院の建物データ（後述、実際には`bvmap`経由で取得）を各アプローチの捉え方を横並びで見るための固定参照点として使うが、それを「正解」と位置づけるためではなく、単に独立した測量に基づく一つの参照コーパスとして扱いやすいから。

最終的に知りたいのは、データソースの優劣ではなく**地域の居住の本質**——北海道のどこに、どのような形で人が住んでいるか、それに地図はどのように対応できているか、あるいは対応できていないか、という実態そのもの。各アプローチの得意・不得意のパターン（例えば特定の土地利用形態でどのアプローチも足並みが揃わない、といった現象）自体が、その実態を照らし出す手がかりになる、という期待がある。

これは訴求ツールでも本番プロダクトでもなく、**探索的なデータ分析の実践例**として位置づける。「雲が多い地域はAI生成データが取りこぼすのでは」といった、当初の仮説になかった問いが分析の途中で出てくること自体を歓迎する設計にする。

## 用語について：FGD と bvmap

**FGD（基盤地図情報）**は測量法上「基本測量成果」と位置づけられた正式なデータ（JPGIS/GML、`fgd.gsi.go.jp`で配布）。**bvmap（最適化ベクトルタイル）**は国土地理院が別途試験公開しているベクトルタイルで、データソースは公式には「数値地図（国土基本情報）－地図情報 等」とされ、**GSI自身が「基本測量成果と位置付けているものではない」と明言している**、FGDとは別物。

このプロジェクトは実装上、`stars.optgeo.org/bvmap`（後述）を通じてbvmapを使う。以降このドキュメントで「GSI建物データ」「bvmap」と書く場合は、正式なFGDそのものではなくこのbvmap経由のデータを指す。両者の法的位置づけの違い（測量法上の扱い・利用規約）は要再確認（後述）。

この点、クラウドネイティブ地理空間情報の消費の実践経験を積むことができる。

## リサーチクエスチョン

**主軸**：複数の建物データソースは、それぞれ北海道の実際の居住の姿をどう捉えているか。捉え方の違いそのものを記述する。

1. **Overture（統合後）vs GSI建物データ（bvmap）** — OSM・Microsoft・Google等が合成された後の最終成果物が、bvmapが記録している建物とどう対応するか
2. **OSM単体 vs GSI建物データ** — crowd-sourced活動がどこまで捉えられているか（Overtureの`sources`フィールドでOSM由来のみに絞る、あるいは独立にOSM生データを取得するかは要検討、後述）
3. **AI生成データ単体 vs GSI建物データ**（Microsoft ML Buildings / Google Open Buildings 等） — 衛星・航空写真からの自動検出がどこまで捉えられているか

**派生する具体的な仮説（ユーザー発案）**：
- 雲量が多い地域では、AI生成データの検出漏れが増えるのではないか（撮影に使われた衛星画像の雲被覆率と、AI生成データの検出率の相関）
- 他にも、都市化の度合い・建物密度・地形（山間部か平野部か）など、捉え方の違いを説明しうる変数はまだ未整理。仮説は分析の過程で追加してよい

**分析の単位（重要な方針転換）**：個々の建物の外周線を目視・幾何的に精密比較することが目的ではない。**空間ID（後述）あるいは市区町村ごとの統計**（各データソースの建物件数・密度）を比較することが探索の狙い。建物単位のマッチングは、集計結果に現れた興味深い区画を後から掘り下げるための補助手段という位置づけに留める。

## 手法

### 主手法：空間ビニングによる集計統計（クラウドネイティブ）

個々の建物ポリゴンをマッチングするのではなく、**各データソースの建物を空間セルに集計し、セルごとの件数・密度をデータソース間で比較する**。

- **セルの単位**：**空間ID**（デジタル庁が主導する3次元空間ID仕様、ZFXY形式——Web Mercatorタイルのズームレベル(Z)・水平インデックス(X,Y)に、鉛直方向インデックス(F)を加えたもの）を第一候補とする。座標を機械的に量子化するだけで済み、外部の行政界データへの依存がゼロになる点がクラウドネイティブ志向に合う。可視化用に市区町村単位のロールアップが必要な場合は、空間IDセルの集計結果を、別途取得した市区町村コード付きの行政界データ（国土数値情報N03、e-Statの境界データ、Overtureの`divisions`テーマ等）でさらに集約する2段構えにする（**bvmapのAdmAreaレイヤーには市区町村コード・名称が入っていないため、これ単体では市区町村の特定ができない**——`vt_code`という地物種別コードのみ。要再検証だが、実装前提を誤らないよう明記）
- **各データソースからの取得**：`stars.optgeo.org`上のタイル（`bvmap`・`overture_buildings`）をDuckDBの`ST_Read`/spatial拡張等で直接クエリし、セルごとのカウントに集計する。ダウンロード・ローカルETLは最小限で済むはず

### 副次手法：建物単位のマッチング（Overtureの公式手法を流用、任意）

集計統計だけでは説明できない、興味深い区画（例えば特定のデータソースだけ極端に少ない空間IDセル）を後から掘り下げる際に使う。ゼロから自前のIoUマッチャーを書く必要はなく、Overture自身がOSSとして公開している名寄せ手法をそのまま踏襲できる。

**参照元**：[OvertureMaps/workshop](https://github.com/OvertureMaps/workshop)（Overture Maps Foundation公式）
- `7-buildings-matching.md` + `notebooks/4-buildings-matching.ipynb`：外部の測量ベースの建物データ（NGA制作のMGCP、バハマの1タイル）とOverture buildingsを突き合わせる実例
- `8-matching-concepts.md`：一般化された名寄せ・カーディナリティ分類の方法論

**アルゴリズム**（`notebooks/4-buildings-matching.ipynb`のコードを実際に読んで確認済み）：
1. 両データを適切な地図投影（メートル単位）へ再投影
2. `geopandas.sjoin(predicate="intersects")`で候補ペアを空間結合
3. IoU（intersection area / union area）と、比較先データ側ポリゴンの重心がGSI側ポリゴンに含まれるか（方向性あり）を計算
4. 二段階閾値でマッチ判定：`IoU >= 0.5`（highティア）、または`IoU >= 0.3 かつ 重心包含`（lowティア、集約・分割ケースを拾う）
5. マッチ結果を **1:1（クリーン一致）／1:many・many:1（集約・分割）／1:0（GSI側のみ）／0:1（比較先データのみ）** の5分類でカーディナリティ報告

**Overture自身が明言している限界**：この手法は「バハマの疎な1:100,000スケールの1タイル」でしか検証されていない。

**技術スタック**：Python / `duckdb`（`stars.optgeo.org`のタイルを直接クエリ、空間集計） / `geopandas` / `shapely`（副次手法で使用）/ `pyarrow`。特殊な独自ツールは不要。

## データソース

両側とも `stars.optgeo.org` 経由で取得する（実在・スキーマとも本セッションで実測確認済み）。

- **GSI建物データ（bvmap経由）**：`https://stars.optgeo.org/bvmap` — TileJSONを実際に取得し、レイヤー定義を確認済み：
  - `BldA`（建築物）：フィールドは`vt_code`（Number）・`vt_lvorder`（Number）のみ、**minzoom14〜maxzoom16**（z17はz16タイルのオーバーズーム表示で別データではない）
  - `AdmArea`（行政区画）：フィールドは`vt_code`（Number）のみ、**minzoom4〜maxzoom16**（低ズームから存在、ただし**市区町村コード・名称は含まれず地物種別コードのみ**——単体では「どの市区町村か」は特定できない）
  - 元データは国土地理院が「数値地図（国土基本情報）－地図情報 等」と呼ぶもので、「基本測量成果」とは位置づけられていない（前述「用語について」参照）。「国土地理院コンテンツ利用規約」に従う。検証中のデータのためスキーマ・URLが変わりうる点に注意
- **Overture buildings テーマ（taroverture経由）**：`https://stars.optgeo.org/overture_buildings` — Taro Matsuzawa（smellman）氏が生成・公開しているPMTilesを`stars.optgeo.org`がプロキシしたもの（実在確認済み、z0で204レスポンス）。`sources`フィールドに各地物を構成した入力データセット（provider情報）が記録されている
- **OSM単体**：Overtureの`sources`フィールドでOSM由来のみをフィルタする方法と、OSMの生データ（Overpass API等）を独立に取得する方法の2通りが考えられる。前者は「Overtureの名寄せを経由したOSM」、後者は「素のOSM」で、意味が異なる。**どちらを採用するかは未決定**
- **AI生成データ単体**：Microsoft ML Buildings / Google Open Buildings 等。Overtureの`sources`のprovider情報から抽出する想定だが、Overtureに合成される前の生データセットに直接当たれるかは要調査
- **市区町村コード付き行政界データ（ロールアップ用、未選定）**：候補は国土数値情報N03、e-Statの境界データ、Overtureの`divisions`テーマ

## スコープ

- **技術検証パイロット**：東広島市（1自治体で手法を通し、bvmap側のデータ鮮度・空間ビニングの妥当性を確認。副次手法＝建物単位マッチングを試す場合はCRS変換等もここで検証）
- **本目的の対象地域**：北海道（ユーザーの土地勘がある地域）。空間IDセルごとに集計し、必要に応じて市区町村（179）単位までロールアップして件数・比率を集計
- **可視化**：`tabularmaps/do`（北海道向けの既存可視化ツール、詳細未調査。入力フォーマットの制約は要確認）

パイロット地域と本対象地域が異なる点は意図的。まず東広島市で手法を固めてから北海道全域に展開する。

## 運用上の一般的な指針

- `DECISIONS.md`（判断の経緯を追記していく）・`HANDOVER.md`（現在地のスナップショット）を使い分けて運用する
- 外部リンクは、コード・文書に載せる前に必ずfetchして実在・内容を確認する
- 複数プロジェクト横断の技術知見は`dwg7/cafebabe`にある。この分析手法自体も、汎用性があればcafebabeへの還元を検討する
- ピアセッションからの技術的な事実主張は自分の一次情報で裏を取る（グローバルCLAUDE.mdの方針）

## 引用・謝辞（必須）

- **国土地理院（GSI）**：bvmap（最適化ベクトルタイル）の提供元。https://www.gsi.go.jp/ 。利用時は「国土地理院最適化ベクトルタイル」等、出典を明示する（GSIの利用規約が定める要件）
- **Taro Matsuzawa（smellman）氏**：Overture buildingsのPMTiles生成・公開。`stars.optgeo.org/overture_buildings`はこれをプロキシしたもの
- **stars.optgeo.org運用チーム**：両データソースへのクラウドネイティブなアクセスを提供するインフラ
- **Overture Maps Foundation**：https://overturemaps.org/ — 副次手法として`OvertureMaps/workshop`の名寄せ手法（IoU閾値・カーディナリティ分類）を使う場合は、出典として明記すること

## やらないこと（非目標）

- bvmapのデータそのもの・その単純な複製物を公開・再配布しない（集計統計・可視化のみを公開）
- 政治的・行政的な分析や提言はしない（あくまで技術的なデータ特性の記述に徹する）
- OSM/Overtureへのデータ書き戻し・編集提案は、現時点ではスコープ外（将来的に「GSI建物データのみに存在する建物」をOSM編集の手がかりとして使う発展はあり得るが、それは別フェーズ）

## 未解決の設計判断（要決定）

- 空間ID（ZFXY）の生成・集計に使う具体的なライブラリ／実装（DuckDBのSQLで完結させられるか、専用ライブラリが要るか）
- 市区町村ロールアップに使う行政界データソースの選定（国土数値情報N03 / e-Stat境界データ / Overture `divisions`のいずれか）
- OSM単体データの取得方法（Overtureの`sources`フィルタ vs 独立取得）
- AI生成データ単体（Microsoft ML Buildings等）に、Overture経由でなく直接アクセスできるか
- bvmapとFGD（基盤地図情報）の法的位置づけの違い（測量法上の扱い、利用規約）の再確認——bvmapは「基本測量成果」と位置づけられていない点に留意
- bvmapのデータ鮮度（本セッション確認時点で「2026年7月1日時点」に更新済み、更新頻度は概ね四半期ごと）を、分析結果の解釈にどう反映するか
- `tabularmaps/do`への具体的な入力フォーマット
- 雲量データの入手方法（AI生成データの検出漏れとの相関を見るなら、衛星画像の雲被覆率データが別途必要）
- 写真画像が必要ある場合に、https://stars.optgeo.org/kitaphoto17 をどのように活用するか
- 処理を行う場合の座標系。タイル内座標系で十分か。パフォーマンスの観点からタイル内座標系（整数値）で揃えられれるかは重要な判断事項。

## 参考リンク

- bvmap（最適化ベクトルタイル）：
  - タイルエンドポイント（stars.optgeo.org経由）：https://stars.optgeo.org/bvmap
  - GSI公式リポジトリ：https://github.com/gsi-cyberjapan/optimal_bvmap
  - GSIベクトルタイル提供実験について：https://www.gsi.go.jp/johofukyu/johofukyu40039.html
- taroverture（Overture buildings PMTiles）：https://stars.optgeo.org/overture_buildings
- 空間ID（デジタル庁、ZFXY仕様）：https://github.com/Project-PLATEAU/PLATEAU-generator-for-spatialid
- 副次手法（建物単位マッチング）の参照元：https://github.com/OvertureMaps/workshop
  - https://github.com/OvertureMaps/workshop/blob/main/7-buildings-matching.md
  - https://github.com/OvertureMaps/workshop/blob/main/8-matching-concepts.md
  - https://github.com/OvertureMaps/workshop/blob/main/notebooks/4-buildings-matching.ipynb
- Overture公式Python CLI：https://github.com/OvertureMaps/overturemaps-py
- GERSとは：https://docs.overturemaps.org/gers/
- GERSの一般向け解説：https://overturemaps.org/blog/2025/understanding-overtures-global-entity-reference-system/
- 基盤地図情報（FGD、参考・比較用）：https://fgd.gsi.go.jp/download/
- 横断知見集約リポジトリ：https://github.com/dwg7/cafebabe
