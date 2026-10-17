"""Real data-centre facilities for the places in scope (Asia-Pacific), from two open sources:

- OpenStreetMap: the global extract of objects tagged as data centres (telecom=data_center and building=data_center),
  with name, operator, facility kind and building footprint. Read from scripts/.cache/osm-dc/data_centers.csv (the
  japan-data-centers project's extract; ODbL, "(c) OpenStreetMap contributors"). reported_totals.csv in the same
  folder gives each country's facility count from a commercial tracker, used only to show how complete the map is.
- PeeringDB: the facility API (keyless), with name, operator organisation, coordinates and the number of networks and
  exchanges present. PeeringDB lists interconnection sites, so most are colocation.

A PeeringDB facility within 250 m of an OpenStreetMap object with the same operator (or within 80 m of any) is
treated as the same building and merged. Nothing is estimated: there is no open source for MW, so none is given.

    python -m jobs.sources.facilities            # writes public/facilities.json (cached API answers)
    python -m jobs.sources.facilities --fresh    # asks PeeringDB again"""
import csv
import json
import re
import sys
from datetime import date

from app.settings import ROOT

from ..common import get_json, js_round, km

OSM_DIR = ROOT / "scripts" / ".cache" / "osm-dc"
OUT = ROOT / "public" / "facilities.json"
COUNTRIES = {"IN": "India", "SG": "Singapore", "MY": "Malaysia", "ID": "Indonesia", "PH": "Philippines", "TH": "Thailand",
             "CN": "China", "HK": "Hong Kong", "TW": "Taiwan", "KR": "South Korea", "JP": "Japan", "AU": "Australia",
             "NZ": "New Zealand", "VN": "Vietnam"}
SOURCES = [
    {"id": "osm-dc", "name": "OpenStreetMap: data centre buildings and sites (extract via the japan-data-centers project)",
     "url": "https://www.openstreetmap.org/copyright", "licence": "ODbL, (c) OpenStreetMap contributors",
     "used": "Real data centres: map, example sites, facilities near each place"},
    {"id": "peeringdb", "name": "PeeringDB facility API (interconnection sites, networks and exchanges present)",
     "url": "https://www.peeringdb.com/apidocs/", "licence": "PeeringDB Acceptable Use Policy (free to use)",
     "used": "Real data centres: map, example sites, facilities near each place"},
]
SEGMENTS = ["Hyperscale / cloud", "Colocation / wholesale", "Telecom carrier", "IT services", "Research / academic",
            "Financial", "Government / public", "Unclassified"]
OSM_KIND = {"hyperscale": "Hyperscale / cloud", "colocation": "Colocation / wholesale", "telecom_carrier": "Telecom carrier",
            "research_or_academic": "Research / academic", "financial": "Financial", "government_or_public": "Government / public"}
# (pattern, operator, segment): first match on operator / owner / brand / name wins.
RULES = [
    (r"\b(amazon|aws)\b", "Amazon Web Services", "Hyperscale / cloud"),
    (r"\bgoogle\b", "Google", "Hyperscale / cloud"),
    (r"\b(microsoft|azure)\b", "Microsoft", "Hyperscale / cloud"),
    (r"\b(meta|facebook)\b", "Meta", "Hyperscale / cloud"),
    (r"\b(alibaba|aliyun)\b", "Alibaba Cloud", "Hyperscale / cloud"),
    (r"\btencent\b", "Tencent", "Hyperscale / cloud"),
    (r"\bhuawei\b", "Huawei", "Hyperscale / cloud"),
    (r"\boracle\b", "Oracle", "Hyperscale / cloud"),
    (r"\bbytedance\b", "ByteDance", "Hyperscale / cloud"),
    (r"\bequinix\b", "Equinix", "Colocation / wholesale"),
    (r"\b(digital realty|interxion|mc digital realty)\b", "Digital Realty", "Colocation / wholesale"),
    (r"\bntt (east|west|docomo)\b|東日本電信電話|西日本電信電話", "NTT (carrier)", "Telecom carrier"),
    (r"\bntt\b|ntt global data cent", "NTT Data / Global Data Centers", "Colocation / wholesale"),
    (r"\b(st telemedia|stt gdc|sttelemedia|stt )", "ST Telemedia GDC", "Colocation / wholesale"),
    (r"\bkeppel\b", "Keppel Data Centres", "Colocation / wholesale"),
    (r"\bairtrunk\b", "AirTrunk", "Colocation / wholesale"),
    (r"\bnextdc\b", "NEXTDC", "Colocation / wholesale"),
    (r"\b(cdc data centres|canberra data centres)\b", "CDC Data Centres", "Colocation / wholesale"),
    (r"\bglobal switch\b", "Global Switch", "Colocation / wholesale"),
    (r"\b(princeton digital|pdg)\b", "Princeton Digital Group", "Colocation / wholesale"),
    (r"\byotta\b", "Yotta", "Colocation / wholesale"),
    (r"\bctrls\b", "CtrlS", "Colocation / wholesale"),
    (r"\bsify\b", "Sify", "Colocation / wholesale"),
    (r"\bnxtra\b", "Nxtra (Airtel)", "Colocation / wholesale"),
    (r"\biron mountain\b", "Iron Mountain", "Colocation / wholesale"),
    (r"\bvantage\b", "Vantage", "Colocation / wholesale"),
    (r"\bstack infrastructure|\bstack\b", "STACK", "Colocation / wholesale"),
    (r"\bchindata\b", "Chindata", "Colocation / wholesale"),
    (r"\bgds\b", "GDS", "Colocation / wholesale"),
    (r"\bbridge data cent", "Bridge Data Centres", "Colocation / wholesale"),
    (r"\bdci indonesia\b", "DCI Indonesia", "Colocation / wholesale"),
    (r"\bspace dc\b", "Space DC", "Colocation / wholesale"),
    (r"\b(telehouse)\b", "Telehouse (KDDI)", "Colocation / wholesale"),
    (r"\bidc frontier\b", "IDC Frontier", "Colocation / wholesale"),
    (r"\bat tokyo\b", "AT TOKYO", "Colocation / wholesale"),
    (r"\bsakura internet\b|さくらインターネット", "Sakura Internet", "Colocation / wholesale"),
    (r"\bcolt\b", "Colt DCS", "Colocation / wholesale"),
    (r"\bmacquarie\b", "Macquarie Data Centres", "Colocation / wholesale"),
    (r"\bvitro\b|\beepldt\b|\beplDT\b", "ePLDT / VITRO", "Colocation / wholesale"),
    (r"\btata communications\b", "Tata Communications", "Telecom carrier"),
    (r"\b(telstra)\b", "Telstra", "Telecom carrier"),
    (r"\b(optus)\b", "Optus", "Telecom carrier"),
    (r"\b(tpg|vocus)\b", "TPG / Vocus", "Telecom carrier"),
    (r"\b(spark|chorus)\b", "Spark / Chorus", "Telecom carrier"),
    (r"\b(singtel|starhub)\b", "Singtel / StarHub", "Telecom carrier"),
    (r"\bkddi\b", "KDDI", "Telecom carrier"),
    (r"\bsoftbank\b", "SoftBank", "Telecom carrier"),
    (r"\bchunghwa\b", "Chunghwa Telecom", "Telecom carrier"),
    (r"\b(kt|sk broadband|sk telecom|lg u\+)\b", "Korean carriers (KT, SK, LG U+)", "Telecom carrier"),
    (r"\b(bharti|airtel)\b", "Bharti Airtel", "Telecom carrier"),
    (r"\b(reliance|jio)\b", "Reliance Jio", "Telecom carrier"),
    (r"\bbsnl\b", "BSNL", "Telecom carrier"),
    (r"\b(pldt|globe telecom)\b", "PLDT / Globe", "Telecom carrier"),
    (r"\b(telkom|telkomsel|indosat)\b", "Telkom / Indosat", "Telecom carrier"),
    (r"\b(viettel|vnpt)\b", "Viettel / VNPT", "Telecom carrier"),
    (r"\bfpt\b", "FPT", "IT services"),
    (r"\bchina (telecom|unicom|mobile)\b|中国电信|中国联通|中国移动", "China Telecom / Unicom / Mobile", "Telecom carrier"),
    (r"\b(hkt|pccw)\b", "HKT / PCCW", "Telecom carrier"),
    (r"\b(telekom malaysia|tm one)\b", "Telekom Malaysia", "Telecom carrier"),
    (r"\b(true idc|ais|cat telecom)\b", "Thai carriers (True, AIS, CAT)", "Telecom carrier"),
    (r"\b(fujitsu|nec|hitachi|ibm|tcs|infosys|wipro)\b", None, "IT services"),
]
RULES = [(re.compile(p, re.I), o, s) for p, o, s in RULES]


def _infer(*texts):
    t = " | ".join(x for x in texts if x)
    for rx, op, seg in RULES:
        if rx.search(t):
            return op, seg
    return None, None


def _f(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _tokens(s):
    return {w for w in re.findall(r"[a-z0-9]{3,}", (s or "").lower())} - {"data", "center", "centre", "centers", "centres", "ltd", "inc", "the", "and", "pte", "limited", "corporation", "group", "global"}


def load_osm():
    path = OSM_DIR / "data_centers.csv"
    if not path.exists():
        rows = _osm_from_bigquery()
        if rows is not None:
            return rows
        raise SystemExit(f"Missing {path}: copy data/data_centers.csv from the japan-data-centers project there "
                         "(or set GOOGLE_CLOUD_PROJECT to read OpenStreetMap from BigQuery instead).")
    out = []
    for r in csv.DictReader(path.open(encoding="utf-8-sig")):
        cc = r["country_iso2"]
        lat, lon = _f(r["latitude"]), _f(r["longitude"])
        if cc not in COUNTRIES or lat is None or lon is None:
            continue
        op_raw = r["operator"] or r["owner"] or r["brand"] or ""
        op, seg = _infer(r["operator"], r["owner"], r["brand"], r["name"], r["name_en"])
        kind = OSM_KIND.get(r["facility_kind"])
        out.append({"id": f"osm:{r['osm_type']}/{r['osm_id']}", "src": ["osm-dc"], "n": r["name_en"] or r["name"] or "",
                    "op": op or op_raw or "", "seg": kind or seg or "Unclassified", "lat": round(lat, 5), "lon": round(lon, 5),
                    "cc": cc, "city": r["city"] or "", "fp": js_round(_f(r["footprint_area_m2"])) if _f(r["footprint_area_m2"]) else None,
                    "lv": r["building_levels"] or None, "since": r["start_date"] or None, "web": r["website"] or None,
                    "osm": r["osm_url"], "edited": r["osm_last_edited"] or None})
    return out


# OpenStreetMap from BigQuery's public planet copy, used only when the japan-data-centers extract above is missing.
# Same tags (telecom=data_center, building=data_center) and the same fields; the country comes from Overture Maps'
# country boundaries, also on BigQuery. That extract also adds its own facility kind, which OpenStreetMap doesn't have,
# so here the type comes from the operator rules alone. The extract stays first so the published map doesn't change.
OSM_SQL = """
WITH dc AS (
  SELECT feature_type, osm_id, osm_way_id, osm_timestamp, all_tags, geometry, ST_CENTROID(geometry) AS c
  FROM `bigquery-public-data.geo_openstreetmap.planet_features`
  WHERE EXISTS (SELECT 1 FROM UNNEST(all_tags) t WHERE t.value = 'data_center' AND t.key IN ('telecom', 'building'))),
countries AS (
  SELECT country, geometry FROM `bigquery-public-data.overture_maps.division_area`
  WHERE subtype = 'country' AND country IN UNNEST(@ccs))
SELECT dc.feature_type, dc.osm_id, dc.osm_way_id, DATE(dc.osm_timestamp) AS edited, k.country AS cc,
  ST_Y(dc.c) AS lat, ST_X(dc.c) AS lon, IF(ST_DIMENSION(dc.geometry) = 2, ST_AREA(dc.geometry), NULL) AS area,
  (SELECT value FROM UNNEST(all_tags) WHERE key = 'name' LIMIT 1) AS name,
  (SELECT value FROM UNNEST(all_tags) WHERE key = 'name:en' LIMIT 1) AS name_en,
  (SELECT value FROM UNNEST(all_tags) WHERE key = 'operator' LIMIT 1) AS operator,
  (SELECT value FROM UNNEST(all_tags) WHERE key = 'owner' LIMIT 1) AS owner,
  (SELECT value FROM UNNEST(all_tags) WHERE key = 'brand' LIMIT 1) AS brand,
  (SELECT value FROM UNNEST(all_tags) WHERE key = 'addr:city' LIMIT 1) AS city,
  (SELECT value FROM UNNEST(all_tags) WHERE key = 'building:levels' LIMIT 1) AS levels,
  (SELECT value FROM UNNEST(all_tags) WHERE key = 'start_date' LIMIT 1) AS start_date,
  (SELECT value FROM UNNEST(all_tags) WHERE key = 'website' LIMIT 1) AS website
FROM dc JOIN countries k ON ST_INTERSECTS(dc.c, k.geometry)"""


def _osm_from_bigquery():
    from ..bq import enabled, rows
    if not enabled():
        return None
    from google.cloud import bigquery
    res = rows(OSM_SQL, "OpenStreetMap data centres", [bigquery.ArrayQueryParameter("ccs", "STRING", list(COUNTRIES))])
    if res is None:
        return None
    out = []
    for r in res:
        if r["cc"] not in COUNTRIES or r["lat"] is None or r["lon"] is None:
            continue
        kind, oid = ("way", r["osm_way_id"]) if r["osm_way_id"] else ("node", r["osm_id"]) if r["feature_type"] == "points" else ("relation", r["osm_id"])
        op, seg = _infer(r["operator"], r["owner"], r["brand"], r["name"], r["name_en"])
        area = _f(r["area"])
        out.append({"id": f"osm:{kind}/{oid}", "src": ["osm-dc"], "n": r["name_en"] or r["name"] or "",
                    "op": op or r["operator"] or r["owner"] or r["brand"] or "", "seg": seg or "Unclassified",
                    "lat": round(r["lat"], 5), "lon": round(r["lon"], 5), "cc": r["cc"], "city": r["city"] or "",
                    "fp": js_round(area) if area else None, "lv": r["levels"] or None, "since": r["start_date"] or None,
                    "web": r["website"] or None, "osm": f"https://www.openstreetmap.org/{kind}/{oid}",
                    "edited": r["edited"].isoformat() if r["edited"] else None})
    SOURCES[0]["name"] = "OpenStreetMap: data centre buildings and sites (BigQuery public dataset geo_openstreetmap; countries from Overture Maps)"
    print(f"OpenStreetMap read from BigQuery: {len(out)} data centres in scope", flush=True)
    return out


def load_pdb():
    out = []
    for cc in COUNTRIES:
        j = get_json(f"https://www.peeringdb.com/api/fac?country={cc}&status=ok", gap_s=4)
        for x in j.get("data") or []:
            lat, lon = _f(x.get("latitude")), _f(x.get("longitude"))
            if lat is None or lon is None or (lat == 0 and lon == 0):
                continue
            op, seg = _infer(x.get("org_name"), x.get("name"))
            out.append({"id": f"pdb:{x['id']}", "src": ["peeringdb"], "n": x.get("name") or "", "op": op or x.get("org_name") or "",
                        "seg": seg if seg in ("Hyperscale / cloud", "Telecom carrier") else "Colocation / wholesale",
                        "lat": round(lat, 5), "lon": round(lon, 5), "cc": cc, "city": x.get("city") or "", "fp": None,
                        "nets": int(x.get("net_count") or 0), "ix": int(x.get("ix_count") or 0), "web": x.get("website") or None,
                        "pdb": f"https://www.peeringdb.com/fac/{x['id']}", "edited": (x.get("updated") or "")[:10] or None})
    return out


def merge(osm, pdb):
    used = set()
    for p in pdb:
        best = None
        for i, o in enumerate(osm):
            if abs(o["lat"] - p["lat"]) > 0.01 or abs(o["lon"] - p["lon"]) > 0.01:
                continue
            d = km(o["lat"], o["lon"], p["lat"], p["lon"])
            same_op = bool(_tokens(o["op"] + " " + o["n"]) & _tokens(p["op"] + " " + p["n"]))
            if d <= 0.08 or (d <= 0.25 and same_op):
                if best is None or d < best[0]:
                    best = (d, i)
        if best and best[1] not in used:
            o = osm[best[1]]
            used.add(best[1])
            o["src"] = ["osm-dc", "peeringdb"]
            o["pdb"], o["nets"], o["ix"] = p["pdb"], p["nets"], p["ix"]
            if not o["n"]:
                o["n"] = p["n"]
            if not o["op"]:
                o["op"] = p["op"]
            if o["seg"] == "Unclassified":
                o["seg"] = p["seg"]
            p["merged"] = True
    return osm + [p for p in pdb if not p.get("merged")]


def reported():
    path = OSM_DIR / "reported_totals.csv"
    best = {}
    if path.exists():
        for r in csv.DictReader(path.open(encoding="utf-8-sig")):
            cc = r["country_iso2"]
            if cc in COUNTRIES and (cc not in best or r["as_of"] > best[cc]["as_of"]):
                best[cc] = {"n": int(float(r["reported_facilities"])), "as_of": r["as_of"], "tracker": r["tracker"],
                            "by": r["published_by"], "url": r["source_url"]}
    return best


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    hz = json.loads((ROOT / "public" / "hazards.json").read_text(encoding="utf-8"))["hubs"]
    meta = json.loads(re.search(r"window\.ATLAS_MAP=(\{.*\});?\s*$", (ROOT / "public" / "data.js").read_text(encoding="utf-8"), re.S).group(1))
    hubs = [(h["id"], hz[h["id"]]["lat"], hz[h["id"]]["lon"]) for h in meta["hubs"] if h["r"] == "Asia-Pacific" and h["id"] in hz]
    osm, pdb = load_osm(), load_pdb()
    print(f"OpenStreetMap: {len(osm)} in scope · PeeringDB: {len(pdb)} with coordinates")
    fac = merge(osm, pdb)
    for f in fac:
        near = min(((km(f["lat"], f["lon"], la, lo), hid) for hid, la, lo in hubs), default=None)
        if near and near[0] <= 50:
            f["hub"], f["km"] = near[1], js_round(near[0], 1)
        if not f["n"]:
            f["n"] = "Unnamed data centre"
    rep = reported()
    cov = {}
    for cc, name in COUNTRIES.items():
        rows = [f for f in fac if f["cc"] == cc]
        cov[cc] = {"name": name, "mapped": len(rows), "osm": sum("osm-dc" in f["src"] for f in rows),
                   "pdb": sum("peeringdb" in f["src"] for f in rows), "both": sum(len(f["src"]) == 2 for f in rows),
                   "reported": rep.get(cc)}
    fac.sort(key=lambda f: (f["cc"], f["n"]))
    osm_date = max((f["edited"] for f in fac if "osm-dc" in f["src"] and f["edited"]), default=None)
    doc = {"generated": date.today().isoformat(), "osmLatestEdit": osm_date, "sources": SOURCES, "segments": SEGMENTS,
           "coverage": cov, "facilities": fac}
    OUT.write_text(json.dumps(doc, ensure_ascii=False, separators=(",", ":")), encoding="utf-8", newline="\n")
    print(f"Wrote {OUT.name}: {len(fac)} facilities ({sum(len(f['src']) == 2 for f in fac)} in both sources), {OUT.stat().st_size // 1024} KB")
    for cc, c in cov.items():
        r = c["reported"]
        print(f"  {cc} {c['name']:12} mapped {c['mapped']:4}  osm {c['osm']:4}  pdb {c['pdb']:4}  both {c['both']:3}  reported {r['n'] if r else '-'}")


if __name__ == "__main__":
    main()
