"""国土数値情報 A09（都市地域＝都市計画区域）を z14 セルの被覆率に落とす。

A09 第4.0版は「都市計画法で指定する都市計画区域を都市地域とみなし作成」と
データ概要に明記されている（D30）。細区分は入れ子なので、layer_no を見ずに
全ポリゴンの和を取れば区域になる。

A09 は再配布しないのでリポジトリには置かない。下の KSJ に展開しておくこと：
  https://nlftp.mlit.go.jp/ksj/gml/data/A09/A09-18/A09-18_01_GML.zip
"""
import glob, json, math, os
from collections import defaultdict

KSJ = "/Volumes/Migrate-2025-04/doverture-tilecache/ksj/A09-18_01/A09-18_01_GML/GeoJSON"
Z = 14
N = 1 << Z
SUB = 4                     # セルを SUB×SUB 点で標本化する

def lon2x(lon): return (lon + 180.0) / 360.0 * N
def lat2y(lat):
    r = math.radians(lat)
    return (1 - math.log(math.tan(r) + 1 / math.cos(r)) / math.pi) / 2 * N

def load(ksj=KSJ):
    """(feats, bucket) を返す。feats は [(bbox, rings)]、bucket は z14セル -> [索引]。"""
    files = sorted(glob.glob(os.path.join(ksj, "*.geojson")))
    assert files, f"A09 が見つからない: {ksj}"
    feats = []
    for path in files:
        for ft in json.load(open(path))["features"]:
            g = ft["geometry"]
            polys = [g["coordinates"]] if g["type"] == "Polygon" else g["coordinates"]
            for poly in polys:
                rings = [[(lon2x(p[0]), lat2y(p[1])) for p in ring] for ring in poly]
                xs = [p[0] for r in rings for p in r]; ys = [p[1] for r in rings for p in r]
                feats.append(((min(xs), min(ys), max(xs), max(ys)), rings))
    bucket = defaultdict(list)
    for i, (bb, _) in enumerate(feats):
        for cx in range(int(bb[0]), int(bb[2]) + 1):
            for cy in range(int(bb[1]), int(bb[3]) + 1):
                bucket[(cx, cy)].append(i)
    return feats, bucket, len(files)

def _inside(px, py, rings):
    """偶奇規則。穴（内環）もそのまま扱える。"""
    c = False
    for r in rings:
        n = len(r)
        for i in range(n):
            x0, y0 = r[i]; x1, y1 = r[(i + 1) % n]
            if (y0 > py) != (y1 > py) and px < (x1 - x0) * (py - y0) / (y1 - y0) + x0:
                c = not c
    return c

def coverage(cx, cy, feats, bucket):
    ids = bucket.get((cx, cy))
    if not ids: return 0.0
    hit = 0
    for i in range(SUB):
        px = cx + (i + 0.5) / SUB
        for j in range(SUB):
            py = cy + (j + 0.5) / SUB
            for k in ids:
                bb, rings = feats[k]
                if bb[0] <= px <= bb[2] and bb[1] <= py <= bb[3] and _inside(px, py, rings):
                    hit += 1; break
    return hit / (SUB * SUB)
