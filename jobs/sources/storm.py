"""Future change in tropical cyclone winds: STORM synthetic cyclones (Bloemendaal et al., 4TU.ResearchData, CC BY 4.0).
Present climate (1980-2017 IBTrACS-based) and future climate (2015-2050, SSP5-8.5, median of four high-resolution
models) return periods of fixed 10-minute wind speeds at 0.1° (about 10 km).

    python -m jobs.sources.storm      condense the two downloaded map packs into scripts/derived/storm.npz (a few MB)

Used only for the CHANGE: the atlas keeps today's measured cyclone history (NOAA IBTrACS) and scales it by STORM's
future-to-present ratio of how often 20 m/s (tropical storm) and 29 m/s (about Category 1) winds occur, like heat
uses measured temperatures plus modelled warming. STORM has no moderate-emissions run, so the moderate pathway keeps
today's history and says so."""
import io
import json
import zipfile

import numpy as np

from app.settings import CACHE_DIR, ROOT

from ..common import clamp, download, js_round

DERIVED = ROOT / "scripts" / "derived" / "storm.npz"
PRESENT = ("https://data.4tu.nl/file/0ea98bdd-5772-4da8-ae97-99735e891aff/3c839d73-e6c0-4d63-ae03-c0d05e734d57", "storm-present-fixed-wind-speeds-tif.zip")
FUTURE = ("https://data.4tu.nl/file/504c838e-2bd8-4d61-85a1-d495bdc560c3/6107d9db-5e6f-4ee7-b113-ce66c1e73aa1", "storm-future-median-fixed-wind-speeds-tif.zip")
BASINS = ["EP", "NA", "NI", "SI", "SP", "WP"]
SPEEDS = [20, 29]
CONFIG = {"stormSpeedsMs": SPEEDS, "stormFuture": "2015-2050, SSP5-8.5, median of 4 models", "stormMaxRatio": 3}
SOURCES = [{"id": "storm", "name": "STORM tropical cyclone wind speed return periods, present and future climate (Bloemendaal et al.)",
            "url": "https://doi.org/10.4121/14510817", "licence": "CC BY 4.0", "used": "Cyclone change to 2030 and 2050 (high emissions)"}]


def derive() -> None:
    import tifffile
    zp, zf = zipfile.ZipFile(download(*PRESENT, max_age_days=3650)), zipfile.ZipFile(download(*FUTURE, max_age_days=3650))
    out, meta = {}, {}
    for b in BASINS:
        for s in SPEEDS:
            for tag, z, name in (("p", zp, f"STORM_FIXED_WIND_SPEEDS_{b}_{s}_MS.tif"), ("f", zf, f"STORM_FIXED_WIND_SPEEDS_MEDIAN_{b}_{s}_MS.tif")):
                with tifffile.TiffFile(io.BytesIO(z.read(name))) as t:
                    page = t.pages[0]
                    a = page.asarray()
                    scale, tie = page.tags[33550].value, page.tags[33922].value
                meta[b] = {"lon0": tie[3], "lat0": tie[4], "dx": scale[0], "dy": scale[1], "shape": list(a.shape)}
                # Return period in years; 0 or not finite = never reached. float16 keeps about 3 significant digits.
                out[f"{b}_{s}_{tag}"] = np.clip(np.nan_to_num(a, nan=0.0), 0, 65000).astype(np.float16)
        print(f"STORM {b} done", flush=True)
    DERIVED.parent.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(DERIVED, meta=np.array(json.dumps(meta)), **out)
    print(f"Wrote {DERIVED.name} ({DERIVED.stat().st_size / 1e6:.1f} MB)")


def prepare(warn):
    if not DERIVED.exists():
        warn("storm: scripts/derived/storm.npz missing; run python -m jobs.sources.storm")
        return None
    z = np.load(DERIVED, allow_pickle=False)
    return {"meta": json.loads(str(z["meta"])), "grids": {k: z[k] for k in z.files if k != "meta"}}


def _rp(data, b, s, tag, lat, lon):
    m = data["meta"][b]
    for x in (lon, lon + 360, lon - 360):
        col = int(round((x - m["lon0"]) / m["dx"]))
        row = int(round((m["lat0"] - lat) / m["dy"]))
        if 0 <= row < m["shape"][0] and 0 <= col < m["shape"][1]:
            return round(float(data["grids"][f"{b}_{s}_{tag}"][row, col]), 2)
    return None


def change_at(data, lat, lon) -> dict | None:
    """Future/present ratio of yearly exceedance probability for each wind speed, from the basin covering the point
    where those winds happen most. None when no STORM basin reaches the point (no tropical cyclones there)."""
    best = None
    for b in BASINS:
        rp = {(s, t): _rp(data, b, s, t, lat, lon) for s in SPEEDS for t in ("p", "f")}
        if any(v is None for v in rp.values()):
            continue
        p20 = (1 / rp[(20, "p")] if rp[(20, "p")] else 0)
        if best is None or p20 > best["p20"]:
            best = {"basin": b, "p20": p20, "rp": rp}
    if best is None or not any(best["rp"].values()):
        return None
    out = {"basin": best["basin"]}
    for s in SPEEDS:
        p, f = best["rp"][(s, "p")], best["rp"][(s, "f")]
        pp, pf = (1 / p if p else 0), (1 / f if f else 0)
        out[s] = {"rpPresent": p or None, "rpFuture": f or None,
                  "ratio": None if pp == 0 else js_round(clamp(pf / pp, 0, CONFIG["stormMaxRatio"]), 2)}
    return out


if __name__ == "__main__":
    derive()
