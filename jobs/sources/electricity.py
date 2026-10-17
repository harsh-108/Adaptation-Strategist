"""National electricity data from Ember, via Our World in Data (keyless CSV downloads, CC BY 4.0):
grid carbon intensity (gCO2 per kWh) and total electricity demand (TWh a year), by country, latest year and ten
years earlier. Used for data centres' own impact: emissions and their share of the country's electricity."""
import csv

from ..common import download, js_round

SOURCES = [
    {"id": "owid-ember", "name": "Ember electricity data via Our World in Data (carbon intensity, total demand)",
     "url": "https://ourworldindata.org/electricity-mix", "licence": "CC BY 4.0", "used": "Grid carbon, national electricity demand"},
]
FILES = {
    "carbon": ("carbon-intensity-electricity", "co2_intensity__gco2_kwh"),
    "demand": ("electricity-demand", "total_demand__twh"),
}


def prepare(warn):
    out = {}
    for key, (slug, col) in FILES.items():
        path = download(f"https://ourworldindata.org/grapher/{slug}.csv?v=1&csvType=full&useColumnShortNames=true", f"owid-{slug}.csv", max_age_days=30)
        series = {}
        with path.open(newline="", encoding="utf-8") as fh:
            for row in csv.DictReader(fh):
                code, val = row.get("code"), row.get(col)
                if code and val not in (None, ""):
                    series.setdefault(code, {})[int(row["year"])] = float(val)
        out[key] = series
    print(f"Electricity data: {len(out['carbon'])} countries", flush=True)
    return out


def for_hub(data, iso3, fallback=None):
    """{"gridCarbon": {...}, "electricity": {...}} for the hub's country, or {} when there is no data."""
    res = {}
    for code in (iso3, fallback):
        if not code:
            continue
        c, d = data["carbon"].get(code), data["demand"].get(code)
        if c and "gridCarbon" not in res:
            y = max(c)
            past = next((p for p in (y - 10, y - 9, y - 11) if p in c), None)
            res["gridCarbon"] = {"g": js_round(c[y]), "year": y, "entity": code, "src": "owid-ember",
                                 **({"past": {"year": past, "g": js_round(c[past])}} if past else {})}
        if d and "electricity" not in res:
            y = max(d)
            res["electricity"] = {"demandTWh": js_round(d[y], 1), "year": y, "entity": code, "src": "owid-ember"}
    return res
