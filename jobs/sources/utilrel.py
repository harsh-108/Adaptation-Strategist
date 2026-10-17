"""Grid reliability from the utility that serves the place, for hubs the World Bank didn't measure.

- United States: EIA Form 861 "Reliability" files, 2020-2024 (keyless downloads, about 4.5 MB a year). Each hub is
  mapped to the utility that serves it, and we use its all-events figures (major event days included, as a data
  centre feels them): IEEE 1366 where the utility reports it, otherwise its own standard (EIA's "Other Standard"
  columns). SAIDI minutes and SAIFI per customer a year, averaged over the years with data.
- Quebec: Hydro-Quebec Distribution's gross continuity index (minutes of interruption per customer, all events, planned
  interruptions included) from its annual reports to the Regie de l'energie, 2020-2024. Hydro-Quebec serves all of
  Quebec, Montreal included, and publishes no interruption count on the same basis, so Montreal is scored on duration only.
- Taiwan: Taipower's published SAIDI and SAIFI (one utility serves the whole island, Taipei included), 2020-2024.
  Taipower lists its nationwide blackouts (2021, 2022) separately; the headline figures used here exclude them.

Figures cover the serving utility's whole service area (e.g. PG&E across northern California), not just the city.
Nothing is borrowed from another utility or averaged across utilities. Other places stay "No data".

Rebuild the derived file (after downloading the EIA zips into scripts/.cache/eia861/):
    python -m jobs.sources.utilrel"""
import io
import json
import math
import zipfile

from app.settings import ROOT

from ..common import clamp, js_round

DERIVED = ROOT / "scripts" / "derived" / "utility_reliability.json"
EIA_DIR = ROOT / "scripts" / ".cache" / "eia861"
YEARS = range(2020, 2025)
CONFIG = {"saidiFor0": 0.1, "saidiFor100": 100, "saifiFor0": 0.1, "saifiFor100": 30}   # same scales as the World Bank figures
SOURCES = [
    {"id": "eia861", "name": "US EIA Form 861: utility reliability (SAIDI, SAIFI), 2020-2024", "url": "https://www.eia.gov/electricity/data/eia861/",
     "licence": "US public domain", "used": "Grid reliability (US hubs)"},
    {"id": "hydroquebec", "name": "Hydro-Quebec Distribution annual reports to the Regie de l'energie (gross continuity index), 2020-2024",
     "url": "https://www.regie-energie.qc.ca/fr/participants/dossiers/R-9001-2024", "licence": "Public regulatory filing", "used": "Grid reliability (Montreal)"},
    {"id": "taipower", "name": "Taipower: supply reliability index (SAIDI, SAIFI)", "url": "https://service.taipower.com.tw/smartgrid/SupplyReliability/Index",
     "licence": "Published by Taipower", "used": "Grid reliability (Taipei)"},
]
# Hub -> (EIA utility number, state, utility name, note). The utility serving the hub's own location.
US_HUBS = {
    "ASH": (19876, "VA", "Dominion Energy Virginia (Virginia Electric & Power Co)", ""),
    "PHX": (803, "AZ", "Arizona Public Service", "Central Phoenix is APS territory; Salt River Project serves other parts of the metro."),
    "DFW": (44372, "TX", "Oncor Electric Delivery", ""),
    "SJC": (14328, "CA", "Pacific Gas & Electric", "San Jose is PG&E territory; neighbouring Santa Clara has its own city utility (Silicon Valley Power)."),
    "QWA": (14624, "WA", "Grant County PUD", ""),
    "ATL": (7140, "GA", "Georgia Power", ""),
    "ORD": (4110, "IL", "Commonwealth Edison (ComEd)", ""),
    "CMH": (14006, "OH", "AEP Ohio (Ohio Power Co)", ""),
}
# Taipower headline SAIDI (minutes) and SAIFI per customer a year, as published (read 16 Oct 2026).
TAIPOWER = {2020: (15.931, 0.230), 2021: (16.376, 0.233), 2022: (14.936, 0.181), 2023: (15.225, 0.186), 2024: (15.831, 0.209)}
TAIPOWER_MAJOR = {2021: (43.516, 0.864), 2022: (91.285, 0.467)}
# Hydro-Quebec Distribution, "Indice de continuite brut" (minutes per customer), HQD-3 tables in R-9001-2020, -2022 and -2024 (revised 2025-09-26).
HYDROQUEBEC = {2020: 256, 2021: 323, 2022: 821, 2023: 1008, 2024: 432}


def _num(v):
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if math.isfinite(f) else None


def derive() -> dict:
    from .gridindia import _sheets_xlsx
    out = {"generated": None, "hubs": {}}
    per = {h: {} for h in US_HUBS}
    for y in YEARS:
        path = EIA_DIR / f"f861{y}.zip"
        if not path.exists():
            print(f"  missing {path.name}; skipping {y}")
            continue
        z = zipfile.ZipFile(path)
        name = next(n for n in z.namelist() if n.lower().startswith("reliability"))
        rows = _sheets_xlsx(z.read(name))[0]
        head = next(i for i, r in enumerate(rows[:10]) if "Utility Number" in r)
        for r in rows[head + 1:]:
            try:
                num, state = int(float(r[1])), str(r[3]).strip()
            except (ValueError, IndexError):
                continue
            for hid, (unum, ust, _, _) in US_HUBS.items():
                if num != unum or state != ust:
                    continue
                ieee = (_num(r[5]), _num(r[6]))
                other = (_num(r[17]), _num(r[18])) if len(r) > 18 else (None, None)
                if ieee[0] is not None and ieee[1] is not None:
                    per[hid][y] = {"saidiMin": ieee[0], "saifi": ieee[1], "std": "IEEE 1366, all events"}
                elif other[0] is not None and other[1] is not None:
                    per[hid][y] = {"saidiMin": other[0], "saifi": other[1], "std": "the utility's own standard, all events"}
    for hid, yrs in per.items():
        if not yrs:
            continue
        unum, ust, uname, note = US_HUBS[hid]
        out["hubs"][hid] = {"src": "eia861", "utility": uname, "note": note, "years": {str(k): v for k, v in sorted(yrs.items())},
                            "saidiH": js_round(sum(v["saidiMin"] for v in yrs.values()) / len(yrs) / 60, 3),
                            "saifi": js_round(sum(v["saifi"] for v in yrs.values()) / len(yrs), 3),
                            "standards": sorted({v["std"] for v in yrs.values()})}
    out["hubs"]["YUL"] = {"src": "hydroquebec", "utility": "Hydro-Quebec", "note": "Gross index: every interruption of the medium-voltage network, planned work and transmission faults included; 2023 had the April ice storm. No interruption count on the same basis, so the score uses duration only.",
                          "years": {str(y): {"saidiMin": v, "saifi": None, "std": "Hydro-Quebec gross continuity index"} for y, v in HYDROQUEBEC.items()},
                          "saidiH": js_round(sum(HYDROQUEBEC.values()) / len(HYDROQUEBEC) / 60, 3), "saifi": None,
                          "standards": ["Hydro-Quebec gross continuity index, all events"]}
    out["hubs"]["TPE"] = {"src": "taipower", "utility": "Taipower", "note": "Taipower's nationwide blackouts are reported separately and not included: "
                          + "; ".join(f"{y} with them {s} min, {f} interruptions" for y, (s, f) in TAIPOWER_MAJOR.items()) + ".",
                          "years": {str(y): {"saidiMin": s, "saifi": f, "std": "Taipower headline figures (interruptions over 1 minute)"} for y, (s, f) in TAIPOWER.items()},
                          "saidiH": js_round(sum(s for s, _ in TAIPOWER.values()) / len(TAIPOWER) / 60, 3),
                          "saifi": js_round(sum(f for _, f in TAIPOWER.values()) / len(TAIPOWER), 3),
                          "standards": ["Taipower headline figures (interruptions over 1 minute)"]}
    from datetime import date
    out["generated"] = date.today().isoformat()
    DERIVED.parent.mkdir(parents=True, exist_ok=True)
    DERIVED.write_text(json.dumps(out, indent=1, ensure_ascii=False), encoding="utf-8", newline="\n")
    for hid, d in out["hubs"].items():
        print(f"  {hid}: {d['utility']}: {d['saidiH']} h" + (f", {d['saifi']} interruptions" if d.get("saifi") is not None else "") + f" a year ({', '.join(d['years'])})")
    return out


def prepare(warn):
    if not DERIVED.exists():
        warn("utility reliability: scripts/derived/utility_reliability.json missing (python -m jobs.sources.utilrel)")
        return None
    d = json.loads(DERIVED.read_text(encoding="utf-8"))
    print(f"Utility reliability: {len(d['hubs'])} hubs", flush=True)
    return d


def _log_score(v, lo, hi):
    return clamp(100 * math.log10(max(v, lo) / lo) / math.log10(hi / lo), 0, 100)


def for_hub(data, hid):
    d = ((data or {}).get("hubs") or {}).get(hid)
    if not d:
        return None
    c = CONFIG
    s1 = _log_score(d["saidiH"], c["saidiFor0"], c["saidiFor100"])
    s2 = _log_score(d["saifi"], c["saifiFor0"], c["saifiFor100"]) if d.get("saifi") is not None else None
    yrs = list(d["years"])
    span = yrs[0] if len(yrs) == 1 else f"{yrs[0]}-{yrs[-1]}"
    who = {"eia861": "EIA Form 861", "taipower": "Taipower", "hydroquebec": "Hydro-Quebec reports to the Regie de l'energie"}[d["src"]]
    freq = f" and {js_round(d['saifi'], 2)} interruptions" if s2 is not None else ""
    summary = f"{js_round(d['saidiH'], 2)} hours without power{freq} per customer a year from {d['utility']} ({span} average, {who})"
    scale = (f"Score = average of the two on log scales ({c['saidiFor0']} h = 0, {c['saidiFor100']} h = 100; {c['saifiFor0']} = 0, "
             f"{c['saifiFor100']} interruptions = 100)" if s2 is not None else f"Score = hours without power on a log scale ({c['saidiFor0']} h = 0, {c['saidiFor100']} h = 100)")
    return {"kind": "today", "src": [d["src"]], "t": js_round((s1 + s2) / 2 if s2 is not None else s1),
            "raw": {"saidi": js_round(d["saidiH"], 2), "saifi": js_round(d["saifi"], 2) if s2 is not None else None, "year": yrs[-1], "years": span, "utility": d["utility"],
                    "where": f"{d['utility']} (serves this place)"},
            "summary": summary,
            "basis": (f"Measured by the utility that serves this place, {d['utility']}, across its whole service area: "
                      f"{js_round(d['saidiH'], 2)} hours without power{freq} per customer a year, "
                      f"averaged over {span} ({'; '.join(d['standards'])}; {who}). {d.get('note') or ''} "
                      f"{scale}, the same scales as the World Bank figures. No projection, so 2030 and 2050 show this value.").replace("  ", " ")}


if __name__ == "__main__":
    derive()
