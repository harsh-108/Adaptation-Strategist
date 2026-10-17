"""Hazard record for one site at its own coordinates, built exactly like a hub's (measured data only; nothing is
taken from the nearest hub). Used by the My sites page.

    echo {"lat":13.11,"lon":80.16,"iso2":"IN","iso3":"IND"} | python -m jobs.site_hazards
        prints {"record": {...}, "warnings": [...]}
    python -m jobs.site_hazards --samples
        builds scripts/sample-sites-data.json for the labelled sample sites in scripts/sample-sites.json
"""
import json
import sys

from app import hubs as hublib
from app.settings import ROOT

from . import build_hazards as bh

SAMPLES = ROOT / "scripts" / "sample-sites.json"
SAMPLES_DATA = ROOT / "scripts" / "sample-sites-data.json"


def meta_of(o: dict) -> dict:
    lat, lon = float(o["lat"]), float(o["lon"])
    if not (-90 <= lat <= 90 and -180 <= lon <= 180):
        raise SystemExit("Latitude or longitude is out of range.")
    iso2, iso3 = str(o.get("iso2") or "").upper()[:2], str(o.get("iso3") or "").upper()[:3]
    if len(iso2) != 2 or len(iso3) != 3:
        raise SystemExit("The site needs its country codes (2 and 3 letters).")
    return {"lat": round(lat, 4), "lon": round(lon, 4), "iso2": iso2, "iso3": iso3, "place": o.get("place") or ""}


def main() -> None:
    if "--samples" in sys.argv:
        groups = json.loads(SAMPLES.read_text(encoding="utf-8"))
        sites = [s for k, v in groups.items() if not k.startswith("_") for s in v]
        metas = {s["id"]: meta_of(s) for s in sites}
        ctx = bh.prepare(list(metas.values()))
        data = {sid: json.loads(json.dumps(bh.build_record(sid, m, ctx)).replace("at the hub", "at the site").replace("for this hub", "for this site"))
                for sid, m in metas.items()}
        SAMPLES_DATA.write_text(json.dumps(hublib.tidy({"warnings": bh.warnings, "records": data}), ensure_ascii=False, indent=1) + "\n",
                                encoding="utf-8", newline="\n")
        print(f"Wrote {SAMPLES_DATA.name}: {len(data)} sample sites ({len(bh.warnings)} warnings).")
        return
    m = meta_of(json.loads(sys.stdin.read() or "{}"))
    ctx = bh.prepare([m])
    rec = json.loads(json.dumps(bh.build_record("SITE", m, ctx)).replace("at the hub", "at the site").replace("for this hub", "for this site"))
    # Warnings about shared catalogues aren't about this site; keep the ones that name it.
    print("\n@@RESULT@@" + json.dumps(hublib.tidy({"record": rec, "warnings": [w.replace("SITE ", "", 1) for w in bh.warnings if w.startswith("SITE")]})))


if __name__ == "__main__":
    main()
