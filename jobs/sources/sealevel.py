"""Sea level rise: IPCC AR6 regional projections (Fox-Kemper et al. 2021; Garner et al. 2021, Zenodo, CC BY 4.0),
total relative sea level change (medium confidence) for SSP2-4.5 and SSP5-8.5. Only the ~1,030 tide-gauge locations
are kept (the 1° grid also covers land, so it can't tell a coastal place from an inland one); a place gets a value
when a gauge is within seaLevelCoastKm, and the figure shown is that gauge's, including its local land motion.

    python -m jobs.sources.sealevel   pull the two files out of the 9 GB archive (about 146 MB) and condense them into
                                      scripts/derived/sealevel.npz (a few MB)

Shown as context for coastal places (rise by 2030 and 2050 with the likely range), not scored: without the site's
elevation and defences, sea level alone can't be turned into a risk score honestly."""
import json
import struct
import zlib

import numpy as np

from app.settings import CACHE_DIR, ROOT

from ..common import _http, js_round, km

DERIVED = ROOT / "scripts" / "derived" / "sealevel.npz"
ZIP_URL = "https://zenodo.org/records/6382554/files/ar6-regional-confidence.zip?download=1"
MEMBERS = {"mod": "ar6-regional-confidence/regional/confidence_output_files/medium_confidence/ssp245/total_ssp245_medium_confidence_values.nc",
           "high": "ar6-regional-confidence/regional/confidence_output_files/medium_confidence/ssp585/total_ssp585_medium_confidence_values.nc"}
YEARS = [2030, 2050]
QUANTS = [0.17, 0.5, 0.83]
CONFIG = {"seaLevelCoastKm": 30, "seaLevelBaseline": "1995-2014"}
SOURCES = [{"id": "ar6-sealevel", "name": "IPCC AR6 regional sea level projections (medium confidence, total relative change)",
            "url": "https://doi.org/10.5281/zenodo.6382554", "licence": "CC BY 4.0", "used": "Sea level rise (context, not scored)"}]


def _central_directory():
    c = _http
    size = int(c.head(ZIP_URL, follow_redirects=True).headers["content-length"])
    tail = c.get(ZIP_URL, headers={"Range": f"bytes={size - 65_000}-{size - 1}"}).content
    i = tail.rfind(b"PK\x06\x06")
    cd_size, cd_off = struct.unpack("<QQ", tail[i + 40:i + 56])
    cd = c.get(ZIP_URL, headers={"Range": f"bytes={cd_off}-{cd_off + cd_size - 1}"}).content
    p, out = 0, {}
    while cd[p:p + 4] == b"PK\x01\x02":
        method = struct.unpack("<H", cd[p + 10:p + 12])[0]
        csize, usize = struct.unpack("<II", cd[p + 20:p + 28])
        n, e, k = struct.unpack("<HHH", cd[p + 28:p + 34])
        off = struct.unpack("<I", cd[p + 42:p + 46])[0]
        name, extra = cd[p + 46:p + 46 + n].decode(), cd[p + 46 + n:p + 46 + n + e]
        j = 0
        while j < len(extra):
            hid, hl = struct.unpack("<HH", extra[j:j + 4])
            if hid == 1:
                vals = list(struct.unpack("<" + "Q" * (hl // 8), extra[j + 4:j + 4 + hl]))
                if usize == 0xFFFFFFFF:
                    usize = vals.pop(0)
                if csize == 0xFFFFFFFF:
                    csize = vals.pop(0)
                if off == 0xFFFFFFFF:
                    off = vals.pop(0)
            j += 4 + hl
        out[name] = {"method": method, "csize": csize, "usize": usize, "offset": off}
        p += 46 + n + e + k
    return out


def _extract(entry, dest) -> None:
    """Fetch one member's bytes with HTTP range requests and inflate it, without downloading the whole archive."""
    hdr = _http.get(ZIP_URL, headers={"Range": f"bytes={entry['offset']}-{entry['offset'] + 29}"}).content
    n, e = struct.unpack("<HH", hdr[26:30])
    start = entry["offset"] + 30 + n + e
    d = zlib.decompressobj(-15) if entry["method"] == 8 else None
    tmp = dest.with_suffix(".part")
    with _http.stream("GET", ZIP_URL, headers={"Range": f"bytes={start}-{start + entry['csize'] - 1}"}, timeout=900) as r, tmp.open("wb") as fh:
        r.raise_for_status()
        for chunk in r.iter_bytes(1 << 20):
            fh.write(d.decompress(chunk) if d else chunk)
        if d:
            fh.write(d.flush())
    tmp.replace(dest)


def derive() -> None:
    import h5py
    cd = None
    data = {}
    for k, member in MEMBERS.items():
        dest = CACHE_DIR / ("ar6-" + member.rsplit("/", 1)[1])
        if not dest.exists():
            cd = cd or _central_directory()
            print(f"Extracting {member.rsplit('/', 1)[1]} ({cd[member]['csize'] / 1e6:.0f} MB)", flush=True)
            _extract(cd[member], dest)
        with h5py.File(dest, "r") as f:
            years, quants = f["years"][:].tolist(), [round(float(q), 3) for q in f["quantiles"][:]]
            yi, qi = [years.index(y) for y in YEARS], [quants.index(q) for q in QUANTS]
            slc = f["sea_level_change"]                      # (quantiles, years, locations), mm
            units = slc.attrs.get("units", b"mm")
            gauge = f["locations"][:] < 1_000_000                # grid points have ids from 1,000,000,000
            vals = np.stack([np.stack([slc[q, y, :][gauge] for y in yi]) for q in qi])   # (3, 2, gauges)
            data[k] = vals.astype(np.int16)
            data["lat"], data["lon"], data["id"] = f["lat"][:][gauge].astype(np.float32), f["lon"][:][gauge].astype(np.float32), f["locations"][:][gauge]
            print(f"{k}: {vals.shape[-1]} locations, units {units}", flush=True)
    DERIVED.parent.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(DERIVED, lat=data["lat"], lon=data["lon"], id=data["id"], mod=data["mod"], high=data["high"],
                        meta=np.array(json.dumps({"years": YEARS, "quantiles": QUANTS, "units": "mm"})))
    print(f"Wrote {DERIVED.name} ({DERIVED.stat().st_size / 1e6:.1f} MB)")


def prepare(warn):
    if not DERIVED.exists():
        warn("sea level: scripts/derived/sealevel.npz missing; run python -m jobs.sources.sealevel")
        return None
    z = np.load(DERIVED, allow_pickle=False)
    ok = ~np.isnan(z["lat"]) & (np.abs(z["high"][1, 1]) < 30000)
    return {"lat": z["lat"][ok], "lon": z["lon"][ok], "id": z["id"][ok], "mod": z["mod"][:, :, ok], "high": z["high"][:, :, ok]}


def for_hub(data, lat, lon):
    """Projected rise at the nearest tide gauge within seaLevelCoastKm, or None (inland, or no gauge nearby)."""
    d2 = (data["lat"] - lat) ** 2 + ((data["lon"] - lon + 180) % 360 - 180) ** 2 * np.cos(np.radians(lat)) ** 2
    i = int(np.argmin(d2))
    dist = km(lat, lon, float(data["lat"][i]), float(data["lon"][i]))
    if dist > CONFIG["seaLevelCoastKm"]:
        return None
    out = {"km": js_round(dist, 1), "gauge": int(data["id"][i]), "src": "ar6-sealevel", "baseline": CONFIG["seaLevelBaseline"]}
    for p in ("mod", "high"):
        out[p] = {str(y): {"lo": int(data[p][0, j, i]) / 10, "mid": int(data[p][1, j, i]) / 10, "hi": int(data[p][2, j, i]) / 10} for j, y in enumerate(YEARS)}
    return out


if __name__ == "__main__":
    derive()
