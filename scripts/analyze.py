#!/usr/bin/env -S uv run --quiet --script
# /// script
# requires-python = ">=3.10"
# dependencies = []
# ///
"""全道センサスの分布を読む。

集計の単位は z14 セル（27,947）。市区町村（194）より標本が2桁多く、
密度という説明変数で層化できる。

比率は「比率の平均」ではなく「合計の比」で出す（件数の少ないセルに引きずられないため）。
"""
import csv, json, math, os
from collections import defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
rows = list(csv.DictReader(open(os.path.join(ROOT, "data", "hokkaido-z14-census.csv"))))
names = json.load(open(os.path.join(ROOT, "data", "hokkaido-z14-cells.json")))["municipalities"]
I = lambda r, k: int(r[k])

def y2lat(y, z=14):
    n = math.pi - 2 * math.pi * y / (1 << z)
    return math.degrees(math.atan(0.5 * (math.exp(n) - math.exp(-n))))
def cell_km2(y):
    s = 40075016.686 * math.cos(math.radians(y2lat(int(y) + 0.5))) / (1 << 14)
    return s * s / 1e6

for r in rows:
    r["km2"] = cell_km2(r["y"])
    r["dens"] = I(r, "bvmap_n") / r["km2"]

live = [r for r in rows if I(r, "bvmap_n") > 0 or I(r, "ov_n") > 0]
print(f"セル {len(rows):,}（うち建物ありは {len(live):,} = {len(live)/len(rows)*100:.1f}%）\n")

# ---- 1. 密度で層化して、比率の向きを見る ----
BINS = [(0, 1), (1, 3), (3, 10), (10, 30), (30, 100), (100, 300), (300, 1e9)]
LBL = ["0–1", "1–3", "3–10", "10–30", "30–100", "100–300", "300+"]
print("=== bvmap 建物密度で層化（セル単位、合計の比）===")
print(f"{'密度(件/km²)':>12} {'セル':>7} {'bvmap':>10} {'Overture':>10} {'Ovt/bv':>7} "
      f"{'MS%':>6} {'EAB%':>6} {'bvmap平均面積':>13} {'小建物<50m²推定':>15}")
for (lo, hi), lbl in zip(BINS, LBL):
    sub = [r for r in live if lo <= r["dens"] < hi]
    if not sub: continue
    bv = sum(I(r, "bvmap_n") for r in sub); ov = sum(I(r, "ov_n") for r in sub)
    oth = sum(I(r, "ov_other") for r in sub); eab = sum(I(r, "ov_eab") for r in sub)
    ba = sum(I(r, "bvmap_area_m2") for r in sub)
    print(f"{lbl:>12} {len(sub):>7,} {bv:>10,} {ov:>10,} {ov/max(bv,1):>7.3f} "
          f"{oth/max(ov,1)*100:>5.1f}% {eab/max(ov,1)*100:>5.1f}% {ba/max(bv,1):>12.0f}m²"
          f" {'':>15}")

# ---- 2. 建物種別の構成（bvmap）----
print("\n=== bvmap の建物種別（vt_code）の構成 ===")
print(f"{'密度':>12} {'3101普通':>9} {'3102堅ろう':>10} {'3103高層':>9} {'3111無壁舎':>10} {'3112':>7}")
for (lo, hi), lbl in zip(BINS, LBL):
    sub = [r for r in live if lo <= r["dens"] < hi]
    if not sub: continue
    tot = sum(I(r, "bvmap_n") for r in sub) or 1
    g = lambda k: sum(I(r, k) for r in sub) / tot * 100
    print(f"{lbl:>12} {g('bv_3101'):>8.1f}% {g('bv_3102'):>9.1f}% {g('bv_3103'):>8.1f}% "
          f"{g('bv_3111'):>9.1f}% {g('bv_3112'):>6.1f}%")

# ---- 3. 市区町村の分布 ----
mu = defaultdict(lambda: defaultdict(int))
for r in live:
    m = mu[r["code"]]
    for k in ("bvmap_n", "ov_n", "ov_osm", "ov_eab", "ov_other", "bvmap_area_m2"):
        m[k] += I(r, k)
    m["cells"] += 1
    m["km2"] += r["km2"]
rat = [(m["ov_n"] / m["bvmap_n"], c, m) for c, m in mu.items() if m["bvmap_n"] > 0]
rat.sort()
v = [x[0] for x in rat]
q = lambda p: v[min(int(p * (len(v) - 1)), len(v) - 1)]
print(f"\n=== 市区町村 {len(rat)} の Overture/bvmap 比 ===")
print(f"  p0 {q(0):.2f} / p10 {q(.1):.2f} / p25 {q(.25):.2f} / 中央 {q(.5):.2f} "
      f"/ p75 {q(.75):.2f} / p90 {q(.9):.2f} / p100 {q(1):.2f}")
print(f"  bvmap が多い(<1.0): {sum(1 for x in v if x < 1):>3} / "
      f"Overture が多い(>1.0): {sum(1 for x in v if x >= 1):>3}")
print("\n  bvmap が多い上位8:")
for r_, c, m in rat[:8]:
    print(f"    {names.get(c,c):8s} {r_:.2f}  密度 {m['bvmap_n']/m['km2']:7.1f} 件/km²  "
          f"bvmap {m['bvmap_n']:>7,}  MS {m['ov_other']/max(m['ov_n'],1)*100:4.1f}%")
print("  Overture が多い上位8:")
for r_, c, m in rat[-8:][::-1]:
    print(f"    {names.get(c,c):8s} {r_:.2f}  密度 {m['bvmap_n']/m['km2']:7.1f} 件/km²  "
          f"bvmap {m['bvmap_n']:>7,}  MS {m['ov_other']/max(m['ov_n'],1)*100:4.1f}%")

# ---- 4. 相関 ----
def corr(xs, ys):
    n = len(xs); mx = sum(xs)/n; my = sum(ys)/n
    sx = math.sqrt(sum((x-mx)**2 for x in xs)); sy = math.sqrt(sum((y-my)**2 for y in ys))
    return sum((x-mx)*(y-my) for x, y in zip(xs, ys))/(sx*sy) if sx and sy else 0
sub = [r for r in live if I(r, "bvmap_n") >= 5 and I(r, "ov_n") >= 5]
ld = [math.log10(r["dens"]) for r in sub]
lr = [math.log10(I(r, "ov_n") / I(r, "bvmap_n")) for r in sub]
ms = [I(r, "ov_other") / I(r, "ov_n") * 100 for r in sub]
sz = [I(r, "bvmap_area_m2") / I(r, "bvmap_n") for r in sub]
print(f"\n=== セル単位の相関（bvmap≥5 かつ Overture≥5 の {len(sub):,} セル）===")
print(f"  log密度 × log(Ovt/bv)      r = {corr(ld, lr):+.3f}")
print(f"  log密度 × Microsoft比率     r = {corr(ld, ms):+.3f}")
print(f"  log密度 × bvmap平均建物面積 r = {corr(ld, sz):+.3f}")

# ---- 5. 高い比率の正体を分解する：OSM だけで bvmap を超えているか ----
print("\n=== 密度別に、Overture の内訳ごとに bvmap と比べる ===")
print(f"{'密度':>12} {'OSM/bv':>8} {'(OSM+EAB)/bv':>13} {'全体/bv':>8}  {'解釈':<34}")
for (lo, hi), lbl in zip(BINS, LBL):
    sub = [r for r in live if lo <= r["dens"] < hi]
    if not sub: continue
    bv = sum(I(r, "bvmap_n") for r in sub) or 1
    osm = sum(I(r, "ov_osm") for r in sub); eab = sum(I(r, "ov_eab") for r in sub)
    ov = sum(I(r, "ov_n") for r in sub)
    a, b, c = osm/bv, (osm+eab)/bv, ov/bv
    why = ("OSM だけで bvmap 超え" if a > 1.05 else
           "非OSM分で逆転" if c > 1.05 else
           "bvmap が優勢" if c < 0.95 else "拮抗")
    print(f"{lbl:>12} {a:>8.3f} {b:>13.3f} {c:>8.3f}  {why:<34}")

# ---- 6. 北方領土と本土を分ける ----
NT = {c for c, n in names.items() if c >= "01695" and c <= "01700"}
print("\n=== 北方領土（6村）と本土の比較 ===")
for label, sel in (("北方領土", lambda r: r["code"] in NT), ("本土", lambda r: r["code"] not in NT)):
    sub = [r for r in live if sel(r)]
    bv = sum(I(r, "bvmap_n") for r in sub) or 1
    ov = sum(I(r, "ov_n") for r in sub); osm = sum(I(r, "ov_osm") for r in sub)
    oth = sum(I(r, "ov_other") for r in sub)
    km2 = sum(r["km2"] for r in sub)
    print(f"  {label:6s} セル{len(sub):>6,}  bvmap {bv:>9,}（{bv/km2:>7.1f} 件/km²）"
          f"  Overture {ov:>9,}  比 {ov/bv:>5.2f}  OSM/bv {osm/bv:>5.2f}  MS {oth/max(ov,1)*100:>4.1f}%")

# ---- 7. Microsoft が「どこに出るか」を OSM 密度で見る ----
print("\n=== Microsoft の寄与は OSM の薄さで決まるか（OSM 密度で層化）===")
OB = [(0, 1), (1, 5), (5, 20), (20, 80), (80, 300), (300, 1e9)]
OL = ["0–1", "1–5", "5–20", "20–80", "80–300", "300+"]
print(f"{'OSM密度(件/km²)':>16} {'セル':>7} {'Microsoft件':>12} {'Overture中のMS%':>16}")
for (lo, hi), lbl in zip(OB, OL):
    sub = [r for r in live if lo <= I(r, "ov_osm") / r["km2"] < hi]
    if not sub: continue
    ov = sum(I(r, "ov_n") for r in sub) or 1
    oth = sum(I(r, "ov_other") for r in sub)
    print(f"{lbl:>16} {len(sub):>7,} {oth:>12,} {oth/ov*100:>15.1f}%")
