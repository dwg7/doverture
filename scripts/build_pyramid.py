#!/usr/bin/env -S uv run --quiet --script
# /// script
# requires-python = ">=3.10"
# dependencies = []
# ///
"""センサスCSVから、空間IDの階層をそのまま使ったセルのピラミッドを作る。

空間ID(ZFXY)は z14 の (x, y) を2で割れば z13 になる——**タイルピラミッドが
最初から手元にある**。低ズーム用に件数を足し上げるだけで、各ズームに
「そのズームで意味のある大きさのセル」を置ける。

対応：タイルのズーム Z には、セルのレベル L = min(14, Z + 2) を置く。
こうすると 1タイルに必ず 4x4 = 16 セルが入り、extent 4096 なら 1辺 1024 単位。
どのズームでも同じ見え方になり、サブピクセルのセルを描くことがなくなる。

maxzoom は 12（= z14 セル）。それ以上は overzoom で表示する——セルは地理的に
固定サイズなので、拡大しても正しい大きさで描かれる。

出力は tippecanoe 用の改行区切り GeoJSON（レベルごとに1ファイル）。
"""
import csv, json, math, os, sys
from collections import defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CENSUS = os.path.join(ROOT, "data", "hokkaido-z14-census.csv")
CELLS = os.path.join(ROOT, "data", "hokkaido-z14-cells.json")
OUT = os.path.join(ROOT, "build", "pyramid")

BASE = 14                 # センサスのセルのレベル
MAXZOOM = 12              # タイルの最大ズーム（= BASE - 2）
MINZOOM = 4
NUM = ["bv", "ov", "osm", "eab", "oth", "bvA", "ovA"]

def x2lon(x, z): return x / (1 << z) * 360.0 - 180.0
def y2lat(y, z):
    n = math.pi - 2.0 * math.pi * y / (1 << z)
    return math.degrees(math.atan(0.5 * (math.exp(n) - math.exp(-n))))

names = json.load(open(CELLS)).get("municipalities", {})

base = {}
with open(CENSUS) as f:
    for r in csv.DictReader(f):
        base[(int(r["x"]), int(r["y"]))] = {
            "bv": int(r["bvmap_n"]), "ov": int(r["ov_n"]),
            "osm": int(r["ov_osm"]), "eab": int(r["ov_eab"]), "oth": int(r["ov_other"]),
            "bvA": int(r["bvmap_area_m2"]), "ovA": int(r["ov_area_m2"]),
            "code": r["code"],
        }
print(f"基底 z{BASE}: {len(base):,} セル")

os.makedirs(OUT, exist_ok=True)
manifest = []
for tz in range(MINZOOM, MAXZOOM + 1):
    level = min(BASE, tz + 2)
    shift = BASE - level
    agg = defaultdict(lambda: {k: 0 for k in NUM} | {"n": 0, "codes": defaultdict(int)})
    for (x, y), v in base.items():
        a = agg[(x >> shift, y >> shift)]
        for k in NUM: a[k] += v[k]
        a["n"] += 1
        a["codes"][v["code"]] += 1
    path = os.path.join(OUT, f"z{tz}.geojsonl")
    with open(path, "w") as f:
        for (cx, cy), a in sorted(agg.items()):
            w, e = x2lon(cx, level), x2lon(cx + 1, level)
            n_, s_ = y2lat(cy, level), y2lat(cy + 1, level)
            code = max(a["codes"].items(), key=lambda kv: kv[1])[0]
            props = {k: a[k] for k in NUM}
            props.update(cells=a["n"], code=code, name=names.get(code, code), lv=level)
            f.write(json.dumps({
                "type": "Feature",
                "properties": props,
                # 外環は反時計回り（RFC 7946）
                "geometry": {"type": "Polygon",
                             "coordinates": [[[w, s_], [e, s_], [e, n_], [w, n_], [w, s_]]]},
            }, ensure_ascii=False, separators=(",", ":")) + "\n")
    manifest.append({"tilezoom": tz, "celllevel": level, "cells": len(agg), "file": path})
    print(f"  タイル z{tz:>2} ← セル z{level:<2}  {len(agg):>7,} セル  "
          f"({os.path.getsize(path)/1e6:.2f} MB)")

# 足し上げが壊れていないことを確認する（D176 の教訓：書き直したら既知の数字と突き合わせる）
tot = {k: sum(v[k] for v in base.values()) for k in NUM}
for m in manifest:
    s = {k: 0 for k in NUM}
    with open(m["file"]) as f:
        for line in f:
            p = json.loads(line)["properties"]
            for k in NUM: s[k] += p[k]
    assert s == tot, f"z{m['tilezoom']} の合計が基底と一致しない: {s} != {tot}"
print(f"\n全レベルで合計が一致: bvmap {tot['bv']:,} / Overture {tot['ov']:,}")
json.dump(manifest, open(os.path.join(OUT, "manifest.json"), "w"), indent=2)

# ---- 市区町村ジャンプ用の外接範囲（タイルには入れない小さな別ファイル）----
ext = {}
for (x, y), v in base.items():
    b = ext.setdefault(v["code"], [x, y, x, y])
    b[0] = min(b[0], x); b[1] = min(b[1], y)
    b[2] = max(b[2], x); b[3] = max(b[3], y)
out = {}
for code, b in sorted(ext.items()):
    out[code] = {"name": names.get(code, code),
                 "bbox": [round(x2lon(b[0], BASE), 6), round(y2lat(b[3] + 1, BASE), 6),
                          round(x2lon(b[2] + 1, BASE), 6), round(y2lat(b[1], BASE), 6)]}
dst = os.path.join(ROOT, "docs", "data", "municipal-extents.json")
json.dump(out, open(dst, "w"), ensure_ascii=False, separators=(",", ":"))
print(f"市区町村の外接範囲 {len(out)} 件 -> {dst} ({os.path.getsize(dst)/1000:.0f} KB)")
