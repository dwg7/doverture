#!/usr/bin/env -S uv run --quiet --script
# /// script
# requires-python = ">=3.10"
# dependencies = []
# ///
"""D28 の仮説を、都市計画区域の境界データで確かめる。

D28 で分かったのは「bvmap の建物面積の床（セルごとの p5）は二峰で、密度では
説明できず、自治体の中を鋭い境界が走っている」ところまで。原因は未特定だった。

ここで突き合わせるのは **国土数値情報 A09（都市地域）2018年度版**。
第4.0版は「**都市計画法で指定する都市計画区域を都市地域とみなし作成**」と
明記されており（データ概要）、仮説の「都市計画区域の内外」そのものに当たる。

入手：https://nlftp.mlit.go.jp/ksj/gml/data/A09/A09-18/A09-18_01_GML.zip （6.7MB）
リポジトリには置かない。下の KSJ を各自のキャッシュに展開しておくこと。

層の区分（layer_no）が何を指すかは製品仕様書を見ないと確定しないが、**区分に
依らず全ポリゴンの和を取れば都市計画区域**になる（細区分は入れ子なので和は不変）。
そのため layer_no は使わない。

床の値は scripts/detect_capture_scale.py が書く build/floor.json を読む。
"""
import json, math, os, sys
from collections import defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "scripts"))
from a09_coverage import load as a09_load, coverage as a09_coverage, KSJ   # noqa: E402

FLOOR = os.path.join(ROOT, "build", "floor.json")
Z = 14
N = 1 << Z

def y2lat(y):
    n = math.pi - 2 * math.pi * y / N
    return math.degrees(math.atan(0.5 * (math.exp(n) - math.exp(-n))))

FEATS, BUCKET, NFILES = a09_load()
print(f"A09 ポリゴン {len(FEATS):,} 個（{NFILES} 市区町村のファイル）")
print(f"ポリゴンが掛かる z14 セル {len(BUCKET):,} 個")
def coverage(cx, cy): return a09_coverage(cx, cy, FEATS, BUCKET)

# ---- 床の計測値と突き合わせる ------------------------------------------------
assert os.path.exists(FLOOR), "build/floor.json が無い。先に scripts/detect_capture_scale.py"
floor = json.load(open(FLOOR))
names = json.load(open(f"{ROOT}/data/hokkaido-z14-cells.json"))["municipalities"]
for o in floor:
    o["cov"] = coverage(o["x"], o["y"])
    o["in"] = o["cov"] >= 0.5
print(f"床の計測セル {len(floor):,}　うち都市計画区域の内 {sum(1 for o in floor if o['in']):,}\n")

# 全道のうちどれだけが区域の内か（文脈として）
import csv as _csv
allc = [(int(r["x"]), int(r["y"])) for r in _csv.DictReader(open(f"{ROOT}/data/hokkaido-z14-census.csv"))]
cov_all = [coverage(x, y) for x, y in allc]
n_in = sum(1 for c in cov_all if c >= 0.5)
print(f"全道 z14 セル {len(allc):,} のうち、都市計画区域が半分以上を占めるのは "
      f"{n_in:,}（{n_in/len(allc)*100:.1f}%）、少しでも掛かるのは "
      f"{sum(1 for c in cov_all if c > 0):,}\n")

def q(v, p):
    v = sorted(v); return v[min(int(p * (len(v) - 1)), len(v) - 1)]

print("=== 都市計画区域の内 / 外で、床（p5）がどう違うか ===")
print(f"{'':>6} {'セル':>6} {'p5中央':>7} {'p10':>6} {'p90':>6} {'中央密度':>9}")
for lab, sel in [("内", [o for o in floor if o["in"]]), ("外", [o for o in floor if not o["in"]])]:
    if not sel: continue
    v = [o["p5"] for o in sel]; d = [o["dens"] for o in sel]
    print(f"{lab:>6} {len(sel):>6} {q(v,.5):>7.0f} {q(v,.1):>6.0f} {q(v,.9):>6.0f} {q(d,.5):>9.1f}")

print("\n=== 密度を揃えても差が残るか（密度帯ごとに内外を比べる） ===")
print(f"{'密度(件/km²)':>14} {'内セル':>7} {'内p5中央':>9} {'外セル':>7} {'外p5中央':>9} {'差':>7}")
for lo, hi in [(0,10),(10,30),(30,60),(60,120),(120,300),(300,1e9)]:
    b = [o for o in floor if lo <= o["dens"] < hi]
    i_ = [o["p5"] for o in b if o["in"]]; o_ = [o["p5"] for o in b if not o["in"]]
    if len(i_) < 5 or len(o_) < 5: continue
    lbl = f"{lo}–" + ("" if hi > 1e8 else str(hi))
    print(f"{lbl:>14} {len(i_):>7} {q(i_,.5):>9.0f} {len(o_):>7} {q(o_,.5):>9.0f} {q(o_,.5)-q(i_,.5):>+7.0f}")

print("\n=== 同じ市区町村の中で内外を比べる（自治体差を消す） ===")
mu = defaultdict(lambda: {"in": [], "out": []})
for o in floor: mu[o["code"]]["in" if o["in"] else "out"].append(o["p5"])
pairs = [(c, v) for c, v in mu.items() if len(v["in"]) >= 3 and len(v["out"]) >= 3]
print(f"内外を両方持つ市区町村 {len(pairs)} 件")
diffs = []
for c, v in sorted(pairs, key=lambda kv: q(kv[1]["out"],.5) - q(kv[1]["in"],.5), reverse=True):
    d = q(v["out"],.5) - q(v["in"],.5); diffs.append(d)
for c, v in sorted(pairs, key=lambda kv: q(kv[1]["out"],.5) - q(kv[1]["in"],.5), reverse=True)[:8]:
    print(f"  {names.get(c,c):10s} 内 {q(v['in'],.5):4.0f} → 外 {q(v['out'],.5):4.0f} m²"
          f"  ({len(v['in'])}/{len(v['out'])}セル)")
if diffs:
    diffs.sort()
    print(f"  ---\n  外−内 の中央値 {diffs[len(diffs)//2]:+.0f} m²　"
          f"外の方が高い自治体 {sum(1 for d in diffs if d > 0)}/{len(diffs)}")

print("\n=== 用量反応：セルが区域に覆われている割合ごとに床を見る ===")
print(f"{'被覆率':>10} {'セル':>6} {'p5中央':>7} {'中央密度':>9}")
for lo, hi in [(0,0.01),(0.01,0.25),(0.25,0.5),(0.5,0.75),(0.75,0.99),(0.99,1.01)]:
    b = [o for o in floor if lo <= o["cov"] < hi]
    if len(b) < 5: continue
    lbl = "0（外）" if hi <= 0.01 else ("1（内）" if lo >= 0.99 else f"{lo:.2f}–{hi:.2f}")
    print(f"{lbl:>10} {len(b):>6} {q([o['p5'] for o in b],.5):>7.0f} "
          f"{q([o['dens'] for o in b],.5):>9.1f}")
print("  → 単調に下がるなら、境界のどちら側かではなく「どれだけ覆われているか」で決まっている")

print("\n=== 曖昧なセルを除く（被覆率 0 と 1 だけ・密度帯を揃える） ===")
print(f"{'密度(件/km²)':>14} {'外(0)':>7} {'p5中央':>7} {'内(1)':>7} {'p5中央':>7}")
for lo, hi in [(10,30),(30,60),(60,120),(120,300)]:
    b = [o for o in floor if lo <= o["dens"] < hi]
    o_ = [o["p5"] for o in b if o["cov"] == 0]; i_ = [o["p5"] for o in b if o["cov"] >= 0.99]
    if len(i_) < 5 or len(o_) < 5: continue
    print(f"{f'{lo}–{hi}':>14} {len(o_):>7} {q(o_,.5):>7.0f} {len(i_):>7} {q(i_,.5):>7.0f}")

print("\n=== 床が崖になる隣接ペアは、区域の境界に乗っているか ===")
by = {(o["x"], o["y"]): o for o in floor}
cliff_cross = cliff_same = flat_cross = flat_same = 0
for (x, y), o in by.items():
    for nx, ny in ((x+1, y), (x, y+1)):
        p = by.get((nx, ny))
        if not p: continue
        cliff = abs(o["p5"] - p["p5"]) >= 80
        cross = o["in"] != p["in"]
        if cliff and cross: cliff_cross += 1
        elif cliff: cliff_same += 1
        elif cross: flat_cross += 1
        else: flat_same += 1
tot = cliff_cross + cliff_same + flat_cross + flat_same
if tot:
    print(f"  隣接ペア {tot:,}")
    print(f"  崖（床差80m²以上）  {cliff_cross+cliff_same:>5}　うち区域境界をまたぐ {cliff_cross:>4}"
          f"（{cliff_cross/max(1,cliff_cross+cliff_same)*100:.1f}%）")
    print(f"  平坦               {flat_cross+flat_same:>5}　うち区域境界をまたぐ {flat_cross:>4}"
          f"（{flat_cross/max(1,flat_cross+flat_same)*100:.1f}%）")
    print("  → 崖の方が「またぐ率」が高ければ、境界が床を決めている")
