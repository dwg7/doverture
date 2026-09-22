#!/usr/bin/env -S uv run --quiet --script
# /// script
# requires-python = ">=3.10"
# dependencies = ["mapbox-vector-tile"]
# ///
"""建物データに、誰がどれだけの手間（お金・時間）をかけたかの痕跡を、手元のデータだけで測る。

追加のデータは取りに行かない。キャッシュ済みの taroverture（Overture buildings）z14 タイルに、
OSM 由来の地物ごとに次の痕跡が入っている：

- `sources[].record_id` = "w326850520@1" —— **@ の後ろが OSM の版数**。@1 は描かれたきり
  一度も直されていない。版数は「その建物に人が戻ってきた回数」
- `sources[].update_time` —— 最後に触られた時刻（@1 なら描かれた時刻）
- `class` / `subtype` / `names` / `num_floors` / `height` —— 形の他に**誰かがわざわざ足した属性**

これに bvmap の取得精度（公的なお金がかかった範囲、D30）と、Microsoft など非OSM分
（人の手がかかっていない範囲）を並べると、三者——公費・ボランティアの時間・自動化——
の分担がセル単位で見える。

出力：build/effort.json（セル単位、ジオメトリは含まない）。集計の表示は explain 側でなく
ここでまとめて出す。
"""
import json, math, os, sys
from collections import Counter
from multiprocessing import Pool
import mapbox_vector_tile as mvt

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = "/Volumes/Migrate-2025-04/doverture-tilecache/overture_buildings/14"
OUT = os.path.join(ROOT, "build", "effort.json")
Z = 14

def y2lat(y):
    n = math.pi - 2 * math.pi * y / (1 << Z)
    return math.degrees(math.atan(0.5 * (math.exp(n) - math.exp(-n))))

def ring_area(r):
    a = 0.0
    for i in range(len(r)):
        x0, y0 = r[i][0], r[i][1]; x1, y1 = r[(i + 1) % len(r)][0], r[(i + 1) % len(r)][1]
        a += x0 * y1 - x1 * y0
    return abs(a) / 2

def centroid(r):
    a = cx = cy = 0.0; n = len(r)
    for i in range(n):
        x0, y0 = r[i][0], r[i][1]; x1, y1 = r[(i + 1) % n][0], r[(i + 1) % n][1]
        k = x0 * y1 - x1 * y0; a += k; cx += (x0 + x1) * k; cy += (y0 + y1) * k
    if a == 0: return sum(p[0] for p in r) / n, sum(p[1] for p in r) / n
    return cx / (3 * a), cy / (3 * a)

def polys(g):
    if g["type"] == "Polygon": return [g["coordinates"]]
    if g["type"] == "MultiPolygon": return g["coordinates"]
    return []

def one(args):
    x, y = args
    p = f"{CACHE}/{x}/{y}.mvt"
    rec = {"x": x, "y": y, "osm_n": 0, "osm_A": 0.0, "ms_n": 0, "ms_A": 0.0,
           "eab_n": 0, "eab_A": 0.0, "ver": {}, "year": {}, "cls": 0, "name": 0, "floors": 0}
    if not os.path.exists(p) or os.path.getsize(p) == 0: return rec
    try: d = mvt.decode(open(p, "rb").read())
    except Exception: return rec
    L = d.get("building")
    if not L: return rec
    e = L["extent"]
    mpu = 40075016.686 * math.cos(math.radians(y2lat(y + 0.5))) / (1 << Z) / e
    ver, year = Counter(), Counter()
    for ft in L["features"]:
        ps = polys(ft["geometry"])
        if not ps: continue
        big = max(ps, key=lambda pg: ring_area(pg[0]))
        cx, cy = centroid(big[0])
        if not (0 <= cx < e and 0 <= cy < e): continue          # 重心規則（1棟1セル）
        area = sum(ring_area(pg[0]) - sum(ring_area(h) for h in pg[1:]) for pg in ps) * mpu * mpu
        pr = ft["properties"]; gs = pr.get("@geometry_source", "")
        if gs == "OpenStreetMap":
            rec["osm_n"] += 1; rec["osm_A"] += area
            try:
                src = json.loads(pr.get("sources", "[]"))
                s0 = next((s for s in src if s.get("dataset") == "OpenStreetMap"), src[0] if src else {})
                rid = s0.get("record_id", "")
                v = int(rid.rsplit("@", 1)[1]) if "@" in rid else 0
                ver[min(v, 10)] += 1                              # 10版以上は畳む
                ut = s0.get("update_time") or ""
                if len(ut) >= 4: year[ut[:4]] += 1
            except Exception:
                ver[0] += 1
            if pr.get("class") or pr.get("subtype"): rec["cls"] += 1
            if pr.get("names") or pr.get("@name"): rec["name"] += 1
            if pr.get("num_floors") or pr.get("height"): rec["floors"] += 1
        elif "zenodo" in gs or "8174931" in gs:                    # 東アジア学術（D4）
            rec["eab_n"] += 1; rec["eab_A"] += area
        else:                                                      # ほぼ Microsoft（D9）
            rec["ms_n"] += 1; rec["ms_A"] += area
    rec["ver"] = {str(k): v for k, v in ver.items()}
    rec["year"] = dict(year)
    return rec

if __name__ == "__main__":
    import csv
    cells = [(int(r["x"]), int(r["y"])) for r in csv.DictReader(open(f"{ROOT}/data/hokkaido-z14-census.csv"))]
    out = []
    with Pool(8) as pool:
        for i, rec in enumerate(pool.imap_unordered(one, cells, chunksize=64)):
            out.append(rec)
            if (i + 1) % 2000 == 0: print(f"  {i+1:,}/{len(cells):,}", flush=True)
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    json.dump(out, open(OUT, "w"))
    n = sum(r["osm_n"] for r in out) + sum(r["ms_n"] for r in out) + sum(r["eab_n"] for r in out)
    print(f"{len(out):,} セル・Overture {n:,} 棟 -> {OUT}")
