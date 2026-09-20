#!/bin/bash
# z14 セルから PMTiles を作る。
#
#   scripts/build_cells.py -> build/cells.geojsonl   (z14 セル 27,947 件)
#   tippecanoe 1回          -> build/doverture-cells.mbtiles  (z4–z12、全ズームで z14 セル)
#   pmtiles convert         -> docs/data/doverture-cells.pmtiles
#
# **どのズームのタイルにも z14 セルをそのまま入れる**（D29）。ズームで集計単位が
# 変わらないので、模様の違いが常にデータの違いを指す。そのぶん低ズームのタイルは
# 重くなるが、実測で最大 309 KB（z4、27,947 セル全部入り）で済んでいる。
#
# 間引きは全部止める（-pf -pk -pt -r1）。z14 セルは低ズームでサブピクセルになり、
# 既定のままだと消える。これは D2 で bvmap について発見したのと同じ罠で、
# 自分のデータで踏まないために明示する。
#
# かつてはレベル別に9回焼いて tile-join で束ねていたが、セルのレベルが一定に
# なった今は1回で足りる。tile-join を外したことで、metadata を sqlite3 で
# 書き直す回避策（マキシズーム不一致で metadata が空になる）も不要になった。
set -euo pipefail
cd "$(dirname "$0")/.."

MINZ=4; MAXZ=12
SRC=build/cells.geojsonl
MB=build/doverture-cells.mbtiles
OUT=docs/data/doverture-cells.pmtiles
NAME="doverture spatial-ID cells (Hokkaido)"
DESC="Building counts per spatial-ID (ZFXY) cell across Hokkaido, from GSI bvmap and Overture. Every zoom carries the same z14 cells, so the unit of aggregation never changes with zoom. Display beyond z12 by overzoom."
ATTR='国土地理院 最適化ベクトルタイル(bvmap) | Overture Maps / OpenStreetMap contributors (ODbL) | 国土数値情報 N03（測量法に基づく国土地理院長承認（複製）R 4JHf 430）'

./scripts/build_cells.py

tippecanoe -q -f -o "$MB" -l cells \
  -Z "$MINZ" -z "$MAXZ" -pf -pk -pt -r1 \
  --name="$NAME" --description="$DESC" --attribution="$ATTR" \
  "$SRC"

rm -f "$OUT"
pmtiles convert "$MB" "$OUT" >/dev/null 2>&1
echo
echo "$OUT  $(du -h "$OUT" | cut -f1)"
sqlite3 "$MB" "select zoom_level, count(*) || ' タイル', max(length(tile_data)) || ' B/最大' from tiles group by zoom_level order by zoom_level;"
