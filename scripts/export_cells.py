#!/usr/bin/env -S uv run --quiet --script
# /// script
# requires-python = ">=3.10"
# dependencies = []
# ///
"""センサスCSVを MapLibre パネル用のコンパクトなJSONへ書き出す。

公開するのは件数と面積の集計値だけ。ジオメトリは出さない——セルの矩形は
(14, x, y) から受け手が組み立てる（CLAUDE.md「やらないこと」の線引き）。
"""
import csv, json, os
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CENSUS = os.path.join(ROOT, "data", "hokkaido-z14-census.csv")
OUT = os.path.join(ROOT, "docs", "data", "cells.json")
CELLS = os.path.join(ROOT, "data", "hokkaido-z14-cells.json")

names = json.load(open(CELLS)).get("municipalities", {})
rows = []
with open(CENSUS) as f:
    for r in csv.DictReader(f):
        rows.append([int(r["x"]), int(r["y"]), r["code"],
                     int(r["bvmap_n"]), int(r["ov_n"]),
                     int(r["ov_osm"]), int(r["ov_eab"]), int(r["ov_other"]),
                     int(r["bvmap_area_m2"]), int(r["ov_area_m2"])])
rows.sort()
doc = {
    "z": 14,
    "asOf": datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds"),
    "cols": ["x", "y", "code", "bv", "ov", "osm", "eab", "oth", "bvArea", "ovArea"],
    "names": names,
    "rows": rows,
}
os.makedirs(os.path.dirname(OUT), exist_ok=True)
json.dump(doc, open(OUT, "w"), ensure_ascii=False, separators=(",", ":"))
print(f"{len(rows):,} セル -> {OUT} ({os.path.getsize(OUT)/1e6:.1f} MB)")
