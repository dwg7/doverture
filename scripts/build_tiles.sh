#!/bin/bash
# 空間IDのピラミッドから PMTiles を作る。
#
#   scripts/build_pyramid.py  -> build/pyramid/z{4..12}.geojsonl
#   tippecanoe (レベルごと)   -> build/tiles/z{4..12}.mbtiles
#   tile-join                 -> build/tiles/doverture-cells.mbtiles
#   メタデータを明示的に書く  <- tile-join はマキシズーム不一致で metadata を空にする
#   pmtiles convert           -> docs/data/doverture-cells.pmtiles
#
# tippecanoe の間引きは全部止める（-pf -pk -pt -r1）。z14 セルは低ズームで
# サブピクセルになるので、既定のままだと消える。これは D2 で bvmap について
# 発見したのと同じ罠で、自分のデータで踏まないために明示する。
set -euo pipefail
cd "$(dirname "$0")/.."

MINZ=4; MAXZ=12
B=build/pyramid; O=build/tiles
OUT=docs/data/doverture-cells.pmtiles
NAME="doverture spatial-ID cells (Hokkaido)"
ATTR='国土地理院 最適化ベクトルタイル(bvmap) | Overture Maps / OpenStreetMap contributors (ODbL) | 国土数値情報 N03（測量法に基づく国土地理院長承認（複製）R 4JHf 430）'

./scripts/build_pyramid.py
mkdir -p "$O"; rm -f "$O"/*.mbtiles

for tz in $(seq $MINZ $MAXZ); do
  tippecanoe -q -f -o "$O/z$tz.mbtiles" -l cells -n "doverture cells" \
    -Z "$tz" -z "$tz" -pf -pk -pt -r1 "$B/z$tz.geojsonl"
done

tile-join -q -f -o "$O/doverture-cells.mbtiles" "$O"/z[0-9]*.mbtiles 2>/dev/null

# tile-join が metadata を空にするので自分で書く（0行のまま出すと PMTiles の
# tileType が Unknown になり、bounds も全世界になる）
BOUNDS=$(sqlite3 "$O/z$MAXZ.mbtiles" "select value from metadata where name='bounds';")
JSON=$(sqlite3 "$O/z$MAXZ.mbtiles" "select value from metadata where name='json';" \
       | sed "s/\"minzoom\":[0-9]*/\"minzoom\":$MINZ/g; s/\"maxzoom\":[0-9]*/\"maxzoom\":$MAXZ/g")
CENTER=$(python3 -c "
b='$BOUNDS'.split(',')
print(f'{(float(b[0])+float(b[2]))/2:.6f},{(float(b[1])+float(b[3]))/2:.6f},7')")

sqlite3 "$O/doverture-cells.mbtiles" <<SQL
delete from metadata;
insert into metadata (name, value) values
  ('name', '$NAME'),
  ('description', 'Building counts per spatial-ID (ZFXY) cell across Hokkaido, from GSI bvmap and Overture. Tile z12 carries z14 cells; lower zooms carry integer-aggregated coarser cells. Display beyond z12 by overzoom.'),
  ('attribution', '$ATTR'),
  ('format', 'pbf'),
  ('type', 'overlay'),
  ('version', '1'),
  ('minzoom', '$MINZ'),
  ('maxzoom', '$MAXZ'),
  ('bounds', '$BOUNDS'),
  ('center', '$CENTER'),
  ('json', '$JSON');
SQL

rm -f "$OUT"
pmtiles convert "$O/doverture-cells.mbtiles" "$OUT" >/dev/null 2>&1
echo
echo "$OUT  $(du -h "$OUT" | cut -f1)"
sqlite3 "$O/doverture-cells.mbtiles" "select name, substr(value,1,60) from metadata order by name;"
