"""Tropical cyclones from NOAA IBTrACS (storm tracks since 1980), measured history only.
Per hub (in the overall score with equal weight): distinct storms that passed within 150 km at tropical-storm strength (34 kt or more), and within 100 km at
typhoon/hurricane strength (64 kt or more), over complete seasons. No projection yet (STORM future-climate data comes
later), so it is "today only"."""
import csv
import json
import math

import numpy as np

from app.settings import ROOT

from ..common import download, js_round, km

# The tracks the atlas uses, condensed (a few MB, deployed) so a server never needs the 145 MB archive.
DERIVED = ROOT / "scripts" / "derived" / "ibtracs.npz"

URL = "https://www.ncei.noaa.gov/data/international-best-track-archive-for-climate-stewardship-ibtracs/v04r01/access/csv/ibtracs.since1980.list.v04r01.csv"
CONFIG = {
    "cycloneFromYear": 1980, "cycloneToYear": 2024,
    "cycloneStormRadiusKm": 150, "cycloneStormKt": 34,           # tropical-storm strength passing within 150 km
    "cycloneSevereRadiusKm": 100, "cycloneSevereKt": 64,         # typhoon/hurricane strength passing within 100 km
    "cycloneStormsPerDecadeFor100": 10, "cycloneSeverePerDecadeFor100": 3,
}
SOURCES = [{"id": "ibtracs", "name": "NOAA IBTrACS v04r01 tropical cyclone tracks, 1980-2024", "url": "https://www.ncei.noaa.gov/products/international-best-track-archive",
            "licence": "Public domain (NOAA); cite Knapp et al. 2010", "used": "Cyclone history"}]


def _f(v):
    try:
        x = float(v)
    except (TypeError, ValueError):
        return None
    return x if math.isfinite(x) else None


def prepare(warn):
    """Storms: {sid: {"name", "year", "pts": [(lat, lon, wind_kt)], "box": (minlat, maxlat, minlon, maxlon)}}, from
    scripts/derived/ibtracs.npz when present, otherwise from the archive (and the condensed file is written)."""
    if DERIVED.exists() and "--fresh" not in __import__("sys").argv:
        storms = _load()
    else:
        storms = _from_bigquery() or _from_csv()
        _save(storms)
    print(f"IBTrACS: {len(storms)} tropical storms, {CONFIG['cycloneFromYear']}-{CONFIG['cycloneToYear']}", flush=True)
    return storms


def _save(storms: dict) -> None:
    sids = list(storms)
    pts = [p for sid in sids for p in storms[sid]["pts"]]
    DERIVED.parent.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(DERIVED, pts=np.array(pts, dtype=np.float64), count=np.array([len(storms[sid]["pts"]) for sid in sids], dtype=np.int32),
                        meta=np.array(json.dumps({"sid": sids, "name": [storms[x]["name"] for x in sids], "year": [storms[x]["year"] for x in sids],
                                                  "from": CONFIG["cycloneFromYear"], "to": CONFIG["cycloneToYear"]})))


def _load() -> dict:
    z = np.load(DERIVED, allow_pickle=False)
    meta = json.loads(str(z["meta"]))
    pts, storms, i = z["pts"].tolist(), {}, 0
    for sid, name, year, n in zip(meta["sid"], meta["name"], meta["year"], z["count"].tolist()):
        p = [tuple(x) for x in pts[i:i + n]]
        i += n
        la, lo = [q[0] for q in p], [q[1] for q in p]
        storms[sid] = {"name": name, "year": year, "pts": p, "box": (min(la), max(la), min(lo), max(lo))}
    return storms


def _from_csv() -> dict:
    path = download(URL, "ibtracs.since1980.list.v04r01.csv", max_age_days=90)
    with path.open(newline="", encoding="utf-8", errors="replace") as fh:
        rd = csv.reader(fh)
        head = next(rd)
        next(rd)  # units row
        ix = {k: head.index(k) for k in ("SID", "SEASON", "NAME", "NATURE", "LAT", "LON", "WMO_WIND", "USA_WIND", "TRACK_TYPE")}
        return _build({k: row[i] for k, i in ix.items()} for row in rd)


# The same IBTrACS tracks from BigQuery's public copy, used when GOOGLE_CLOUD_PROJECT is set. Only used if it covers
# every season the atlas scores, so the scores can't silently change; otherwise the NOAA download is used.
BQ_TABLE = "bigquery-public-data.noaa_hurricanes.hurricanes"


def _from_bigquery() -> dict | None:
    from ..bq import enabled, rows
    if not enabled():
        return None
    y0, y1 = CONFIG["cycloneFromYear"], CONFIG["cycloneToYear"]
    top = rows(f"SELECT MAX(CAST(season AS INT64)) AS last FROM `{BQ_TABLE}`", "IBTrACS latest season")
    if not top or top[0]["last"] is None or int(top[0]["last"]) < y1:
        if top:
            print(f"BigQuery's IBTrACS copy ends in {top[0]['last']}, before {y1}; using the NOAA download.", flush=True)
        return None
    res = rows(f"""SELECT sid, season, name, nature, latitude, longitude, wmo_wind, usa_wind, track_type FROM `{BQ_TABLE}`
                   WHERE CAST(season AS INT64) BETWEEN {y0} AND {y1} AND track_type = 'main' AND TRIM(nature) = 'TS'
                   ORDER BY sid, iso_time""", "IBTrACS storm tracks")
    if not res:
        return None
    storms = _build({"SID": r["sid"], "SEASON": r["season"], "NAME": r["name"] or "", "NATURE": r["nature"] or "", "LAT": r["latitude"],
                     "LON": r["longitude"], "WMO_WIND": r["wmo_wind"], "USA_WIND": r["usa_wind"], "TRACK_TYPE": r["track_type"]} for r in res)
    print(f"IBTrACS read from BigQuery ({BQ_TABLE})", flush=True)
    return storms or None


def _build(records) -> dict:
    """Storms from IBTrACS records (CSV rows or BigQuery rows, same fields), in track order."""
    storms = {}
    for row in records:
        if row["TRACK_TYPE"] != "main" or str(row["NATURE"]).strip() != "TS":
            continue
        year = int(row["SEASON"])
        if not CONFIG["cycloneFromYear"] <= year <= CONFIG["cycloneToYear"]:
            continue
        lat, lon = _f(row["LAT"]), _f(row["LON"])
        if lat is None or lon is None:
            continue
        # 1-minute winds from the US agencies cover every basin; fall back to the WMO agency's value.
        wind = _f(row["USA_WIND"]) or _f(row["WMO_WIND"]) or 0.0
        s = storms.setdefault(row["SID"], {"name": str(row["NAME"]).strip().title(), "year": year, "pts": []})
        s["pts"].append((lat, lon, wind))
    for s in storms.values():
        la = [p[0] for p in s["pts"]]
        lo = [p[1] for p in s["pts"]]
        s["box"] = (min(la), max(la), min(lo), max(lo))
    return storms


def _closest(pts, lat, lon):
    """Closest approach to (lat, lon), checking points every ~20 km along each 3-hour track segment.
    Returns the minimum distance and the strongest wind within each radius we score."""
    best = math.inf
    within = {}
    for (a, b, w), (c, d, w2) in zip(pts, pts[1:] + pts[-1:]):
        if abs(d - b) > 180:          # dateline: don't interpolate across it
            c, d = a, b
        for k in range(5):
            f = k / 5
            plat, plon, pw = a + (c - a) * f, b + (d - b) * f, w + (w2 - w) * f
            dist = km(lat, lon, plat, plon)
            best = min(best, dist)
            for r in (CONFIG["cycloneStormRadiusKm"], CONFIG["cycloneSevereRadiusKm"]):
                if dist <= r:
                    within[r] = max(within.get(r, 0), pw)
    return best, within


def for_hub(storms, hid, lat, lon, warn):
    years = CONFIG["cycloneToYear"] - CONFIG["cycloneFromYear"] + 1
    pad = 2.0
    n_storm = n_severe = 0
    max_wind, strongest = 0.0, None
    for s in storms.values():
        a, b, c, d = s["box"]
        if not (a - pad <= lat <= b + pad) or not (c - pad <= lon <= d + pad):
            continue
        _, within = _closest(s["pts"], lat, lon)
        w150 = within.get(CONFIG["cycloneStormRadiusKm"], 0)
        if w150 >= CONFIG["cycloneStormKt"]:
            n_storm += 1
            if w150 > max_wind:
                max_wind, strongest = w150, f"{s['name']} ({s['year']})"
        if within.get(CONFIG["cycloneSevereRadiusKm"], 0) >= CONFIG["cycloneSevereKt"]:
            n_severe += 1
    per_dec = lambda n: n / years * 10  # noqa: E731
    score = js_round(min(100, 50 * min(1, per_dec(n_storm) / CONFIG["cycloneStormsPerDecadeFor100"]) + 50 * min(1, per_dec(n_severe) / CONFIG["cycloneSeverePerDecadeFor100"])))
    span = f"{CONFIG['cycloneFromYear']}-{CONFIG['cycloneToYear']}"
    if n_storm == 0:
        summary = f"no tropical storm passed within {CONFIG['cycloneStormRadiusKm']} km in {span} (NOAA IBTrACS)"
    else:
        summary = (f"{n_storm} tropical storms passed within {CONFIG['cycloneStormRadiusKm']} km in {span}, {n_severe} of them at typhoon/hurricane strength within "
                   f"{CONFIG['cycloneSevereRadiusKm']} km; strongest {strongest} at {js_round(max_wind)} kt (NOAA IBTrACS)")
    return {"kind": "today", "src": ["ibtracs"], "t": score,
            "raw": {"storms": n_storm, "severe": n_severe, "years": years, "maxWindKt": js_round(max_wind), "strongest": strongest,
                    "stormsPerDecade": js_round(per_dec(n_storm), 1), "severePerDecade": js_round(per_dec(n_severe), 1)},
            "summary": summary,
            "basis": (f"Measured history: {summary[0].upper() + summary[1:]}. Score = half storms per decade ({CONFIG['cycloneStormsPerDecadeFor100']} = 100), "
                      f"half typhoon-strength passes per decade ({CONFIG['cycloneSeverePerDecadeFor100']} = 100). No projection yet.")}
