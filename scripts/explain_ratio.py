#!/usr/bin/env -S uv run --quiet --script
# /// script
# requires-python = ">=3.10"
# dependencies = []
# ///
"""D29 が掘り出した問い：全道の赤（Overture ÷ bvmap > 1）は何なのか。

z14 セルを全ズームで出すようにしたら（D29）、64px のときは平均で潰れていた模様が
出てきた——赤が谷筋と海岸線に沿って細く走り、石狩・十勝・根釧の盆地に青が固まる。

仮説：**その赤の多くは「Overture が多い」ではなく「bvmap が少ない」**。
D30 で、bvmap の建物面積の床は都市計画区域の外で 83m²、内で 9m² と分かった。
外では小さい建物が入っていない。分母が小さくなれば比は上がる。

つまり主要指標（Overture ÷ bvmap）は、**両者の捉え方の差**と
**bvmap の取得精度の差**を混ぜて表示している可能性がある。ここを切り分ける。

検定はふたつ：
  (a) 区域の被覆率ごとに比を見る（全 27,947 セル）
  (b) 床（p5）の高さごとに比を見る（build/floor.json の 2,500 セル）
どちらも密度を揃えて見る。
"""
import csv, json, math, os, sys
from collections import defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "scripts"))
from a09_coverage import load as a09_load, coverage as a09_coverage   # noqa: E402

Z = 14; N = 1 << Z
def y2lat(y):
    n = math.pi - 2 * math.pi * y / N
    return math.degrees(math.atan(0.5 * (math.exp(n) - math.exp(-n))))
def km2(y):
    s = 40075016.686 * math.cos(math.radians(y2lat(y + 0.5))) / N
    return s * s / 1e6
def q(v, p):
    v = sorted(v); return v[min(int(p * (len(v) - 1)), len(v) - 1)]

cells = []
for r in csv.DictReader(open(f"{ROOT}/data/hokkaido-z14-census.csv")):
    bv, ov = int(r["bvmap_n"]), int(r["ov_n"])
    if bv < 10: continue                      # 比が暴れるセルは外す
    x, y = int(r["x"]), int(r["y"])
    bvA, ovA = int(r["bvmap_area_m2"]), int(r["ov_area_m2"])
    cells.append({"x": x, "y": y, "code": r["code"], "bv": bv, "ov": ov,
                  "ratio": ov / bv, "dens": bv / km2(y),
                  "aratio": (ovA / bvA) if bvA > 0 else None})
FEATS, BUCKET, _ = a09_load()
for c in cells: c["cov"] = a09_coverage(c["x"], c["y"], FEATS, BUCKET)
print(f"対象セル {len(cells):,}（bvmap 10件以上）\n")

print("=== (a) 都市計画区域の被覆率ごとに、Overture ÷ bvmap を見る ===")
print(f"{'被覆率':>10} {'セル':>7} {'比の中央':>9} {'赤(>1.05)':>10} {'青(<0.95)':>10} {'中央密度':>9}")
for lo, hi in [(0,0.01),(0.01,0.25),(0.25,0.5),(0.5,0.75),(0.75,0.99),(0.99,1.01)]:
    b = [c for c in cells if lo <= c["cov"] < hi]
    if len(b) < 20: continue
    lbl = "0（外）" if hi <= 0.01 else ("1（内）" if lo >= 0.99 else f"{lo:.2f}–{hi:.2f}")
    red = sum(1 for c in b if c["ratio"] > 1.05) / len(b) * 100
    blue = sum(1 for c in b if c["ratio"] < 0.95) / len(b) * 100
    print(f"{lbl:>10} {len(b):>7} {q([c['ratio'] for c in b],.5):>9.2f} "
          f"{red:>9.1f}% {blue:>9.1f}% {q([c['dens'] for c in b],.5):>9.1f}")

print("\n=== 密度を揃えても残るか ===")
print(f"{'密度(件/km²)':>14} {'外セル':>7} {'外の比':>7} {'内セル':>7} {'内の比':>7} {'差':>7}")
for lo, hi in [(0,10),(10,30),(30,60),(60,120),(120,300),(300,1e9)]:
    b = [c for c in cells if lo <= c["dens"] < hi]
    o_ = [c["ratio"] for c in b if c["cov"] == 0]
    i_ = [c["ratio"] for c in b if c["cov"] >= 0.99]
    if len(i_) < 10 or len(o_) < 10: continue
    lbl = f"{lo}–" + ("" if hi > 1e8 else str(hi))
    print(f"{lbl:>14} {len(o_):>7} {q(o_,.5):>7.2f} {len(i_):>7} {q(i_,.5):>7.2f} "
          f"{q(o_,.5)-q(i_,.5):>+7.2f}")

FLOOR = os.path.join(ROOT, "build", "floor.json")
if os.path.exists(FLOOR):
    floor = {(o["x"], o["y"]): o for o in json.load(open(FLOOR))}
    j = [dict(c, p5=floor[(c["x"], c["y"])]["p5"]) for c in cells if (c["x"], c["y"]) in floor]
    print(f"\n=== (b) bvmap の床（p5）の高さごとに比を見る（{len(j):,} セル） ===")
    print(f"{'床 p5(m²)':>12} {'セル':>6} {'比の中央':>9} {'赤(>1.05)':>10} {'中央密度':>9}")
    for lo, hi in [(0,20),(20,40),(40,80),(80,120),(120,1e9)]:
        b = [c for c in j if lo <= c["p5"] < hi]
        if len(b) < 10: continue
        lbl = f"{lo}–" + ("" if hi > 1e8 else str(hi))
        red = sum(1 for c in b if c["ratio"] > 1.05) / len(b) * 100
        print(f"{lbl:>12} {len(b):>6} {q([c['ratio'] for c in b],.5):>9.2f} "
              f"{red:>9.1f}% {q([c['dens'] for c in b],.5):>9.1f}")
    print("\n  同じ密度帯（10–30件/km²）の中で床の高低だけを比べる：")
    b = [c for c in j if 10 <= c["dens"] < 30]
    lo_ = [c["ratio"] for c in b if c["p5"] < 40]; hi_ = [c["ratio"] for c in b if c["p5"] >= 100]
    if len(lo_) >= 10 and len(hi_) >= 10:
        print(f"    床が低い（<40m²） {len(lo_):>4} セル  比の中央 {q(lo_,.5):.2f}")
        print(f"    床が高い（≥100m²）{len(hi_):>4} セル  比の中央 {q(hi_,.5):.2f}")
        print(f"    → 差 {q(hi_,.5)-q(lo_,.5):+.2f}。密度が同じでも、床が高いほど赤くなる")
else:
    print("\n（build/floor.json が無いので (b) は省略。scripts/detect_capture_scale.py を先に）")


print("\n=== (c) 件数比のかわりに面積比を使ったらどうなるか ===")
print("小さい建物は面積をほとんど持たないので、取得精度の差に鈍いはず。")
a = [c for c in cells if c["aratio"] is not None]
print(f"{'被覆率':>10} {'セル':>7} {'件数比':>8} {'面積比':>8}")
for lo, hi in [(0,0.01),(0.25,0.5),(0.99,1.01)]:
    b = [c for c in a if lo <= c["cov"] < hi]
    if len(b) < 20: continue
    lbl = "0（外）" if hi <= 0.01 else ("1（内）" if lo >= 0.99 else f"{lo:.2f}–{hi:.2f}")
    print(f"{lbl:>10} {len(b):>7} {q([c['ratio'] for c in b],.5):>8.2f} "
          f"{q([c['aratio'] for c in b],.5):>8.2f}")
print(f"{'':>10} {'':>7} {'--- 内外差 ---':>8}")
o_ = [c for c in a if c["cov"] == 0]; i_ = [c for c in a if c["cov"] >= 0.99]
print(f"  件数比 外 {q([c['ratio'] for c in o_],.5):.2f} / 内 {q([c['ratio'] for c in i_],.5):.2f}"
      f"  → 差 {q([c['ratio'] for c in o_],.5)-q([c['ratio'] for c in i_],.5):+.2f}")
print(f"  面積比 外 {q([c['aratio'] for c in o_],.5):.2f} / 内 {q([c['aratio'] for c in i_],.5):.2f}"
      f"  → 差 {q([c['aratio'] for c in o_],.5)-q([c['aratio'] for c in i_],.5):+.2f}")

if os.path.exists(FLOOR):
    print("\n  床の高低で見ても（同じ密度帯 10–30件/km²）：")
    b = [c for c in j if 10 <= c["dens"] < 30 and c["aratio"] is not None]
    lo_ = [c for c in b if c["p5"] < 40]; hi_ = [c for c in b if c["p5"] >= 100]
    if len(lo_) >= 10 and len(hi_) >= 10:
        print(f"    件数比  床低 {q([c['ratio'] for c in lo_],.5):.2f} → 床高 {q([c['ratio'] for c in hi_],.5):.2f}"
              f"  （差 {q([c['ratio'] for c in hi_],.5)-q([c['ratio'] for c in lo_],.5):+.2f}）")
        print(f"    面積比  床低 {q([c['aratio'] for c in lo_],.5):.2f} → 床高 {q([c['aratio'] for c in hi_],.5):.2f}"
              f"  （差 {q([c['aratio'] for c in hi_],.5)-q([c['aratio'] for c in lo_],.5):+.2f}）")
