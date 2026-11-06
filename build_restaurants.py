#!/usr/bin/env python3
"""Build compact nationwide solo-dining restaurants.json from a Geofabrik Korea PBF.

혼밥 가능 여부는 amenity/cuisine/상호로 추정할 뿐, 방문 확인 값이 아니다.
사진은 해당 OSM 객체의 image/Wikimedia, 또는 같은 브랜드 위키데이터 대표 이미지.
일반 음식 파일명은 매장 사진으로 쓰지 않고 대표 이미지로만 표시한다.

Usage:
  pip install osmium
  curl -L -o /tmp/south-korea.osm.pbf https://download.geofabrik.de/asia/south-korea-latest.osm.pbf
  python3 build_restaurants.py /tmp/south-korea.osm.pbf restaurants.json
"""
import json, os, re, sys, time, urllib.parse, urllib.request
from collections import defaultdict

PBF = sys.argv[1] if len(sys.argv) > 1 else "/tmp/south-korea.osm.pbf"
OUT = sys.argv[2] if len(sys.argv) > 2 else "restaurants.json"
EXTRACT_DATE = os.environ.get("OSM_EXTRACT_DATE", "2026-11-05")
UA = "convenience-drink-app/1.0 (honbap dataset; https://kibang.github.io/convenience-drink-app/)"

CATS = ["분식/김밥", "면/라면", "덮밥/돈가스", "버거/샌드위치", "초밥", "한그릇/백반", "패스트푸드", "간편식", "푸드코트"]

HARD_EXCLUDE = re.compile(r"포차|호프|술집|소주방|와인바|맥주집|유흥|룸살롱|단란주점|노래주점|풀싸롱|성인PC|룸바")
SOFT_EXCLUDE = re.compile(
    r"삼겹|오겹|갈비살|왕갈비|생갈비|꽃갈비|LA갈비|곱창|막창|대창|육회|한우촌|고기집|고깃집|고기구이|숯불구이|바베큐|구이전문|회집|횟집|족발|보쌈|오마카세|웨딩|연회장|돌잔치|스테이크하우스",
    re.I,
)
EXCLUDE_CUISINE = re.compile(r"barbecue|korean_barbecue|\bbbq\b|yakiniku|steak_house|steakhouse|izakaya|wine_bar|buffet", re.I)
PLACEHOLDER_NAME = re.compile(r"^(restaurant|fast[\s_-]?food|food[\s_-]?court|식당|음식점|레스토랑|무명|이름없음)$", re.I)

POSITIVE = [
    (re.compile(r"김밥|분식|떡볶이|라볶이|순대국|김가네"), "분식/김밥"),
    (re.compile(r"라면|라멘|우동|국수|칼국수|냉면|쫄면|잔치국수|쌀국수|팟타이|모밀|소바|메밀|탄탄|짜장면|짬뽕|마라탕|밀면|콩국수|수제비"), "면/라면"),
    (re.compile(r"덮밥|돈까스|돈가스|돈카츠|규동|카레|가츠|오므라이스|하이라이스|함박|함바그|비빔밥|볶음밥|규카츠"), "덮밥/돈가스"),
    (re.compile(r"버거|햄버거|샌드위치|토스트|롯데리아|맘스터치|맥도날드|맥도널드|버거킹|노브랜드버거|써브웨이|서브웨이|케이에프씨|이삭"), "버거/샌드위치"),
    (re.compile(r"초밥|스시|회전초밥"), "초밥"),
    (re.compile(r"죽|국밥|해장국|설렁탕|곰탕|육개장|갈비탕|추어탕|순두부|김치찌개|된장찌개|부대찌개|백반|도시락|컵밥|주먹밥|한솥|본죽"), "한그릇/백반"),
    (re.compile(r"포케|샐러드|브리또|부리또|타코|핫도그"), "간편식"),
]
CUISINE_CAT = [
    (re.compile(r"noodle|ramen|udon|soba|pho|vietnamese", re.I), "면/라면"),
    (re.compile(r"sushi", re.I), "초밥"),
    (re.compile(r"burger|sandwich|hot_dog|kebab|fried_chicken|chicken|pizza|taco|burrito", re.I), "패스트푸드"),
    (re.compile(r"curry|donburi|gyudon|katsu|cutlet", re.I), "덮밥/돈가스"),
    (re.compile(r"porridge|juk|gukbap|bibimbap", re.I), "한그릇/백반"),
    (re.compile(r"cafeteria", re.I), "패스트푸드"),
    (re.compile(r"korean|bunsik|tteokbokki|kimbap", re.I), None),  # name must still match
]
GENERIC_FOOD = re.compile(
    r"(kimchi|bibimbap|ramen|noodle|tteokbokki|ddukbokki|kimbap|gimbap|sushi|sashimi|pizza|hamburger|burger|fried.?chicken|korean.?food|korean.?cuisine|food|dish|meal|jjigae|stew|bulgogi|samgyeopsal|galbi|barbecue|coffee|latte|pasta|cake|bread|soup|한식|음식|요리|김밥|라면|피자|버거|떡볶이|초밥)",
    re.I,
)
STOP_BRANDS = {"식당", "음식점", "레스토랑", "치킨", "피자", "카페", "분식", "국수", "김밥", "restaurant", "fast_food", "cafe"}


def cat_of(name, amenity, cuisine):
    if not name or PLACEHOLDER_NAME.match(name):
        return None
    if HARD_EXCLUDE.search(name):
        return None
    cat = None
    for rx, c in POSITIVE:
        if rx.search(name):
            cat = c
            break
    if cat is None:
        for rx, c in CUISINE_CAT:
            if c and rx.search(cuisine or ""):
                cat = c
                break
    soft = bool(SOFT_EXCLUDE.search(name) or EXCLUDE_CUISINE.search(cuisine or ""))
    if amenity == "fast_food" and cat is None and not soft:
        cat = "패스트푸드"
    if amenity == "food_court" and cat is None and not soft:
        cat = "푸드코트"
    if soft and cat is None:
        return None
    if cat is None:
        return None
    return cat


def commons_special(filename):
    filename = urllib.parse.unquote(filename).split("?")[0].split("#")[0].strip()
    if filename.lower().startswith("file:"):
        filename = filename[5:]
    filename = filename.replace(" ", "_")
    if not filename or filename.lower().startswith("category:"):
        return None
    return "https://commons.wikimedia.org/wiki/Special:FilePath/" + urllib.parse.quote(filename)


def to_direct(raw):
    if not raw:
        return None
    url = raw.strip()
    low = url.lower()
    if low.startswith("file:"):
        return commons_special(url)
    m = re.search(r"commons\.wikimedia\.org/(?:wiki/)?(?:Special:FilePath/|File:)([^?#]+)", url, re.I)
    if m:
        return commons_special(urllib.parse.unquote(m.group(1)))
    m = re.search(r"wikipedia\.org/wiki/(?:File:|Special:FilePath/)([^?#]+)", url, re.I)
    if m:
        return commons_special(urllib.parse.unquote(m.group(1)))
    m = re.search(r"upload\.wikimedia\.org/wikipedia/commons/[^/]+/[^/]+/([^/?#]+)", url, re.I)
    if m:
        return commons_special(urllib.parse.unquote(m.group(1)))
    if low.startswith("http://") or low.startswith("https://"):
        return url.split("#")[0]
    return None


def looks_generic(url, name):
    path = urllib.parse.unquote(url.split("?")[0])
    base = path.split("/")[-1]
    # Logos are brand marks, not dish photos, even if the filename contains "burger".
    if re.search(r"logo|wordmark|icon|symbol|brandmark|slogan", base, re.I):
        return False
    tokens = re.findall(r"[가-힣]{2,}|[A-Za-z0-9]{4,}", name or "")
    blob = base.lower()
    if any(t.lower() in blob for t in tokens):
        return False
    return bool(GENERIC_FOOD.search(base))


def photo_from_tags(tags, name):
    raw = None
    for key in ("image", "image:url", "wikimedia_commons", "image:commons"):
        if tags.get(key):
            raw = tags[key]
            break
    url = to_direct(raw) if raw else None
    if not url:
        return None, 0
    if looks_generic(url, name):
        return url, 3
    return url, 1


def tagdict(tags):
    out = {}
    for k in ("name", "name:ko", "name:en", "brand", "amenity", "cuisine", "image", "image:url", "wikimedia_commons", "image:commons", "wikidata", "brand:wikidata"):
        v = tags.get(k)
        if v:
            out[k] = v
    return out


def collect(pbf):
    import osmium
    filt = osmium.filter.TagFilter(("amenity", "restaurant"), ("amenity", "fast_food"), ("amenity", "food_court"))
    fp = osmium.FileProcessor(pbf).with_locations("sparse_file_array,/tmp/osm-node-locs.idx").with_filter(filt)
    rows = []
    seen_obj = 0
    for o in fp:
        seen_obj += 1
        if seen_obj % 20000 == 0:
            print(f"  scanned {seen_obj} food objects, kept {len(rows)}", flush=True)
        tags = tagdict(o.tags)
        amenity = tags.get("amenity")
        if amenity not in ("restaurant", "fast_food", "food_court"):
            continue
        name = (tags.get("name:ko") or tags.get("name") or tags.get("brand") or tags.get("name:en") or "").strip()
        name = re.sub(r"\s+", " ", name)[:80]
        cat = cat_of(name, amenity, tags.get("cuisine") or "")
        if not cat:
            continue
        if o.is_node():
            if not o.location.valid():
                continue
            lat, lon = o.location.lat, o.location.lon
        elif o.is_way():
            lats, lons = [], []
            for nd in o.nodes:
                if nd.location.valid():
                    lats.append(nd.location.lat)
                    lons.append(nd.location.lon)
            if not lats:
                continue
            lat = sum(lats) / len(lats)
            lon = sum(lons) / len(lons)
        else:
            continue
        if not (33.0 <= lat <= 39.6 and 124.0 <= lon <= 132.1):
            continue
        img, kind = photo_from_tags(tags, name)
        wd = tags.get("wikidata") or ""
        bwd = tags.get("brand:wikidata") or ""
        if not re.fullmatch(r"Q\d+", wd):
            wd = ""
        if not re.fullmatch(r"Q\d+", bwd):
            bwd = ""
        brand = (tags.get("brand") or "").strip()
        rows.append({
            "lat": round(lat, 5),
            "lon": round(lon, 5),
            "cat": cat,
            "name": name,
            "img": img,
            "kind": kind if img else 0,
            "wd": wd,
            "bwd": bwd,
            "brand": brand,
        })
    print(f"scan done objects={seen_obj} kept={len(rows)}", flush=True)
    return rows


def dedupe(rows):
    best = {}
    for r in rows:
        key = (round(r["lat"], 4), round(r["lon"], 4), r["name"])
        old = best.get(key)
        if old is None or (r["kind"] == 1 and old["kind"] != 1) or (old["kind"] == 0 and r["kind"]):
            best[key] = r
    return list(best.values())


def wd_claims(ids):
    """Return {qid: (p18_filename or '', p154_filename or '')}."""
    out = {}
    ids = sorted(set(ids))
    cache_path = "/tmp/wd-food-cache.json"
    cache = {}
    if os.path.exists(cache_path):
        cache = json.load(open(cache_path, encoding="utf-8"))
    missing = [i for i in ids if i not in cache]
    print(f"wikidata ids={len(ids)} cached={len(ids)-len(missing)} fetch={len(missing)}", flush=True)
    for i in range(0, len(missing), 40):
        batch = missing[i:i+40]
        qs = urllib.parse.urlencode({
            "action": "wbgetentities",
            "ids": "|".join(batch),
            "props": "claims",
            "format": "json",
        })
        req = urllib.request.Request("https://www.wikidata.org/w/api.php?" + qs, headers={"User-Agent": UA})
        try:
            with urllib.request.urlopen(req, timeout=40) as resp:
                data = json.loads(resp.read().decode())
        except Exception as e:
            print("wikidata batch failed", e, flush=True)
            time.sleep(2)
            continue
        ents = data.get("entities") or {}
        for qid, ent in ents.items():
            claims = ent.get("claims") or {}
            def first(prop):
                for c in claims.get(prop) or []:
                    dv = ((c.get("mainsnak") or {}).get("datavalue") or {})
                    if dv.get("type") == "string" and isinstance(dv.get("value"), str):
                        return dv["value"]
                return ""
            cache[qid] = [first("P18"), first("P154")]
        for qid in batch:
            cache.setdefault(qid, ["", ""])
        json.dump(cache, open(cache_path, "w", encoding="utf-8"), ensure_ascii=False)
        time.sleep(0.3)
        if (i // 40) % 10 == 0:
            print(f"  wikidata {min(i+40, len(missing))}/{len(missing)}", flush=True)
    for qid in ids:
        p18, p154 = cache.get(qid, ["", ""])
        out[qid] = (p18, p154)
    return out


def brand_choice(p18, p154):
    """Brand wikidata is never a photo of this specific shop."""
    logo = commons_special(p154) if p154 else None
    photo = commons_special(p18) if p18 else None
    if logo:
        return logo, 2
    if photo and looks_generic(photo, ""):
        return photo, 3
    if photo:
        return photo, 2
    return None, 0


def apply_images(rows):
    info = wd_claims([r["wd"] for r in rows if r["wd"]] + [r["bwd"] for r in rows if r["bwd"]])
    brand_img = {}  # exact brand/name key -> (url, kind)

    def consider_brand(key, url, kind):
        key = key.strip()
        if not key or key.lower() in STOP_BRANDS or len(key) < 2:
            return
        if kind not in (2, 3) or not url:
            return
        prev = brand_img.get(key)
        if prev is None or (kind == 2 and prev[1] != 2):
            brand_img[key] = (url, kind)

    for r in rows:
        # Wikidata images belong to a brand or some other branch, never "this shop's photo".
        if r["wd"] and r["kind"] != 1:
            p18, p154 = info.get(r["wd"], ("", ""))
            chosen, chosen_kind = brand_choice(p18, p154)
            if chosen and (r["kind"] == 0 or chosen_kind < r["kind"]):
                r["img"], r["kind"] = chosen, chosen_kind
            if r["img"] and r["kind"] in (2, 3):
                consider_brand(r["brand"], r["img"], r["kind"])
                base = re.split(r"\s+", r["name"])[0]
                consider_brand(base, r["img"], r["kind"])
        if r["kind"] != 1 and r["bwd"]:
            p18, p154 = info.get(r["bwd"], ("", ""))
            chosen, chosen_kind = brand_choice(p18, p154)
            if chosen and (r["kind"] == 0 or chosen_kind < r["kind"]):
                r["img"], r["kind"] = chosen, chosen_kind
            if r["img"] and r["kind"] in (2, 3):
                consider_brand(r["brand"], r["img"], r["kind"])
                base = re.split(r"\s+", r["name"])[0]
                consider_brand(base, r["img"], r["kind"])

    # Careful propagation: only exact brand tag or name that equals / starts with a known brand key.
    keys = sorted(brand_img, key=len, reverse=True)
    applied = 0
    for r in rows:
        if r["kind"] in (1, 2):
            continue
        hit = None
        if r["brand"] and r["brand"] in brand_img:
            hit = r["brand"]
        else:
            for k in keys:
                if len(k) < 2:
                    continue
                if r["name"] == k or r["name"].startswith(k + " ") or r["name"].startswith(k + "점"):
                    hit = k
                    break
        if not hit:
            continue
        url, kind = brand_img[hit]
        # Only reuse a non-generic brand image. Do not copy a food stock photo onto other shops.
        if kind != 2:
            continue
        if r["kind"] == 0:
            r["img"], r["kind"] = url, 2
            applied += 1
    print(f"brand keys={len(brand_img)} propagated={applied}", flush=True)
    return rows


def main():
    print("reading", PBF, flush=True)
    rows = dedupe(collect(PBF))
    print("deduped", len(rows), flush=True)
    rows = apply_images(rows)
    cat_index = {c: i for i, c in enumerate(CATS)}
    compact = []
    kinds = defaultdict(int)
    cats = defaultdict(int)
    for r in rows:
        kinds[r["kind"]] += 1
        cats[r["cat"]] += 1
        row = [r["lat"], r["lon"], cat_index[r["cat"]], r["name"]]
        if r["img"] and r["kind"]:
            row.extend([r["img"], r["kind"]])
        compact.append(row)
    compact.sort(key=lambda x: (x[0], x[1], x[3]))
    payload = {
        "updated": EXTRACT_DATE,
        "built": "2026-11-06",
        "src": "OpenStreetMap (ODbL), Geofabrik south-korea extract",
        "scope": "대한민국 전국",
        "scopeNote": "실시간 Overpass 대신 Geofabrik 대한민국 추출본을 묶어 두었습니다. 편의점 매장과 같이 일부 누락이 있을 수 있습니다.",
        "honbap": "혼밥 가능 여부는 업태(restaurant/fast_food/food_court)·요리(cuisine)·상호 키워드로 추정한 것이며, 매장에 확인하거나 방문 검증한 값이 아닙니다.",
        "photoNote": "kind 1은 그 식당 OSM 객체의 image/Wikimedia 태그만. 대한민국 추출본의 혼밥 추정 식당에는 이 태그가 거의 없습니다. kind 2는 브랜드 위키데이터 로고·대표 이미지(이 매장 사진 아님), kind 3은 일반 음식 대표 이미지(이 매장 사진 아님). 없는 곳은 사진을 만들지 않습니다.",
        "count": len(compact),
        "photos": {"business": kinds[1], "brand": kinds[2], "generic": kinds[3], "none": kinds[0]},
        "cats": CATS,
        "catCounts": dict(cats),
        "r": compact,
    }
    json.dump(payload, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    size = os.path.getsize(OUT)
    print("wrote", OUT, "count", len(compact), "bytes", size)
    print("photos", dict(kinds))
    print("cats", dict(cats))

    def near(lat, lon, rad=2000):
        n = 0
        ph = defaultdict(int)
        for r in rows:
            dy = (r["lat"] - lat) * 111000
            dx = (r["lon"] - lon) * 88000
            if (dy * dy + dx * dx) ** 0.5 <= rad:
                n += 1
                ph[r["kind"]] += 1
        return n, dict(ph)
    print("city hall 2km", near(37.5663, 126.9779))
    print("arirang 2km", near(37.6012361, 127.0088198))
    print("city hall 1km", near(37.5663, 126.9779, 1000))
    print("arirang 1km", near(37.6012361, 127.0088198, 1000))
    print("--- image samples ---")
    shown = {1: 0, 2: 0, 3: 0}
    for r in rows:
        if shown.get(r["kind"], 9) >= 6:
            continue
        if r["kind"] in shown:
            print(r["kind"], r["name"], r["brand"], r["img"])
            shown[r["kind"]] += 1


if __name__ == "__main__":
    main()
