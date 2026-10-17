"""Grid reliability for Indian states: Grid-India (formerly POSOCO) daily Power Supply Position reports, section
"C. Power Supply Position in States": each state's energy met and energy shortage (MU), and its shortage at the
day's maximum demand (MW). These are measured by the load despatch centres: demand that could not be supplied
(load shedding for lack of power), not local distribution faults.

    python -m jobs.sources.gridindia     fetch financial years 2022-23 to 2024-25 (~270 MB streamed; nothing raw kept)
                                         into scripts/derived/grid_india.json (a few KB). Grid-India published only PDFs
                                         for April-December 2022, so the Excel series starts in January 2023.

Used for Indian places that are not a city the World Bank measured (Delhi and Mumbai keep their city data).
State-level data, labelled as such; a place outside the listed states stays "No data"."""
import io
import json
import math
import sys
import time

from app.settings import ROOT

from ..common import _http, clamp, js_round

DERIVED = ROOT / "scripts" / "derived" / "grid_india.json"
API = "https://webapi.grid-india.in/api/v1/file"
CDN = "https://webcdn.grid-india.in/"
YEARS = ["2022-23", "2023-24", "2024-25"]
MONTHS = ["04", "05", "06", "07", "08", "09", "10", "11", "12", "01", "02", "03"]
CONFIG = {"giYears": f"{YEARS[0]} to {YEARS[-1]}", "giEnsFor0": 0.001, "giEnsFor100": 1.0, "giShortDaysFor100": 0.5}
SOURCES = [{"id": "grid-india", "name": "Grid-India daily Power Supply Position reports (state energy and peak shortage)",
            "url": "https://grid-india.in/en/reports/daily-psp-report", "licence": "Government of India open data (credit Grid-India)",
            "used": "Grid reliability, Indian states"}]
# The report's state names, and the names the atlas's places use (state of each Indian hub, by name or alias).
STATE_ALIASES = {"MP": ["madhya pradesh"], "HP": ["himachal pradesh"], "UP": ["uttar pradesh"], "J&K(UT) & Ladakh(UT)": ["jammu and kashmir", "ladakh"],
                 "West Bengal": ["west bengal"], "Tamil Nadu": ["tamil nadu"], "Telangana": ["telangana"], "Karnataka": ["karnataka"],
                 "Maharashtra": ["maharashtra"], "Rajasthan": ["rajasthan"], "Andhra Pradesh": ["andhra pradesh"], "Delhi": ["delhi"],
                 "Gujarat": ["gujarat"], "Kerala": ["kerala"], "Haryana": ["haryana"], "Punjab": ["punjab"], "Odisha": ["odisha"], "Bihar": ["bihar"]}


# States of the atlas's Indian hubs (a site's own state comes from its place name, e.g. "Hinjawadi, Maharashtra").
CITY_STATE = {"mumbai": "Maharashtra", "pune": "Maharashtra", "chennai": "Tamil Nadu", "delhi": "Delhi", "hyderabad": "Telangana",
              "bengaluru": "Karnataka", "bangalore": "Karnataka", "kolkata": "West Bengal", "indore": "MP", "visakhapatnam": "Andhra Pradesh",
              "vizag": "Andhra Pradesh", "jaipur": "Rajasthan", "shimla": "HP"}


def _key(name: str) -> str:
    n = " ".join(str(name).split())
    for k in STATE_ALIASES:
        if n.lower().replace(" ", "") == k.lower().replace(" ", ""):
            return k
    return n


def _sheets_xls(data: bytes) -> list:
    import xlrd
    wb = xlrd.open_workbook(file_contents=data)
    return [[[sh.cell_value(r, c) for c in range(sh.ncols)] for r in range(sh.nrows)] for sh in wb.sheets()]


def _sheets_xlsx(data: bytes) -> list:
    """Minimal .xlsx reader (standard library only): cell values of every sheet as rows of strings."""
    import re
    import zipfile
    from xml.etree import ElementTree as ET
    ns = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
    z = zipfile.ZipFile(io.BytesIO(data))
    shared = []
    if "xl/sharedStrings.xml" in z.namelist():
        for si in ET.fromstring(z.read("xl/sharedStrings.xml")).findall("m:si", ns):
            shared.append("".join(t.text or "" for t in si.iter("{%s}t" % ns["m"])))
    out = []
    for name in sorted(n for n in z.namelist() if re.match(r"xl/worksheets/sheet\d+\.xml$", n)):
        rows = {}
        for c in ET.fromstring(z.read(name)).iter("{%s}c" % ns["m"]):
            ref = c.get("r", "")
            letters, num = re.match(r"([A-Z]+)(\d+)", ref).groups()
            col = 0
            for ch in letters:
                col = col * 26 + ord(ch) - 64
            v = c.find("m:v", ns)
            t = c.get("t")
            if t == "s" and v is not None:
                val = shared[int(v.text)]
            elif t == "inlineStr":
                val = "".join(x.text or "" for x in c.iter("{%s}t" % ns["m"]))
            else:
                val = v.text if v is not None else ""
            rows.setdefault(int(num) - 1, {})[col - 1] = val
        n = max(rows) + 1 if rows else 0
        width = max((max(r) + 1 for r in rows.values() if r), default=0)
        out.append([[rows.get(r, {}).get(c, "") for c in range(width)] for r in range(n)])
    return out


def parse(data: bytes) -> dict:
    """{state: (energy met MU, energy shortage MU, shortage at max demand MW)} from one daily report (.xls or .xlsx)."""
    sheets = _sheets_xlsx(data) if data[:2] == b"PK" else _sheets_xls(data)
    for sh in sheets:
        cell = lambda r, c: sh[r][c] if r < len(sh) and c < len(sh[r]) else ""  # noqa: E731
        start = next((r for r in range(min(len(sh), 200)) if any("Power Supply Position in States" in str(v) for v in sh[r])), None)
        if start is None:
            continue
        ncols = max(len(r) for r in sh)
        head = [" ".join(str(cell(r, c)) for r in (start + 1, start + 2)).lower() for c in range(ncols)]
        col = {"met": next(i for i, h in enumerate(head) if "energy met" in h),
               "short": max(i for i, h in enumerate(head) if "shortage" in h and "mu" in h),
               "peak": next(i for i, h in enumerate(head) if "shortage during" in h or ("shortage" in h and "mw" in h))}
        name_col = next(i for i, h in enumerate(head) if "states" in h)
        out = {}
        for r in range(start + 3, len(sh)):
            name = str(cell(r, name_col)).strip()
            if not name:
                break
            try:
                out[_key(name)] = tuple(float(cell(r, col[k]) or 0) for k in ("met", "short", "peak"))
            except (TypeError, ValueError):
                continue
        return out
    raise ValueError("no state table")


def derive() -> None:
    agg, done, failed = {}, 0, []
    for fy in YEARS:
        for mo in MONTHS:
            for attempt in range(3):
                try:
                    lst = _http.post(API, json={"_source": "GRDW", "_type": "DAILY_PSP_REPORT", "_fileDate": fy, "_month": mo}, timeout=60).json()["retData"]
                    break
                except Exception:  # noqa: BLE001
                    if attempt == 2:
                        raise
                    time.sleep(5)
            files = {}
            for f in lst:                                  # one .xls per day (some days also have a PDF)
                if f["FilePath"].lower().endswith((".xls", ".xlsx")):
                    files.setdefault(f["Title_"], f["FilePath"])
            for title, path in sorted(files.items()):
                try:
                    data = _http.get(CDN + path, timeout=120).content
                    day = parse(data)
                except Exception as e:  # noqa: BLE001
                    failed.append(f"{title}: {str(e)[:80]}")
                    continue
                for st, (met, short, peak) in day.items():
                    a = agg.setdefault(st, {}).setdefault(fy, {"met": 0.0, "short": 0.0, "days": 0, "shortDays": 0, "peakDays": 0, "maxPeakMw": 0.0})
                    a["met"] += met
                    a["short"] += short
                    a["days"] += 1
                    a["shortDays"] += short > 0
                    a["peakDays"] += peak > 0
                    a["maxPeakMw"] = max(a["maxPeakMw"], peak)
                done += 1
            print(f"  {fy} month {mo}: {len(files)} files ({done} parsed so far, {len(failed)} failed)", flush=True)
    DERIVED.parent.mkdir(parents=True, exist_ok=True)
    DERIVED.write_text(json.dumps({"years": YEARS, "files": done, "failed": failed[:50], "states": agg}, indent=1), encoding="utf-8", newline="\n")
    print(f"Wrote {DERIVED.name}: {len(agg)} states from {done} daily reports ({len(failed)} failed).")


def prepare(warn):
    if not DERIVED.exists():
        warn("grid-india: scripts/derived/grid_india.json missing; run python -m jobs.sources.gridindia")
        return None
    d = json.loads(DERIVED.read_text(encoding="utf-8"))
    print(f"Grid-India: {len(d['states'])} states, {d['files']} daily reports", flush=True)
    return d


def for_hub(data, iso3, names=()):
    """State-level unmet demand for a place in India, matched by the place's names (e.g. "Tamil Nadu" in its aliases)."""
    if not data or iso3 != "IND":
        return None
    text = " ".join(str(n).lower() for n in names if n)
    state = next((k for k, al in STATE_ALIASES.items() if any(a in text for a in al) and k != "Delhi"), None) or \
        next((s for city, s in CITY_STATE.items() if city in text), None)
    yrs = (data["states"].get(state) or {}) if state else {}
    if not yrs:
        return None
    met = sum(v["met"] for v in yrs.values())
    short = sum(v["short"] for v in yrs.values())
    days = sum(v["days"] for v in yrs.values())
    pdays = sum(v["peakDays"] for v in yrs.values())
    if not days or met <= 0:
        return None
    c = CONFIG
    ens = short / (met + short) * 100                                  # % of demand not supplied
    s1 = clamp(100 * math.log10(max(ens, c["giEnsFor0"]) / c["giEnsFor0"]) / math.log10(c["giEnsFor100"] / c["giEnsFor0"]), 0, 100)
    s2 = clamp(100 * (pdays / days) / c["giShortDaysFor100"], 0, 100)
    pretty = {"MP": "Madhya Pradesh", "HP": "Himachal Pradesh", "UP": "Uttar Pradesh"}.get(state, state)
    span = f"{days} daily reports, {min(yrs)} to {max(yrs)}"
    summary = (f"{js_round(ens, 3)}% of electricity demand in {pretty} went unsupplied and the state was short at its daily peak on "
               f"{js_round(pdays / days * 100, 1)}% of days ({span}, Grid-India; state-level)")
    return {"kind": "today", "src": ["grid-india"], "t": js_round((s1 + s2) / 2),
            "raw": {"state": pretty, "ensPct": js_round(ens, 4), "peakShortDaysPct": js_round(pdays / days * 100, 1), "days": days,
                    "shortMU": js_round(short, 1), "years": f"{min(yrs)} to {max(yrs)}"},
            "summary": summary,
            "basis": (f"{summary[0].upper() + summary[1:]}. These are shortages of supply measured by the load despatch centres, not local "
                      f"distribution faults. Score = average of unmet energy on a log scale ({c['giEnsFor0']}% = 0, {c['giEnsFor100']}% = 100) and "
                      f"days short at peak ({int(c['giShortDaysFor100'] * 100)}% of days = 100). State-level data; no projection, so 2030 and 2050 show this value.")}


if __name__ == "__main__":
    derive()
