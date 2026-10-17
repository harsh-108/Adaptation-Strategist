"""Grid reliability: World Bank Doing Business "Getting electricity" outage statistics (DB16-20 methodology), measured
by the utility in each economy's main business city (two cities for the 11 largest economies): SAIDI, the hours
without power per customer a year, and SAIFI, the number of interruptions per customer a year. Latest year with
data (2019 for most). Keyless World Bank API. Doing Business was discontinued in 2021; these are the last published
measurements.

Measured data only: a place is scored only if it IS the measured city. Other places in the same country get
"No data" with the reason, because the national figure is the measured city (or the average of the two cities),
and the atlas never borrows or averages other cities' values."""
import math
import unicodedata

from ..common import clamp, get_json, js_round

CONFIG = {"saidiFor0": 0.1, "saidiFor100": 100, "saifiFor0": 0.1, "saifiFor100": 30}
SOURCES = [{"id": "wb-doingbusiness", "name": "World Bank Doing Business: SAIDI and SAIFI (Getting electricity, DB16-20 methodology)",
            "url": "https://data.worldbank.org/indicator/IC.ELC.SAID.XD.DB1619", "licence": "CC BY 4.0", "used": "Grid reliability"}]
IND = {"saidi": "IC.ELC.SAID.XD.DB1619", "saifi": "IC.ELC.SAIF.XD.DB1619"}
# The city Doing Business measured in each single-city economy the atlas covers (Doing Business 2020 methodology),
# with other names the atlas uses for the same place. The 11 largest economies' two cities come from the API itself.
DB_CITY = {"ARE": ("Dubai",), "AUS": ("Sydney",), "CAN": ("Toronto",), "CHE": ("Zurich",), "CHL": ("Santiago",), "COL": ("Bogota",),
           "DEU": ("Berlin",), "EGY": ("Cairo",), "ESP": ("Madrid",), "FRA": ("Paris",), "GBR": ("London",), "HKG": ("Hong Kong",),
           "IRL": ("Dublin",), "ITA": ("Rome",), "KEN": ("Nairobi",), "KOR": ("Seoul",), "MYS": ("Kuala Lumpur",), "NLD": ("Amsterdam",),
           "NOR": ("Oslo",), "NZL": ("Auckland",), "PER": ("Lima",), "PHL": ("Quezon City", "Manila", "Metro Manila"), "POL": ("Warsaw",),
           "QAT": ("Doha",), "SAU": ("Riyadh",), "SGP": ("Singapore",), "SWE": ("Stockholm",), "THA": ("Bangkok",), "TUR": ("Istanbul",),
           "VNM": ("Ho Chi Minh City", "Saigon"), "ZAF": ("Johannesburg",)}


def prepare(warn):
    """{iso3: {"country": {"saidi": (year, v), "saifi": ...}, "cities": {name: {...}}}}. For the 11 largest economies the
    World Bank also lists the two measured cities (e.g. Delhi and Mumbai); the national row is their weighted average."""
    names = {c["id"]: c["name"] for c in (get_json("https://api.worldbank.org/v2/country?format=json&per_page=400") or [None, []])[1]}
    out = {}
    for k, code in IND.items():
        j = get_json(f"https://api.worldbank.org/v2/country/all/indicator/{code}?format=json&date=2015:2020&per_page=3000")
        for r in (j[1] if isinstance(j, list) and len(j) > 1 and j[1] else []):
            iso, v, name = r.get("countryiso3code"), r.get("value"), (r.get("country") or {}).get("value")
            if not iso or v is None:
                continue
            slot = out.setdefault(iso, {"country": {}, "cities": {}})
            d = slot["country"] if name == names.get(iso) else slot["cities"].setdefault(name, {})
            if k not in d or int(r["date"]) > d[k][0]:
                d[k] = (int(r["date"]), float(v))
    # Economies whose indicator name differs from the country list (Turkiye, Viet Nam, Hong Kong SAR...) have one row,
    # which is the national row under another spelling. A real city row (e.g. Kano for Nigeria) stays a city.
    for iso, slot in out.items():
        if not slot["country"] and len(slot["cities"]) == 1:
            label = next(iter(slot["cities"]))
            if _norm(label)[:4] == _norm(names.get(iso, ""))[:4]:
                slot["country"] = slot["cities"].pop(label)
    print(f"World Bank grid reliability: {sum(1 for v in out.values() if 'saidi' in v['country'])} countries, "
          f"{sum(len(v['cities']) for v in out.values())} measured cities", flush=True)
    return out


def _log_score(v, lo, hi):
    return clamp(100 * math.log10(max(v, lo) / lo) / math.log10(hi / lo), 0, 100)


def _norm(s):
    s = unicodedata.normalize("NFKD", s)
    return "".join(ch for ch in s.lower() if ch.isascii() and ch.isalnum())


def for_hub(data, iso3, fallback=None, names=()):
    """names: the hub's name and other names; a measured city row is used when one matches."""
    c = CONFIG
    for code in (iso3, fallback):
        slot = (data or {}).get(code) if code else None
        if not slot:
            continue
        d, where = None, ""
        for city, cd in slot["cities"].items():                 # two-city economies: the city's own row
            if any(_norm(city) and _norm(city) in _norm(n) for n in names if n):
                d, where = cd, f"{city} (measured there)"
                break
        if d is None and code in DB_CITY and any(_norm(a) in _norm(n) for a in DB_CITY[code] for n in names if n):
            d, where = slot["country"], f"{DB_CITY[code][0]} (the city the World Bank measured for {code})"
        if d is None:
            measured = list(slot["cities"]) or list(DB_CITY.get(code, ()))[:1]
            return {"kind": "none", "src": [], "basis": (f"No measured outage data for this place. The World Bank measured "
                    f"{' and '.join(measured) if measured else 'another city'} for {code}; the atlas doesn't borrow or average other cities' figures.")}
        if "saidi" in d and "saifi" in d:
            (ys, saidi), (yf, saifi) = d["saidi"], d["saifi"]
            s1, s2 = _log_score(saidi, c["saidiFor0"], c["saidiFor100"]), _log_score(saifi, c["saifiFor0"], c["saifiFor100"])
            return {"kind": "today", "src": ["wb-doingbusiness"], "t": js_round((s1 + s2) / 2),
                    "raw": {"saidi": js_round(saidi, 2), "saifi": js_round(saifi, 2), "year": max(ys, yf), "entity": code, "where": where},
                    "summary": f"{js_round(saidi, 2)} hours without power and {js_round(saifi, 2)} interruptions per customer a year in {where} ({max(ys, yf)}, World Bank)",
                    "basis": (f"Utility-measured outages in {where} ({max(ys, yf)}, World Bank Doing Business): "
                              f"{js_round(saidi, 2)} hours without power and {js_round(saifi, 2)} interruptions per customer a year. "
                              f"Score = average of the two on log scales ({c['saidiFor0']} h = 0, {c['saidiFor100']} h = 100; "
                              f"{c['saifiFor0']} = 0, {c['saifiFor100']} interruptions = 100). No projection, so 2030 and 2050 show this value.")}
    return None
