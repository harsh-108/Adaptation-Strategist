"""Build public/hazards.json (and hazards.js for the browser) from open data. Run occasionally, not per visit:

    python -m jobs.build_hazards                # all hubs (raw responses cached in scripts/.cache)
    python -m jobs.build_hazards --fresh        # refetch everything
    python -m jobs.build_hazards --only=MAA,DEL # print a few hubs, write nothing
    python -m jobs.build_hazards --only=MAA --merge   # refresh one hub inside the existing files

Heat   NASA POWER daily temperatures 1991-2020 at the hub (hot days >= 35 C, cooling degree days), shifted by the
       World Bank CCKP CMIP6 ensemble-median warming for the country (SSP2-4.5 / SSP5-8.5; 2020-2039 for 2030,
       2040-2059 for 2050).
Water  WRI Aqueduct 3.0 baseline water stress, area-weighted within 25 km; future = baseline ratio x Aqueduct 2.1
       projected change (2030, and 2040 for 2050). SSP2 RCP4.5 = moderate, SSP2 RCP8.5 = high.
Flood  WRI Aqueduct 3.0 riverine and coastal flood risk (worse of the two), today only: no open projection of its
       change yet, so 2030/2050 carry today's value and say so.
Grid   No open global source: "no data" unless an admin entered a value for the hub (labelled "yours").
Other  Cyclones (NOAA IBTrACS history), volcanoes (Smithsonian GVP), earthquakes (USGS); in the overall score with equal weight.
Extras National grid carbon and electricity demand (Ember via Our World in Data), PeeringDB facilities within 50 km, NASA POWER solar.
Nothing is ever copied from other hubs or invented; a hazard without data is stored as kind "none".
"""
import json
import math
import sys
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from urllib.parse import quote

from app import hubs as hublib
from app.settings import HAZARDS_JSON, ROOT, env

from .common import clamp, get_json, js_round, km
from .sources import geophysical
from .sources import cyclones
from .sources import electricity
from .sources import gridindia, gridrel, sealevel, storm, utilrel, wildfire

ONLY = [x for a in sys.argv if a.startswith("--only=") for x in a[7:].split(",") if x]
MERGE = "--merge" in sys.argv

# ---------- Scoring choices (one place, shown in the app) ----------
CONFIG = {
    "heatThresholdC": 35,      # a "hot day" for cooling plant: daily max at or above this
    "heatDaysFor100": 150,     # hot days a year that score 100 (half the heat score)
    "cddBaseC": 18,            # cooling degree days base (daily mean temperature)
    "cddFor100": 4000,         # cooling degree days a year that score 100 (other half)
    "waterScoreScale": 20,     # Aqueduct score 0-5 x 20
    "floodScoreScale": 20,     # Aqueduct score 0-5 x 20
    "waterRadiusKm": 25,       # water stress is area-weighted over sub-basins within this radius
    "facilitiesRadiusKm": 50,
    **cyclones.CONFIG, **geophysical.CONFIG, **wildfire.CONFIG, **storm.CONFIG, **sealevel.CONFIG, **gridrel.CONFIG, **gridindia.CONFIG,
}
PATHWAYS = {"m": "ssp245", "h": "ssp585"}
PERIODS = {"30": "2020-2039", "50": "2040-2059"}
AQ21 = {"scen": {"m": "24", "h": "28"}, "year": {"30": "30", "50": "40"}}   # ws{year}{scen}cr
KEYS4 = ["m30", "h30", "m50", "h50"]

SOURCES = [
    {"id": "nasa-power", "name": "NASA POWER (MERRA-2) daily max temperature, 1991-2020", "url": "https://power.larc.nasa.gov/", "licence": "Public, credit NASA LaRC POWER Project", "used": "Heat today"},
    {"id": "cckp", "name": "World Bank Climate Change Knowledge Portal, CMIP6 0.25° ensemble median", "url": "https://climateknowledgeportal.worldbank.org/", "licence": "CC BY 4.0", "used": "Heat change to 2030 and 2050"},
    {"id": "aqueduct3", "name": "WRI Aqueduct 3.0 (baseline water stress, riverine and coastal flood risk)", "url": "https://www.wri.org/aqueduct", "licence": "CC BY 4.0", "used": "Water today, flood today"},
    {"id": "aqueduct21", "name": "WRI Aqueduct 2.1 water stress projections", "url": "https://www.wri.org/data/aqueduct-projected-water-stress-country-rankings", "licence": "CC BY 4.0", "used": "Water change to 2030 and 2050"},
    {"id": "peeringdb", "name": "PeeringDB facilities", "url": "https://www.peeringdb.com/", "licence": "PeeringDB terms of use (attribution)", "used": "Facilities nearby"},
    {"id": "nasa-power-solar", "name": "NASA POWER solar irradiance climatology", "url": "https://power.larc.nasa.gov/", "licence": "Public, credit NASA LaRC POWER Project", "used": "Solar yield"},
    {"id": "ember", "name": "Ember yearly electricity carbon intensity", "url": "https://ember-energy.org/data/api", "licence": "CC BY 4.0", "used": "Grid carbon"},
    *cyclones.SOURCES, *geophysical.SOURCES, *electricity.SOURCES, *wildfire.SOURCES, *storm.SOURCES, *sealevel.SOURCES, *gridrel.SOURCES, *gridindia.SOURCES, *utilrel.SOURCES,
]

warnings: list[str] = []


def warn(m: str) -> None:
    warnings.append(m)
    print("  ! " + m, flush=True)


def enc(s: str) -> str:
    """Encode like JavaScript's encodeURIComponent, so cache keys match files from the earlier Node build."""
    return quote(s, safe="-_.!~*'()")


# ---------- WRI Aqueduct through its public Carto SQL API ----------
def carto(sql: str):
    return get_json("https://wri-rw.carto.com/api/v2/sql?q=" + enc(sql), gap_s=0.25)


def aqueduct_at(table: str, cols: str, lat: float, lon: float):
    p = f"ST_SetSRID(ST_Point({lon},{lat}),4326)"
    r = carto(f"SELECT {cols} FROM {table} WHERE ST_Intersects(the_geom,{p}) LIMIT 1")
    if r.get("rows"):
        return {**r["rows"][0], "_snapKm": 0}
    # Coastal points can fall just outside every basin polygon: take the nearest one within 25 km.
    r = carto(f"SELECT {cols}, ST_Distance(the_geom::geography, {p}::geography)/1000 AS _snapkm FROM {table} ORDER BY the_geom <-> {p} LIMIT 1")
    row = (r.get("rows") or [None])[0]
    return {**row, "_snapKm": js_round(row["_snapkm"], 1)} if row and row["_snapkm"] <= 25 else None


def bws_around(lat: float, lon: float, radius_km: float):
    """Water stress area-weighted over every Aqueduct sub-basin within radius_km. Invalid ratios (an Aqueduct
    artefact in some small city sub-basins) are left out and reported."""
    p = f"ST_SetSRID(ST_Point({lon},{lat}),4326)"
    b = f"ST_Buffer({p}::geography, {radius_km * 1000})::geometry"
    r = carto(f"""SELECT pfaf_id, sub_name, bws_raw, bws_score, bws_cat, bws_label,
    ST_Area(ST_Intersection(ST_MakeValid(the_geom), {b})::geography)/1e6 AS km2
    FROM wat_050_aqueduct_baseline_water_stress WHERE ST_Intersects(the_geom, {b})""")
    rows = [x for x in r.get("rows") or [] if (x.get("km2") or 0) > 0]
    valid = [x for x in rows if x["bws_cat"] == -1 or ((x.get("bws_raw") or 0) > 0 and x.get("bws_score") is not None)]
    if not valid:
        return None
    tot = sum(x["km2"] for x in valid)
    score = lambda x: 5 if x["bws_cat"] == -1 else x["bws_score"]  # noqa: E731
    main = max(valid, key=lambda x: x["km2"])
    return {"score": sum(score(x) * x["km2"] for x in valid) / tot,
            # Weighted raw ratio, used with the projected change (arid basins count as 1.6, i.e. score 5).
            "raw": sum((1.6 if x["bws_cat"] == -1 else x["bws_raw"]) * x["km2"] for x in valid) / tot,
            "label": main["bws_label"], "basin": main["sub_name"], "basins": len(valid), "dropped": len(rows) - len(valid),
            "aridShare": sum(x["km2"] for x in valid if x["bws_cat"] == -1) / tot}


def bws_score(raw: float) -> float:
    """Aqueduct 3.0 score from a raw withdrawal/supply ratio: 10% -> 1, 20% -> 2, 40% -> 3, 80% -> 4, 160% -> 5."""
    return clamp(math.log2(20 * raw), 0, 5)


def cckp(v: str, period: str, scen: str) -> dict:
    j = get_json(f"https://cckpapi.worldbank.org/cckp/v1/cmip6-x0.25_climatology_{v}_climatology_annual_{period}_median_{scen}_ensemble_all_mean/all_countries?_format=json")
    return {k: list(x.values())[0] for k, x in (j.get("data") or {}).items()}


def warming_of(v: str) -> dict:
    hist, w = cckp(v, "1995-2014", "historical"), {}
    for pk, scen in PATHWAYS.items():
        for yk, per in PERIODS.items():
            fut = cckp(v, per, scen)
            for iso, val in fut.items():
                if hist.get(iso) is not None:
                    w.setdefault(iso, {})[pk + yk] = js_round(val - hist[iso], 2)
    return w


def horizon_values(t: float, change: float) -> dict:
    """An admin-entered today value and change by 2050, spread over the horizons (2030 ~ a third; moderate 70%)."""
    return {k: clamp(js_round(t + change * (0.35 if k.endswith("30") else 1) * (0.7 if k[0] == "m" else 1)), 0, 100) for k in KEYS4}


def prepare(metas: list[dict]) -> dict:
    """Downloads shared by every place (country warming, facilities per country, grid data, storm, volcano and
    earthquake catalogues). metas are hub-meta style dicts with lat, lon, iso2, iso3."""
    print("World Bank CCKP: warming by country", flush=True)
    warming, warming_mean = warming_of("tasmax"), warming_of("tas")   # daily maximum for hot days; daily mean for degree days

    try:
        em_zones = get_json("https://api.electricitymaps.com/v3/zones")
    except Exception as e:  # noqa: BLE001
        em_zones = None
        warn("Could not load Electricity Maps zone list: " + str(e))

    print("PeeringDB: facilities", flush=True)
    fac_by_country = {}
    for iso2 in dict.fromkeys(m["iso2"] for m in metas if m.get("iso2")):
        try:
            fac_by_country[iso2] = get_json(f"https://www.peeringdb.com/api/fac?country={iso2}&status=ok&fields=id,name,city,latitude,longitude", gap_s=4).get("data") or []
        except Exception as e:  # noqa: BLE001
            warn(f"PeeringDB {iso2}: {e}")

    ember_key, ember_ci = env("EMBER_API_KEY"), {}
    if ember_key:
        print("Ember: grid carbon intensity", flush=True)
        for iso3 in dict.fromkeys(x for m in metas for x in (m.get("iso3"), m.get("iso3Fallback")) if x):
            try:
                j = get_json(f"https://api.ember-energy.org/v1/carbon-intensity/yearly?entity_code={iso3}&start_date=2019&api_key={ember_key}",
                             cache_key=f"ember-ci-{iso3}-2019", gap_s=0.3)
                rows = sorted([r for r in j.get("data") or [] if r.get("emissions_intensity_gco2_per_kwh") is not None], key=lambda r: str(r["date"]), reverse=True)
                if rows:
                    ember_ci[iso3] = {"g": js_round(rows[0]["emissions_intensity_gco2_per_kwh"]), "year": str(rows[0]["date"])[:4]}
            except Exception as e:  # noqa: BLE001
                warn(f"Ember {iso3}: {e}")
    else:
        print("Ember: skipped (no EMBER_API_KEY)", flush=True)

    try:
        elec = electricity.prepare(warn)
    except Exception as e:  # noqa: BLE001
        elec = None
        warn(f"electricity data: could not load ({e})")

    # Cyclones, volcanoes and earthquakes: prepared once, then looked up per place.
    other = {}
    for name, mod in (("cyclone", cyclones), ("volcano", geophysical.Volcanoes), ("earthquake", geophysical.Earthquakes)):
        try:
            other[name] = mod.prepare(warn)
        except Exception as e:  # noqa: BLE001
            other[name] = None
            warn(f"{name}: could not load data ({e})")
    # Condensed files in scripts/derived (wildfire, STORM, sea level) and the World Bank outage statistics.
    for name, mod in (("wildfire", wildfire), ("storm", storm), ("sealevel", sealevel), ("gridrel", gridrel), ("gridindia", gridindia), ("utilrel", utilrel)):
        try:
            other[name] = mod.prepare(warn)
        except Exception as e:  # noqa: BLE001
            other[name] = None
            warn(f"{name}: could not load data ({e})")
    return {"warming": warming, "warming_mean": warming_mean, "em_zones": em_zones, "fac_by_country": fac_by_country,
            "ember_ci": ember_ci, "elec": elec, "other": other}


def build_record(hid: str, m: dict, ctx: dict) -> dict:
    """The hazard record for one place (a hub, or a user's site) at its own coordinates. Measured data only."""
    warming, warming_mean, em_zones = ctx["warming"], ctx["warming_mean"], ctx["em_zones"]
    fac_by_country, ember_ci, elec, other = ctx["fac_by_country"], ctx["ember_ci"], ctx["elec"], ctx["other"]
    lat, lon = m["lat"], m["lon"]
    rec = {"lat": lat, "lon": lon, "place": m.get("place"), "iso3": m.get("iso3"), "emZone": m.get("emZone"), "eia": m.get("eia"), "ukCarbon": bool(m.get("ukCarbon"))}
    if em_zones is not None and m.get("emZone") and m["emZone"] not in em_zones:
        warn(f"{hid}: Electricity Maps zone {m['emZone']} not in the public list")

    # Heat
    try:
        j = get_json(f"https://power.larc.nasa.gov/api/temporal/daily/point?parameters=T2M,T2M_MAX&community=RE&longitude={lon}&latitude={lat}&start=19910101&end=20201231&format=JSON", gap_s=0.5)
        par = j["properties"]["parameter"]
        tx = [v for v in par["T2M_MAX"].values() if v > -900]
        tm = [v for v in par["T2M"].values() if v > -900]
        years = len(tx) / 365.25
        days = lambda dt: sum(1 for v in tx if v + dt >= CONFIG["heatThresholdC"]) / years  # noqa: E731
        cdd = lambda dt: sum(max(0, v + dt - CONFIG["cddBaseC"]) for v in tm) / years  # noqa: E731
        iso = m["iso3"] if m["iso3"] in warming else m.get("iso3Fallback")
        w, wm = warming.get(iso), warming_mean.get(iso)
        if not w or not wm:
            warn(f"{hid}: no World Bank warming for {m['iso3']}")
        raw, raw_cdd = {"t": js_round(days(0))}, {"t": js_round(cdd(0))}
        for k in KEYS4:
            raw[k] = js_round(days(w[k])) if w and w.get(k) is not None else None
            raw_cdd[k] = js_round(cdd(wm[k])) if wm and wm.get(k) is not None else None
        score = lambda d, c: None if d is None or c is None else js_round(clamp(0.5 * d / CONFIG["heatDaysFor100"] * 100 + 0.5 * c / CONFIG["cddFor100"] * 100, 0, 100))  # noqa: E731
        rec["heat"] = {"kind": "modelled", "unit": f"days a year at or above {CONFIG['heatThresholdC']} °C", "unit2": f"cooling degree days (base {CONFIG['cddBaseC']} °C)",
                       "src": ["nasa-power", "cckp"], "raw": raw, "rawCdd": raw_cdd,
                       "warmingC": {k: w.get(k) for k in KEYS4} if w else None,
                       **{k: score(raw[k], raw_cdd[k]) for k in raw},
                       "basis": (f"1991-2020 at the hub (NASA POWER): {raw['t']} days a year at or above {CONFIG['heatThresholdC']} °C and {raw_cdd['t']} cooling degree days. "
                                 f"Future adds the {iso} country-average warming from the World Bank CMIP6 ensemble median. Score = half hot days ({CONFIG['heatDaysFor100']} = 100), half degree days ({CONFIG['cddFor100']} = 100).")}
    except Exception as e:  # noqa: BLE001
        warn(f"{hid} heat: {e}")

    # Water
    try:
        b = bws_around(lat, lon, CONFIG["waterRadiusKm"])
        if not b:
            raise RuntimeError(f"no valid Aqueduct water stress within {CONFIG['waterRadiusKm']} km")
        if b["dropped"]:
            warn(f"{hid} water: left out {b['dropped']} Aqueduct sub-basin(s) with no valid stress ratio")
        cols = [f"ws{y}{s}cr" for s in AQ21["scen"].values() for y in AQ21["year"].values()]
        p = aqueduct_at("wat_006_projected_water_stress", "basinid," + ",".join(cols), lat, lon)
        arid, base = b["aridShare"] > 0.5, b["score"]

        def fut(k):
            cr = (p or {}).get(f"ws{AQ21['year'][k[1:]]}{AQ21['scen'][k[0]]}cr")
            if arid or not cr:
                return {"score": base, "ratio": None}
            return {"score": bws_score(b["raw"] * cr), "ratio": js_round(cr, 2)}
        f = {k: fut(k) for k in KEYS4}
        rec["water"] = {"kind": "modelled", "unit": "Aqueduct water stress score (0-5)", "src": ["aqueduct3", "aqueduct21"],
                        "label": b["label"], "basin": b["basin"], "basins": b["basins"], "radiusKm": CONFIG["waterRadiusKm"],
                        "raw": {"t": js_round(base, 2), **{k: js_round(v["score"], 2) for k, v in f.items()}},
                        "change": {k: v["ratio"] for k, v in f.items()},
                        "t": js_round(base * CONFIG["waterScoreScale"]),
                        **{k: js_round(v["score"] * CONFIG["waterScoreScale"]) for k, v in f.items()},
                        "basis": (f"Aqueduct classes most of the area within {CONFIG['waterRadiusKm']} km as arid with low water use (scored as extremely high stress). No projection is applied." if arid else
                                  f"Aqueduct 3.0 baseline, area-weighted over {b['basins']} sub-basin(s) within {CONFIG['waterRadiusKm']} km; the largest is {b['label']}. Future applies Aqueduct 2.1's projected change for SSP2 RCP4.5 (moderate) or SSP2 RCP8.5 (high); 2050 uses its 2040 projection, the latest available.")}
    except Exception as e:  # noqa: BLE001
        warn(f"{hid} water: {e}")

    # Flood: today is measured; there is no open projection of its change yet
    try:
        rf = aqueduct_at("wat_055_aqueduct_riverine_flood_risk", "rfr_score,rfr_label", lat, lon)
        cf = aqueduct_at("wat_056_aqueduct_coastal_flood_risk", "cfr_score,cfr_label", lat, lon)
        river, coast = (rf or {}).get("rfr_score"), (cf or {}).get("cfr_score")
        if river is None and coast is None:
            raise RuntimeError("no Aqueduct flood value here")
        worst = max(river or 0, coast or 0)
        rec["flood"] = {"kind": "today", "unit": "Aqueduct flood risk score (0-5)", "src": ["aqueduct3"],
                        "raw": {"river": js_round(river, 2), "coastal": js_round(coast, 2)},
                        "labels": {"river": (rf or {}).get("rfr_label"), "coastal": (cf or {}).get("cfr_label")},
                        "t": js_round(worst * CONFIG["floodScoreScale"]),
                        "basis": f"Today is the worse of Aqueduct riverine ({(rf or {}).get('rfr_label') or 'n/a'}) and coastal ({(cf or {}).get('cfr_label') or 'n/a'}) flood risk. No open projection of how it changes yet, so 2030 and 2050 show today's value."}
    except Exception as e:  # noqa: BLE001
        warn(f"{hid} flood: {e}")

    # Only measured data, or a value an admin entered for this hub. Nothing is copied from other hubs.
    own = m.get("own") or {}
    if isinstance(own.get("grid"), list) and own["grid"] and own["grid"][0] is not None:
        t, ch = float(own["grid"][0]), float(own["grid"][1] if len(own["grid"]) > 1 else 0)
        rec["grid"] = {"kind": "own", "src": ["own"], "t": t, **horizon_values(t, ch),
                       "basis": f"Entered by an admin for this hub: {js_round(t) if t.is_integer() else t} today, rising by {js_round(ch) if ch.is_integer() else ch} by 2050 (2030 takes about a third of that; the moderate pathway 70%)."}
    else:
        names = [m.get("name"), m.get("place"), *(m.get("aliases") or [])]
        g = gridrel.for_hub(other.get("gridrel"), m.get("iso3"), m.get("iso3Fallback"), names=names) if other.get("gridrel") is not None else None
        if not g or g.get("kind") == "none":
            # Indian places that aren't a city the World Bank measured: Grid-India's state-level supply shortfall.
            gi = gridindia.for_hub(other.get("gridindia"), m.get("iso3"), names=names)
            g = gi or g
        if not g or g.get("kind") == "none":
            # Hubs the World Bank didn't measure: the serving utility's own figures (EIA Form 861 in the US, Taipower).
            g = utilrel.for_hub(other.get("utilrel"), hid) or g
        rec["grid"] = g or {"kind": "none", "src": [], "basis": "No measured grid reliability data for this country (the World Bank series doesn't cover it)."}
    if rec.get("flood") and own.get("floodChange") is not None:
        fc = float(own["floodChange"])
        rec["flood"].update({"kind": "own-change", **horizon_values(rec["flood"]["t"], fc), "src": ["aqueduct3", "own"],
                             "basis": rec["flood"]["basis"].replace("No open projection of how it changes yet, so 2030 and 2050 show today's value.",
                                                                    f"The change to 2050 (+{js_round(fc) if fc.is_integer() else fc}) was entered by an admin for this hub.")})
    for k in ("heat", "water", "flood"):
        if k not in rec:
            rec[k] = {"kind": "none", "src": [], "basis": "No usable open-data value for this hub."}

    # Cyclones, volcanoes and earthquakes (stored under "other"; scored like the rest).
    rec["other"] = {}
    for name, mod in (("cyclone", cyclones), ("volcano", geophysical.Volcanoes), ("earthquake", geophysical.Earthquakes)):
        try:
            rec["other"][name] = mod.for_hub(other[name], hid, lat, lon, warn) if other.get(name) is not None else \
                {"kind": "none", "src": [], "basis": "Data source unavailable during this build."}
        except Exception as e:  # noqa: BLE001
            warn(f"{hid} {name}: {e}")
            rec["other"][name] = {"kind": "none", "src": [], "basis": "No usable data for this hub."}
    # Wildfire: measured fire history (NASA FIRMS), scored like the rest.
    try:
        rec["other"]["wildfire"] = wildfire.for_hub(other["wildfire"], hid, lat, lon, warn, iso3=m.get("iso3")) if other.get("wildfire") is not None else \
            {"kind": "none", "src": [], "basis": "Fire data not built yet (python -m jobs.sources.wildfire)."}
    except Exception as e:  # noqa: BLE001
        warn(f"{hid} wildfire: {e}")
        rec["other"]["wildfire"] = {"kind": "none", "src": [], "basis": "No usable fire data for this place."}
    # Cyclones: STORM's modelled change (high emissions, 2015-2050) applied to the measured history.
    cy = rec["other"].get("cyclone") or {}
    if other.get("storm") is not None and cy.get("kind") not in (None, "none") and (cy["raw"]["storms"] or cy["raw"]["severe"]):
        ch = storm.change_at(other["storm"], lat, lon)
        if ch and ch[20]["ratio"] is not None:
            r20 = ch[20]["ratio"]
            r29 = ch[29]["ratio"] if ch[29]["ratio"] is not None else r20
            c = CONFIG
            fut = js_round(min(100, 50 * min(1, cy["raw"]["stormsPerDecade"] * r20 / c["cycloneStormsPerDecadeFor100"]) +
                                50 * min(1, cy["raw"]["severePerDecade"] * r29 / c["cycloneSeverePerDecadeFor100"])))
            pct = lambda r: f"{'+' if r >= 1 else '-'}{js_round(abs(r - 1) * 100)}%"  # noqa: E731
            cy.update({"kind": "modelled", "src": ["ibtracs", "storm"], "m30": cy["t"], "m50": cy["t"], "h30": fut, "h50": fut,
                       "change": {"basin": ch["basin"], "ratio20": r20, "ratio29": r29},
                       "basis": cy["basis"].replace(" No projection yet.", "") +
                       f" High emissions: STORM's 2015-2050 climate (SSP5-8.5, median of 4 models) changes how often 20 m/s winds occur here by {pct(r20)} "
                       f"and 29 m/s (about Category 1) by {pct(r29)}; applied to the history for 2030 and 2050. STORM has no moderate-emissions run, so the moderate pathway keeps the history."})

    # Extras
    extra = {}
    try:
        j = get_json(f"https://power.larc.nasa.gov/api/temporal/climatology/point?parameters=ALLSKY_SFC_SW_DWN&community=RE&longitude={lon}&latitude={lat}&format=JSON", gap_s=0.5)
        ann = j["properties"]["parameter"]["ALLSKY_SFC_SW_DWN"]["ANN"]
        if ann > 0:
            extra["solar"] = {"kwhM2Day": js_round(ann, 2), "src": "nasa-power-solar"}
    except Exception as e:  # noqa: BLE001
        warn(f"{hid} solar: {e}")
    facs = fac_by_country.get(m["iso2"])
    if facs is not None:
        near = [f for f in facs if f.get("latitude") is not None and f.get("longitude") is not None and km(lat, lon, f["latitude"], f["longitude"]) <= CONFIG["facilitiesRadiusKm"]]
        located = sum(1 for f in facs if f.get("latitude") is not None)
        extra["facilities"] = {"n": len(near), "radiusKm": CONFIG["facilitiesRadiusKm"], "locatedShare": js_round(located / len(facs), 2) if facs else None, "src": "peeringdb"}
    if elec is not None:
        extra.update(electricity.for_hub(elec, m.get("iso3"), m.get("iso3Fallback")))
    ci = ember_ci.get(m.get("iso3")) or ember_ci.get(m.get("iso3Fallback"))
    if ci and "gridCarbon" not in extra:
        extra["gridCarbon"] = {**ci, "entity": m["iso3"] if m.get("iso3") in ember_ci else m.get("iso3Fallback"), "src": "ember"}
    if other.get("sealevel") is not None:
        sl = sealevel.for_hub(other["sealevel"], lat, lon)
        if sl:
            extra["seaLevel"] = sl
    rec["extra"] = extra
    return rec


def main() -> None:
    st = hublib.load()
    meta_all = st["meta"]
    hubs = [h for h in st["map"]["hubs"] if not ONLY or h["id"] in ONLY]
    for h in hubs:
        if h["id"] not in meta_all:
            raise SystemExit(f"scripts/hub-meta.json has no entry for {h['id']}")
    ctx = prepare([meta_all[h["id"]] for h in hubs])

    print(f"Hubs: {len(hubs)}", flush=True)
    out = {}

    def one(h: dict) -> None:
        out[h["id"]] = build_record(h["id"], {**meta_all[h["id"]], "name": h["n"]}, ctx)
        print(".", end="", flush=True)

    with ThreadPoolExecutor(max_workers=4) as pool:
        list(pool.map(one, hubs))
    print("", flush=True)
    out = {h["id"]: out[h["id"]] for h in hubs if h["id"] in out}    # keep hub order

    generated = datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    doc = {"generated": generated, "config": CONFIG, "sources": SOURCES, "warnings": warnings, "hubs": out}
    if ONLY and MERGE:
        prev = json.loads(HAZARDS_JSON.read_text(encoding="utf-8")) if HAZARDS_JSON.exists() else {"hubs": {}, "warnings": []}
        keep = [w for w in prev.get("warnings") or [] if not any(w.startswith(i + " ") or w.startswith(i + ":") for i in ONLY)]
        merged = {**prev, "generated": generated, "config": CONFIG, "sources": SOURCES, "hubs": {**prev.get("hubs", {}), **out}, "warnings": keep + warnings}
        hublib.write_hazards(merged)
        print(f"Merged {', '.join(out)} into public/hazards.json ({len(warnings)} warnings).")
        return
    if ONLY:
        print(json.dumps(hublib.tidy(doc), ensure_ascii=False, indent=1)[:6000])
        print("\n--only run: nothing written.")
        return
    hublib.write_hazards(doc)

    # Coverage: which hazards have measured data for each hub.
    def mark(e):
        k = (e or {}).get("kind")
        return {"none": "–", None: "–", "own": "yours", "today": "today only", "own-change": "today + your change"}.get(k, "✓")
    md = (f"# Data coverage by hub\n\nGenerated {generated}. ✓ = measured for every horizon; \"today only\" = measured now, no projection yet; "
          "\"yours\" = entered by an admin; – = no data. Cyclones are history only (no projection yet); volcanoes and earthquakes don't change over time.\n\n"
          "| Hub | Heat | Flood | Water | Grid | Cyclone | Volcano | Earthquake | Wildfire |\n|---|---|---|---|---|---|---|---|---|\n")
    for h in hubs:
        r = out.get(h["id"], {})
        md += f"| {h['n']} ({h['id']}) | " + " | ".join(mark(r.get(k)) for k in ("heat", "flood", "water", "grid")) + " | " + \
              " | ".join(mark((r.get("other") or {}).get(k)) for k in ("cyclone", "volcano", "earthquake", "wildfire")) + " |\n"
    if warnings:
        md += "\n## Warnings\n\n" + "\n".join("- " + w for w in warnings) + "\n"
    (ROOT / "scripts" / "coverage.md").write_text(md, encoding="utf-8", newline="\n")
    print(f"Wrote public/hazards.json, public/hazards.js and scripts/coverage.md ({len(warnings)} warnings).")


if __name__ == "__main__":
    main()
