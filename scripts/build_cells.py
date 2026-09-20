#!/usr/bin/env -S uv run --quiet --script
# /// script
# requires-python = ">=3.10"
# dependencies = []
# ///
"""センサスCSVを、タイル化用の z14 セル GeoJSONL 1本に書き出す。

**どのズームでも z14 セルそのものを出す**（D29）。以前はタイルのズーム Z ごとに
セルのレベル L = min(14, Z + DETAIL) を置くピラミッドを作っていたが、これだと
「ズームを変えると集計単位が変わる」＝**見えている模様がズームごとに別の統計**
になってしまう。分布を読むつもりで拡大縮小すると傾向が変わって見え、それが
データの性質なのか集計単位の性質なのか区別できない（いわゆる MAUP）。

セルが画面上でサブピクセルになっても間引かない。低ズームでは 1px 前後の
細かいモザイクになるが、セルは陸域を隙間なく覆うので、点描ではなく
「地肌」として読める。実測でも z4 の1タイルに 27,947 セル全部が残り、
件数の合計はセンサスと一致する（308 KB / タイル）。

出力は tippecanoe 用の改行区切り GeoJSON 1本。タイルの分割は tippecanoe に任せる。
"""
import csv, json, math, os
from collections import defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CENSUS = os.path.join(ROOT, "data", "hokkaido-z14-census.csv")
CELLS = os.path.join(ROOT, "data", "hokkaido-z14-cells.json")
OUT = os.path.join(ROOT, "build", "cells.geojsonl")

Z = 14                    # セルのレベル。センサスの粒度であり、表示の粒度でもある
NUM = ["bv", "ov", "osm", "eab", "oth", "bvA", "ovA"]

def x2lon(x, z=Z): return x / (1 << z) * 360.0 - 180.0
def y2lat(y, z=Z):
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
print(f"z{Z} セル: {len(base):,} 件")

os.makedirs(os.path.dirname(OUT), exist_ok=True)
with open(OUT, "w") as f:
    for (x, y), v in sorted(base.items()):
        w, e = x2lon(x), x2lon(x + 1)
        n_, s_ = y2lat(y), y2lat(y + 1)
        props = {k: v[k] for k in NUM}
        props.update(code=v["code"], name=names.get(v["code"], v["code"]), lv=Z)
        f.write(json.dumps({
            "type": "Feature",
            "properties": props,
            # 外環は反時計回り（RFC 7946）
            "geometry": {"type": "Polygon",
                         "coordinates": [[[w, s_], [e, s_], [e, n_], [w, n_], [w, s_]]]},
        }, ensure_ascii=False, separators=(",", ":")) + "\n")

# 書き出しが壊れていないことを確認する（書き直したら既知の数字と突き合わせる）
tot = {k: sum(v[k] for v in base.values()) for k in NUM}
s = {k: 0 for k in NUM}
n_out = 0
with open(OUT) as f:
    for line in f:
        p = json.loads(line)["properties"]
        for k in NUM: s[k] += p[k]
        n_out += 1
assert n_out == len(base), f"書き出した件数が違う: {n_out} != {len(base)}"
assert s == tot, f"合計がセンサスと一致しない: {s} != {tot}"
print(f"{OUT}  {os.path.getsize(OUT)/1e6:.1f} MB  "
      f"bvmap {tot['bv']:,} / Overture {tot['ov']:,}（センサスと一致）")

# ---- 市区町村ジャンプ用の外接範囲（タイルには入れない小さな別ファイル）----
ext = {}
for (x, y), v in base.items():
    b = ext.setdefault(v["code"], [x, y, x, y])
    b[0] = min(b[0], x); b[1] = min(b[1], y)
    b[2] = max(b[2], x); b[3] = max(b[3], y)
out = {}
for code, b in sorted(ext.items()):
    out[code] = {"name": names.get(code, code),
                 "bbox": [round(x2lon(b[0]), 6), round(y2lat(b[3] + 1), 6),
                          round(x2lon(b[2] + 1), 6), round(y2lat(b[1]), 6)]}
dst = os.path.join(ROOT, "docs", "data", "municipal-extents.json")
json.dump(out, open(dst, "w"), ensure_ascii=False, separators=(",", ":"))
print(f"市区町村の外接範囲 {len(out)} 件 -> {dst} ({os.path.getsize(dst)/1000:.0f} KB)")
