"""Hub editing shared by the Manage hubs page and `python -m jobs.add_hub`.
Hubs live in public/data.js (map position) and scripts/hub-meta.json (coordinates, country codes, grid zone,
aliases, areas, and any measured values an admin entered). Scores never live here: they come only from the
open-data build (public/hazards.json)."""
import json
import math
import re

from .settings import DATA_JS, HAZARDS_JS, HAZARDS_JSON, META_JSON

REGIONS = ["Americas", "Europe", "Africa & Middle East", "Asia-Pacific"]
_ATLAS = re.compile(r"^([\s\S]*?window\.ATLAS_MAP=)(\{.*\})(;\s*)$", re.M)


class HubError(ValueError):
    """A problem with the submitted hub, worded for the person who submitted it."""


def js_round(x: float, digits: int = 0) -> float:
    """Round half up, like JavaScript's Math.round (Python's round() rounds half to even)."""
    f = 10 ** digits
    return math.floor(x * f + 0.5) / f


def tidy(o):
    """Write whole-number floats as integers, as JavaScript does, so files stay byte-identical."""
    if isinstance(o, float) and o.is_integer():
        return int(o)
    if isinstance(o, dict):
        return {k: tidy(v) for k, v in o.items()}
    if isinstance(o, list):
        return [tidy(v) for v in o]
    return o


def dumps_compact(o) -> str:
    return json.dumps(tidy(o), ensure_ascii=False, separators=(",", ":"))


def load() -> dict:
    src = DATA_JS.read_text(encoding="utf-8")
    m = _ATLAS.search(src)
    if not m:
        raise RuntimeError("Could not find window.ATLAS_MAP in public/data.js")
    return {"prefix": m.group(1), "suffix": m.group(3), "map": json.loads(m.group(2)),
            "meta": json.loads(META_JSON.read_text(encoding="utf-8"))}


def save(st: dict) -> None:
    DATA_JS.write_text(st["prefix"] + dumps_compact(st["map"]) + st["suffix"], encoding="utf-8", newline="\n")
    META_JSON.write_text(json.dumps(tidy(st["meta"]), ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")


def project(lon: float, lat: float) -> tuple[float, float]:
    """Natural Earth projection, fitted to the existing map (error under half a pixel)."""
    r = math.pi / 180
    p = lat * r
    p2 = p * p
    p4 = p2 * p2
    X = lon * r * (0.8707 - 0.131979 * p2 + p4 * (-0.013791 + p4 * (0.003971 * p2 - 0.001529 * p4)))
    Y = p * (1.007226 + p2 * (0.015085 + p4 * (-0.044475 + 0.028874 * p2 - 0.005916 * p4)))
    return js_round(500 + 182.8 * X, 1), js_round(260 - 182.7 * Y, 1)


def as_list(v) -> list[str]:
    items = v if isinstance(v, list) else str("" if v is None else v).split(",")
    return [str(x).strip() for x in items if str(x).strip()]


def _given(v) -> bool:
    return v is not None and v != "" and not (isinstance(v, list) and not v)


def _num(v):
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if math.isfinite(f) else None


def upsert(st: dict, o: dict, force: bool = False, mode: str = "") -> dict:
    """Add a hub, or update one with the same id. mode "add" refuses an id or place already in the atlas;
    mode "edit" needs the hub to exist. Raises HubError with a readable message."""
    hid = str(o.get("id") or "").strip().upper()
    need = ["id", "name", "country", "region", "lat", "lon", "iso3", "iso2"]
    miss = [k for k in need if not _given(o.get(k))]
    if miss:
        raise HubError(f"{hid or 'New hub'}: missing {', '.join(miss)}")
    if not re.fullmatch(r"[A-Z]{3,4}", hid):
        raise HubError(f"{hid}: the id must be 3 or 4 letters")
    if o["region"] not in REGIONS:
        raise HubError(f"{hid}: region must be one of {', '.join(REGIONS)}")
    if not re.fullmatch(r"[A-Za-z]{3}", str(o["iso3"])) or not re.fullmatch(r"[A-Za-z]{2}", str(o["iso2"])):
        raise HubError(f"{hid}: country codes must be 3 letters (ISO3) and 2 letters (ISO2)")
    lat, lon = _num(o["lat"]), _num(o["lon"])
    if lat is None or lon is None or abs(lat) > 85 or abs(lon) > 180:
        raise HubError(f"{hid}: latitude or longitude is out of range")
    name, country = str(o["name"]).strip()[:60], str(o["country"]).strip()[:60]
    hubs = st["map"]["hubs"]
    existing = next((h for h in hubs if h["id"] == hid), None)
    if mode == "add" and existing:
        raise HubError(f"The ID {hid} is already used by {existing['n']}. Choose another ID, or use Edit on {existing['n']} to change it.")
    if mode == "edit" and not existing:
        raise HubError(f"{hid} is not in the app any more. Add it as a new hub instead.")
    same = next((h for h in hubs if h["id"] != hid and h["n"].lower() == name.lower() and h["c"].lower() == country.lower()), None)
    if same and not force:
        raise HubError(f"{name}, {country} is already in the app as {same['id']}. Use Edit on it instead.")

    x, y = project(lon, lat)
    gap = lambda h: math.hypot(h["x"] - x, h["y"] - y)  # noqa: E731
    clash = next((h for h in hubs if h["id"] != hid and gap(h) < 1), None)
    if clash and not force:
        raise HubError(f"{hid}: lands on the same map spot as {clash['n']} ({clash['id']}). Treat it as part of that hub, or force it.")
    warnings = []
    close = [h["n"] for h in hubs if h["id"] != hid and gap(h) < 3]
    if close:
        warnings.append(f"Close to {', '.join(close)} on the map; zoom in to tell them apart.")

    old_meta = st["meta"].get(hid) or {}
    # Measured values an admin entered for this hub. Nothing is copied from other hubs: without data or an
    # entered value a hazard shows as "no data". A panel edit sends the current values, so an empty field
    # clears it; the command line keeps them unless given.
    own = {} if mode == "edit" else dict(old_meta.get("own") or {})
    if _given(o.get("grid")):
        g = [_num(v) for v in as_list(o["grid"])]
        if not g or any(v is None or v < 0 or v > 100 for v in g):
            raise HubError(f"{hid}: grid values must be numbers from 0 to 100")
        own["grid"] = [g[0], g[1] if len(g) > 1 else 0]
    fc = o.get("floodChange", o.get("flood-change"))
    if _given(fc):
        f = _num(fc)
        if f is None or f < 0 or f > 100:
            raise HubError(f"{hid}: flood change must be a number from 0 to 100")
        own["floodChange"] = f

    hub = {"id": hid, "n": name, "c": country, "r": o["region"], "x": x, "y": y}
    meta = {"lat": lat, "lon": lon, "place": str(o.get("place") or name)[:60], "iso3": str(o["iso3"]).upper(), "iso2": str(o["iso2"]).upper()}
    zone = o.get("zone") or o.get("emZone")
    if _given(zone):
        meta["emZone"] = str(zone).strip()
    if _given(o.get("eia")):
        meta["eia"] = str(o["eia"]).strip().upper()
    if _given(o.get("iso3Fallback") or old_meta.get("iso3Fallback")):
        meta["iso3Fallback"] = str(o.get("iso3Fallback") or old_meta.get("iso3Fallback"))
    if as_list(o.get("aliases")):
        meta["aliases"] = [a.lower() for a in as_list(o["aliases"])]
    if as_list(o.get("areas")):
        meta["areas"] = as_list(o["areas"])
    if old_meta.get("ukCarbon"):
        meta["ukCarbon"] = True
    if own:
        meta["own"] = own
    idx = next((i for i, h in enumerate(hubs) if h["id"] == hid), -1)
    if idx >= 0:
        hubs[idx] = hub
    else:
        hubs.append(hub)
    st["meta"][hid] = meta
    return {"id": hid, "updated": idx >= 0, "hub": tidy(hub), "meta": tidy(meta), "warnings": warnings}


def remove(st: dict, hid: str) -> dict:
    hid = str(hid or "").upper()
    hubs = st["map"]["hubs"]
    idx = next((i for i, h in enumerate(hubs) if h["id"] == hid), -1)
    if idx < 0:
        raise HubError(f"{hid}: no such hub")
    if len(hubs) <= 2:
        raise HubError("The app needs at least two hubs")
    hubs.pop(idx)
    st["meta"].pop(hid, None)
    return {"id": hid}


def write_hazards(doc: dict) -> None:
    """Write public/hazards.json and the browser copy public/hazards.js."""
    HAZARDS_JSON.write_text(json.dumps(tidy(doc), ensure_ascii=False, indent=1) + "\n", encoding="utf-8", newline="\n")
    HAZARDS_JS.write_text("/* Generated by jobs/build_hazards.py. Do not edit. */\nwindow.ATLAS_HAZARDS=" + dumps_compact(doc) + ";\n",
                          encoding="utf-8", newline="\n")


def drop_hazards(ids: list[str]) -> None:
    """Remove hubs from the generated open-data files."""
    if not HAZARDS_JSON.exists():
        return
    doc = json.loads(HAZARDS_JSON.read_text(encoding="utf-8"))
    for hid in ids:
        doc["hubs"].pop(hid, None)
        doc["warnings"] = [w for w in doc.get("warnings") or [] if not w.startswith(hid + " ") and not w.startswith(hid + ":")]
    write_hazards(doc)
