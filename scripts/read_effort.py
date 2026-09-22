#!/usr/bin/env -S uv run --quiet --script
# /// script
# requires-python = ">=3.10"
# dependencies = []
# ///
"""build/effort.json（scripts/effort_traces.py）を、センサスと都市計画区域に突き合わせて読む。

問い：建物データに、**誰が・どこに・どれだけ**手間をかけてきたか。
  公費        ＝ bvmap が細かく採られた範囲（都市計画区域の内、D30）
  人の時間    ＝ OSM の面積、版数（戻ってきて直した回数）、最後に触られた年、足された属性
  自動化      ＝ Microsoft ほか非OSMの面積（人の手がかかっていない）
すべて手元のデータだけ。
"""
import csv, json, math, os, sys
from collections import Counter, defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "scripts"))
from a09_coverage import load as a09_load, coverage as a09_coverage   # noqa: E402

def y2lat(y):
    n = math.pi - 2 * math.pi * y / 16384
    return math.degrees(math.atan(0.5 * (math.exp(n) - math.exp(-n))))
def km2(y):
    s = 40075016.686 * math.cos(math.radians(y2lat(y + 0.5))) / 16384; return s * s / 1e6

eff = {(r["x"], r["y"]): r for r in json.load(open(f"{ROOT}/build/effort.json"))}
FEATS, BUCKET, _ = a09_load()
cells = []
for r in csv.DictReader(open(f"{ROOT}/data/hokkaido-z14-census.csv")):
    x, y = int(r["x"]), int(r["y"]); e = eff[(x, y)]
    c = dict(e); c.update(code=r["code"], bv=int(r["bvmap_n"]), bvA=float(r["bvmap_area_m2"]),
                          dens=int(r["bvmap_n"]) / km2(y), cov=a09_coverage(x, y, FEATS, BUCKET))
    cells.append(c)

def tot(cs, k): return sum(c[k] for c in cs)
def vers(cs):
    v = Counter()
    for c in cs:
        for k, n in c["ver"].items(): v[int(k)] += n
    return v
def years(cs):
    y = Counter()
    for c in cs:
        for k, n in c["year"].items(): y[k] += n
    return y

# ---- 1. 全道：人の手はどれだけ戻ってきたか ----------------------------------
osm = tot(cells, "osm_n"); v = vers(cells); y = years(cells)
print(f"=== 1. OSM 由来の建物 {osm:,} 棟：版数（人が戻ってきた回数） ===")
for k in sorted(v):
    lab = "不明" if k == 0 else (f"{k}版以上" if k == 10 else f"{k}版")
    print(f"  {lab:>6} {v[k]:>9,} ({v[k]/osm*100:5.1f}%)")
print(f"  → 描かれたきり（1版）が {v[1]/osm*100:.1f}%")
print(f"\n  足された属性：用途 {tot(cells,'cls')/osm*100:.2f}%・名前 {tot(cells,'name')/osm*100:.2f}%"
      f"・階数/高さ {tot(cells,'floors')/osm*100:.2f}%")
print("\n  最後に触られた年（1版なら描かれた年）")
cum = 0
for k in sorted(y):
    cum += y[k]
    print(f"    {k} {y[k]:>8,} ({y[k]/osm*100:5.1f}%)  累積 {cum/osm*100:5.1f}%  {'█' * round(y[k]/osm*100)}")

# ---- 2. 三者の分担（面積で） ------------------------------------------------
print("\n=== 2. 三者の分担：bvmap の面積を 1 としたときの OSM・自動化の面積 ===")
def band(lab, cs):
    bvA = tot(cs, "bvA")
    if bvA <= 0: return
    print(f"  {lab:18s} {len(cs):>6} セル  bvmap {bvA/1e6:7.1f} km²  "
          f"OSM {tot(cs,'osm_A')/bvA:5.2f}  自動化 {tot(cs,'ms_A')/bvA:5.2f}  東ア学術 {tot(cs,'eab_A')/bvA:5.2f}")
live = [c for c in cells if c["bv"] > 0]
band("区域の外（被覆0）", [c for c in live if c["cov"] == 0])
band("区域の内（被覆1）", [c for c in live if c["cov"] >= 0.99])
print("  密度帯ごと（区域の外だけ）")
for lo, hi in [(0,10),(10,30),(30,100),(100,300),(300,1e9)]:
    band(f"  外 {lo}–{'' if hi>1e8 else hi}件/km²", [c for c in live if c["cov"] == 0 and lo <= c["dens"] < hi])
print("  密度帯ごと（区域の内だけ）")
for lo, hi in [(0,30),(30,100),(100,300),(300,1e9)]:
    band(f"  内 {lo}–{'' if hi>1e8 else hi}件/km²", [c for c in live if c["cov"] >= 0.99 and lo <= c["dens"] < hi])

# ---- 3. 手入れ：直しに戻ってきたか、最近触られたか --------------------------
print("\n=== 3. 手入れ：2版以上の割合・2024年以降に触られた割合 ===")
def care(lab, cs):
    vv = vers(cs); n = sum(vv.values()); yy = years(cs)
    if n < 1000: return
    re = (n - vv[1] - vv[0]) / n * 100
    recent = sum(c for k, c in yy.items() if k >= "2024") / n * 100
    print(f"  {lab:18s} OSM {n:>8,} 棟  2版以上 {re:5.1f}%  2024年以降 {recent:5.1f}%"
          f"  属性あり {(tot(cs,'cls'))/n*100:4.1f}%")
care("区域の外", [c for c in cells if c["cov"] == 0])
care("区域の内", [c for c in cells if c["cov"] >= 0.99])
for lo, hi in [(0,10),(10,30),(30,100),(100,300),(300,1e9)]:
    care(f"密度 {lo}–{'' if hi>1e8 else hi}", [c for c in cells if lo <= c["dens"] < hi])

# ---- 4. 誰も払っていない所 --------------------------------------------------
print("\n=== 4. 誰も手をかけていない所：区域の外で、OSM も自動化も bvmap の半分に届かないセル ===")
gap = [c for c in live if c["cov"] == 0 and c["bvA"] > 0
       and c["osm_A"] / c["bvA"] < 0.5 and c["ms_A"] / c["bvA"] < 0.5]
bv_all = tot(live, "bv")
print(f"  {len(gap):,} セル（建物のあるセルの {len(gap)/len(live)*100:.1f}%）、"
      f"bvmap の建物 {tot(gap,'bv'):,} 棟（全道の {tot(gap,'bv')/bv_all*100:.1f}%）")
names = json.load(open(f"{ROOT}/data/hokkaido-z14-cells.json"))["municipalities"]
by = Counter()
for c in gap: by[c["code"]] += c["bv"]
print("  多い市区町村（bvmap の棟数）：" + "、".join(f"{names.get(k,k)} {n:,}" for k, n in by.most_common(8)))
