# /// script
# requires-python = ">=3.10"
# dependencies = ["mapbox-vector-tile"]
# ///
"""bvmap の取得精度（1:2,500 相当か、それより粗いか）をセル単位で検知する。

**検知子：セルごとの bvmap 建物面積の下位5%（p5）＝「床」。**

1:2,500 由来なら物置・車庫まで拾うので床は数m²。粗い取得（総描）なら一定以下が
存在せず、床が 100m² 前後に立つ。

この指標に辿り着くまでに外した仮説（DECISIONS.md D28）：

- **形（頂点数・矩形度・直角率）は使えない。** 総描なら矩形が増えると踏んだが逆だった。
  市街地の住宅こそ箱型で、農村の畜舎・倉庫の方が形が多様。建物の種類に交絡する
- **bvmap 単独の小建物率も弱い。** 実際の建物構成と交絡する。同じセルの OSM を
  対照群に取ると交絡が切れる（OSM の小建物率はどの密度でもほぼ一定 21〜32%）

床が効くのは、**密度と独立だから**。同じ密度帯（10–30件/km²）の中で p10 の 12m² から
p90 の 127m² まで散らばる。

前提：キャッシュ済みの bvmap z16 タイルを読む（scripts/build_tiles.sh の副産物。
z16 でなければならない——z14/z15 は tippecanoe で間引かれている、D2）。
タイルは -S 2 を通っているが z16・緯度43°で許容差約0.21m、面積の床には効かない。
"""
import csv, json, math, os, random
from collections import Counter
import mapbox_vector_tile as mvt
ROOT="/Volumes/Migrate-2025-04/github/doverture"; CACHE="/Volumes/Migrate-2025-04/doverture-tilecache"
rows=list(csv.DictReader(open(f"{ROOT}/data/hokkaido-z14-census.csv")))
names=json.load(open(f"{ROOT}/data/hokkaido-z14-cells.json"))["municipalities"]
def y2lat(y,z=14):
    n=math.pi-2*math.pi*y/(1<<z); return math.degrees(math.atan(0.5*(math.exp(n)-math.exp(-n))))
def km2(y):
    s=40075016.686*math.cos(math.radians(y2lat(int(y)+0.5)))/(1<<14); return s*s/1e6
def parea(c):
    a=0.0
    for i in range(len(c)):
        x0,y0=c[i][0],c[i][1]; x1,y1=c[(i+1)%len(c)][0],c[(i+1)%len(c)][1]; a+=x0*y1-x1*y0
    return abs(a)/2
def cen(c):
    a=cx=cy=0.0; n=len(c)
    for i in range(n):
        x0,y0=c[i][0],c[i][1]; x1,y1=c[(i+1)%n][0],c[(i+1)%n][1]
        k=x0*y1-x1*y0; a+=k; cx+=(x0+x1)*k; cy+=(y0+y1)*k
    if a==0: return sum(p[0] for p in c)/n, sum(p[1] for p in c)/n
    return cx/(3*a),cy/(3*a)
def outer(g):
    t,c=g["type"],g["coordinates"]
    return c[0] if t=="Polygon" else (max(c,key=lambda p:len(p[0]))[0] if t=="MultiPolygon" else None)
def rd(p):
    if not os.path.exists(p) or os.path.getsize(p)==0: return None
    try: return mvt.decode(open(p,"rb").read())
    except Exception: return None

live=[r for r in rows if int(r["bvmap_n"])>=40]
random.seed(11); random.shuffle(live); SAMPLE=live[:2500]
out=[]
for r in SAMPLE:
    x,y=int(r["x"]),int(r["y"]); lat=y2lat(y+0.5)
    mpu=40075016.686*math.cos(math.radians(lat))/(2**16)/4096
    A=[]
    for dx in range(4):
        for dy in range(4):
            d=rd(f"{CACHE}/bvmap/16/{x*4+dx}/{y*4+dy}.mvt")
            if not d or "BldA" not in d: continue
            e=d["BldA"]["extent"]
            for f in d["BldA"]["features"]:
                rg=outer(f["geometry"])
                if not rg: continue
                cx,cy=cen(rg)
                if 0<=cx<e and 0<=cy<e: A.append(parea(rg)*mpu*mpu)
    if len(A)<40: continue
    A.sort()
    out.append({"x":x,"y":y,"code":r["code"],"dens":len(A)/km2(y),"n":len(A),
                "p1":A[max(0,len(A)//100)], "p5":A[len(A)//20], "p25":A[len(A)//4]})
print(f"計測セル {len(out):,}（bvmap 40件以上）\n")

print("=== p5（下位5%の建物面積）の分布 ===")
p5=sorted(o["p5"] for o in out)
for q in (0,.1,.25,.5,.75,.9,1.0):
    print(f"  p{int(q*100):>3}: {p5[min(int(q*(len(p5)-1)),len(p5)-1)]:6.0f} m²")
H=[(0,20),(20,40),(40,60),(60,80),(80,120),(120,1e9)]
print("\n=== p5 の階級ごとに、密度と件数を見る（床が密度と無関係なら別の要因） ===")
print(f"{'p5(m²)':>10} {'セル':>6} {'中央密度':>9} {'平均p1':>8} {'平均p25':>8}")
for lo,hi in H:
    s=[o for o in out if lo<=o["p5"]<hi]
    if not s: continue
    dn=sorted(o["dens"] for o in s)
    lbl = f"{lo}–" + ("" if hi>1e8 else str(hi))
    print(f"{lbl:>10} {len(s):>6} {dn[len(dn)//2]:>9.1f} "
          f"{sum(o['p1'] for o in s)/len(s):>7.0f} {sum(o['p25'] for o in s)/len(s):>7.0f}")

print("\n=== 同じ密度帯（10–30件/km²）の中で p5 がどれだけ散らばるか ===")
s=[o for o in out if 10<=o["dens"]<30]
v=sorted(o["p5"] for o in s)
print(f"  該当 {len(s)} セル  p10 {v[len(v)//10]:.0f} / 中央 {v[len(v)//2]:.0f} / p90 {v[9*len(v)//10]:.0f} m²")
print("  → 密度が同じでも床が大きく違うなら、密度では説明できない")

print("\n=== 床が高い市区町村（p5 の中央値、5セル以上） ===")
mu={}
for o in out: mu.setdefault(o["code"],[]).append(o["p5"])
rank=sorted(((sorted(v)[len(v)//2], c, len(v)) for c,v in mu.items() if len(v)>=5), reverse=True)
for m,c,n in rank[:8]: print(f"  {names.get(c,c):10s} p5中央 {m:5.0f} m²  ({n}セル)")
print("  ---")
for m,c,n in rank[-6:]: print(f"  {names.get(c,c):10s} p5中央 {m:5.0f} m²  ({n}セル)")
json.dump(out, open("floor.json","w"))
