#!/usr/bin/env -S uv run --quiet --script
# /// script
# requires-python = ">=3.10"
# dependencies = []
# ///
"""センサスCSV (z14セル単位) を市区町村単位へ畳んで docs/data/municipal.json を書く。

- 札幌の区 (01101-01110) は tabularmaps/do の既定に合わせて 01100 へ合算しつつ、
  区展開ビュー用に区コードのままの行も残す。
- センサスの途中でも走る (cells / cells_total で進捗が分かる)。
"""
import csv, json, math, os, sys
from collections import defaultdict
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CENSUS = os.path.join(ROOT, "data", "hokkaido-z14-census.csv")
CELLS  = os.path.join(ROOT, "data", "hokkaido-z14-cells.json")
OUT    = os.path.join(ROOT, "docs", "data", "municipal.json")

NUM = ["bvmap_n","bvmap_area_m2","bv_3101","bv_3102","bv_3103","bv_3111","bv_3112",
       "ov_n","ov_area_m2","ov_osm","ov_eab","ov_other"]

def y2lat(y, z=14):
    n = math.pi - 2*math.pi*y/(1 << z)
    return math.degrees(math.atan(0.5*(math.exp(n) - math.exp(-n))))

def cell_km2(y, z=14):
    side = 40075016.686*math.cos(math.radians(y2lat(y + 0.5, z)))/(1 << z)
    return side*side/1e6

def blank():
    d = {k: 0 for k in NUM}
    d.update(cells=0, cells_total=0, area_km2=0.0)
    return d

def add(dst, src):
    for k in NUM: dst[k] += src[k]
    dst["cells"] += src["cells"]; dst["cells_total"] += src["cells_total"]
    dst["area_km2"] += src["area_km2"]

total = defaultdict(int)
for x, y, code in json.load(open(CELLS))["cells"]:
    total[code] += 1

acc = defaultdict(blank)
names = json.load(open(CELLS)).get("municipalities", {})
done = 0
with open(CENSUS) as f:
    for r in csv.DictReader(f):
        code = r["code"]; a = acc[code]
        for k in NUM: a[k] += int(r[k])
        a["cells"] += 1
        a["area_km2"] += cell_km2(int(r["y"]))
        done += 1
for code, n in total.items():
    acc[code]["cells_total"] = n

# 札幌: 区を 01100 へ合算 (区の行も残す)
out = {c: dict(v) for c, v in acc.items()}
sap = blank()
for c in list(out):
    if c.startswith("011") and c != "01100":
        add(sap, out[c])
if sap["cells_total"] or sap["cells"]:
    out["01100"] = sap

doc = {
    "asOf": datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds"),
    "cellsDone": done,
    "cellsTotal": sum(total.values()),
    "names": names,
    "municipalities": out,
}
os.makedirs(os.path.dirname(OUT), exist_ok=True)
json.dump(doc, open(OUT, "w"), ensure_ascii=False, separators=(",", ":"))
pct = done/max(sum(total.values()), 1)*100
print(f"{done:,}/{sum(total.values()):,} セル ({pct:.1f}%) -> {OUT}")
k = out.get("01234")
if k: print(f"  北広島市: bvmap {k['bvmap_n']:,} / Overture {k['ov_n']:,} "
            f"({k['cells']}/{k['cells_total']}セル, {k['area_km2']:.0f} km²)")
