"""Wildfire: NASA FIRMS MODIS active-fire detections (Collection 6.1, standard processing), 2015-2024, from the
keyless per-country yearly CSV files. Only "presumed vegetation fires" (type 0) with confidence >= 30 are kept;
volcanoes, industrial and offshore sources are dropped. Note that vegetation fires include crop-residue burning.

    python -m jobs.sources.wildfire            download and condense every hub country (about 1.4 GB transferred once)
    python -m jobs.sources.wildfire --add IND  add one more country (e.g. for a site outside the hub countries)

The raw CSVs are streamed and never kept: detections are counted per 0.05° cell (about 5 km) per year into
scripts/derived/wildfire.npz (a few MB), which the hazard build and the site builds read. Measured history only."""
import io
import json
import sys
import time

import numpy as np

from app.settings import ROOT

from ..common import _http, clamp, js_round, km

DERIVED = ROOT / "scripts" / "derived" / "wildfire.npz"
YEARS = list(range(2015, 2025))
CELL = 0.05
CONFIG = {"fireRadiusKm": 25, "fireYears": f"{YEARS[0]}-{YEARS[-1]}", "fireMinConfidence": 30, "fireCountFor100": 150}
SOURCES = [{"id": "firms", "name": "NASA FIRMS MODIS active fires (C6.1), vegetation fires only", "url": "https://firms.modaps.eosdis.nasa.gov/",
            "licence": "NASA open data; credit NASA FIRMS (LANCE)", "used": "Wildfire history"}]
# FIRMS file names for the hub countries; others fall back to the World Bank name with underscores.
FIRMS_NAME = {"AUS": "Australia", "BRA": "Brazil", "CAN": "Canada", "CHL": "Chile", "CHN": "China", "COL": "Colombia", "EGY": "Egypt",
              "FRA": "France", "DEU": "Germany", "IND": "India", "IDN": "Indonesia", "IRL": "Ireland", "ITA": "Italy", "JPN": "Japan",
              "KEN": "Kenya", "MYS": "Malaysia", "MEX": "Mexico", "NLD": "Netherlands", "NZL": "New_Zealand", "NGA": "Nigeria",
              "NOR": "Norway", "PER": "Peru", "PHL": "Philippines", "POL": "Poland", "QAT": "Qatar", "SAU": "Saudi_Arabia",
              "SGP": "Singapore", "ZAF": "South_Africa", "KOR": "Republic_of_Korea", "ESP": "Spain", "SWE": "Sweden", "CHE": "Switzerland",
              "TWN": "Taiwan", "THA": "Thailand", "TUR": "Turkey", "ARE": "United_Arab_Emirates", "GBR": "United_Kingdom",
              "USA": "United_States", "VNM": "Vietnam", "HKG": "China", "BGD": "Bangladesh", "PAK": "Pakistan", "LKA": "Sri_Lanka"}


def _load() -> dict:
    if not DERIVED.exists():
        return {"cells": {}, "countries": []}
    z = np.load(DERIVED, allow_pickle=False)
    meta = json.loads(str(z["meta"]))
    cells = {}
    for la, lo, yi, n in zip(z["lat"], z["lon"], z["year"], z["n"]):
        cells.setdefault((int(la), int(lo)), np.zeros(len(YEARS), dtype=np.int32))[int(yi)] += int(n)
    return {"cells": cells, "countries": meta["countries"]}


def _save(cells: dict, countries: list) -> None:
    DERIVED.parent.mkdir(parents=True, exist_ok=True)
    la, lo, yi, n = [], [], [], []
    for (a, b), arr in cells.items():
        for y, c in enumerate(arr):
            if c:
                la.append(a); lo.append(b); yi.append(y); n.append(int(c))
    np.savez_compressed(DERIVED, lat=np.array(la, dtype=np.int16), lon=np.array(lo, dtype=np.int16), year=np.array(yi, dtype=np.int8),
                        n=np.array(n, dtype=np.int32), meta=np.array(json.dumps({"countries": sorted(countries), "years": YEARS, "cell": CELL})))


def _country(iso3: str, cells: dict) -> int:
    name = FIRMS_NAME.get(iso3)
    if not name:
        j = _http.get(f"https://api.worldbank.org/v2/country/{iso3}", params={"format": "json"}).json()
        name = j[1][0]["name"].split(",")[0].replace(" ", "_")
    kept, missing = 0, 0
    for y in YEARS:
        url = f"https://firms.modaps.eosdis.nasa.gov/data/country/modis/{y}/modis_{y}_{name}.csv"
        for attempt in range(3):
            try:
                with _http.stream("GET", url, timeout=600) as r:
                    if r.status_code == 404:
                        print(f"  ! {iso3} {y}: no FIRMS file ({name})", flush=True)
                        missing += 1
                        break
                    r.raise_for_status()
                    head = None
                    for line in r.iter_lines():
                        if head is None:
                            head = line.split(",")
                            ix = {k: head.index(k) for k in ("latitude", "longitude", "confidence", "type")}
                            continue
                        f = line.split(",")
                        if len(f) < len(head) or f[ix["type"]] != "0" or int(f[ix["confidence"]] or 0) < CONFIG["fireMinConfidence"]:
                            continue
                        key = (int(round(float(f[ix["latitude"]]) / CELL)), int(round(float(f[ix["longitude"]]) / CELL)))
                        cells.setdefault(key, np.zeros(len(YEARS), dtype=np.int32))[y - YEARS[0]] += 1
                        kept += 1
                break
            except Exception as e:  # noqa: BLE001
                if attempt == 2:
                    raise RuntimeError(f"{iso3} {y}: {e}") from e
                time.sleep(5 * (attempt + 1))
        print(f"  {iso3} {y} done", flush=True)
    if missing == len(YEARS):
        raise RuntimeError(f"no FIRMS files found for {iso3} under the name {name}")
    return kept


def derive(iso3s: list[str]) -> None:
    d = _load()
    cells, countries = d["cells"], set(d["countries"])
    for iso3 in iso3s:
        if iso3 in countries or FIRMS_NAME.get(iso3) in {FIRMS_NAME.get(c) for c in countries}:
            continue
        print(f"FIRMS {iso3}", flush=True)
        try:
            n = _country(iso3, cells)
        except RuntimeError as e:
            print(f"  ! {e}", flush=True)
            continue
        countries.add(iso3)
        _save(cells, list(countries))          # save after each country, so an interrupted run resumes
        print(f"  {iso3}: {n} vegetation fire detections kept", flush=True)


def prepare(warn):
    d = _load()
    if not d["cells"]:
        warn("wildfire: scripts/derived/wildfire.npz missing; run python -m jobs.sources.wildfire")
        return None
    print(f"FIRMS: {len(d['cells'])} fire cells, {len(d['countries'])} countries", flush=True)
    return d


def for_hub(data, hid, lat, lon, warn, iso3=None):
    c = CONFIG
    if iso3 and iso3 not in data["countries"] and FIRMS_NAME.get(iso3) not in {FIRMS_NAME.get(x) for x in data["countries"]}:
        return {"kind": "none", "src": [], "basis": f"Fire data for this country hasn't been downloaded yet (python -m jobs.sources.wildfire --add {iso3})."}
    r = c["fireRadiusKm"]
    span = int(r / 111 / CELL) + 2
    ci, cj = int(round(lat / CELL)), int(round(lon / CELL))
    per_year = np.zeros(len(YEARS), dtype=np.int64)
    for a in range(ci - span, ci + span + 1):
        for b in range(cj - span * 3, cj + span * 3 + 1):
            arr = data["cells"].get((a, b))
            if arr is not None and km(lat, lon, a * CELL, b * CELL) <= r:
                per_year += arr
    mean = float(per_year.mean())
    peak_i = int(per_year.argmax())
    # Square-root scale: separates a few stray detections from places that burn every year. fireCountFor100 a year = 100.
    score = js_round(clamp(100 * (mean / c["fireCountFor100"]) ** 0.5, 0, 100))
    return {"kind": "history", "src": ["firms"], "t": score,
            "raw": {"perYear": js_round(mean, 1), "worstYear": YEARS[peak_i], "worstCount": int(per_year[peak_i]), "years": c["fireYears"]},
            "summary": f"{js_round(mean, 1)} vegetation fire detections a year within {r} km ({c['fireYears']}, NASA FIRMS MODIS); most in {YEARS[peak_i]} ({int(per_year[peak_i])})",
            "basis": (f"NASA FIRMS MODIS detections of vegetation fires within {r} km, {c['fireYears']}: {js_round(mean, 1)} a year on average, "
                      f"most in {YEARS[peak_i]} ({int(per_year[peak_i])}). Includes crop-residue burning. Score = 100 × √(fires a year ÷ "
                      f"{c['fireCountFor100']}), capped at 100. No projection yet, so 2030 and 2050 show this history.")}


if __name__ == "__main__":
    from app import hubs as hublib
    if "--redo" in sys.argv:          # forget a country (e.g. after fixing its FIRMS file name), then add it again
        iso = sys.argv[sys.argv.index("--redo") + 1].upper()
        d = _load()
        _save(d["cells"], [c for c in d["countries"] if c != iso])
        derive([iso])
    elif "--add" in sys.argv:
        derive([sys.argv[sys.argv.index("--add") + 1].upper()])
    else:
        meta = hublib.load()["meta"]
        derive(list(dict.fromkeys(m["iso3"] for m in meta.values() if isinstance(m, dict) and m.get("iso3"))))
    print("Done.")
