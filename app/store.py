"""The open-data hazard file (public/hazards.json) and the plain-language evidence lines given to the AI."""
import json
import time

from .settings import HAZARDS_JSON

HAZ: dict | None = None
LIVE_TTL = 60 * 60          # seconds
live_cache: dict = {}       # hub id -> {"at": epoch seconds, "data": {...}} or {"pending": task}


def load_haz() -> None:
    global HAZ
    try:
        HAZ = json.loads(HAZARDS_JSON.read_text(encoding="utf-8"))
    except Exception:  # noqa: BLE001
        HAZ = None
        print("No public/hazards.json, so no scores are available. Run: python -m jobs.build_hazards")


load_haz()


def scen_key(h: str, p: str) -> str:
    return "t" if h == "today" else ("m" if p == "mod" else "h") + ("30" if h == "2030" else "50")


def _none(e) -> bool:
    return not e or e.get("kind") == "none"


def _v(x):
    return "?" if x is None else x


def evidence_for(hid: str, horizon: str, pathway: str) -> dict | None:
    """What is measured, entered or missing for a hub, with sources, for the AI prompts and the rule fallback."""
    r = (HAZ or {}).get("hubs", {}).get(hid)
    if not r:
        return None
    k = scen_key(horizon, pathway)
    cf = (HAZ or {}).get("config") or {}
    when = "1991 to 2020" if k == "t" else "projected"
    ev = {}
    if not _none(r.get("heat")):
        h = r["heat"]
        ev["heat"] = (f"{_v(h['raw'].get(k))} days a year at or above {cf.get('heatThresholdC')} °C and {_v((h.get('rawCdd') or {}).get(k))} "
                      f"cooling degree days ({when}; NASA POWER, World Bank CMIP6 warming)")
    if not _none(r.get("water")):
        w = r["water"]
        ev["water"] = f"Aqueduct water stress {_v(w['raw'].get(k))} of 5" + (f" ({w.get('label')})" if k == "t" else f", from {w['raw'].get('t')} today") + " (WRI Aqueduct)"
    if not _none(r.get("flood")):
        f = r["flood"]
        tail = "" if k == "t" else ("; the change to " + horizon + " was entered by an admin" if f.get("kind") == "own-change"
                                    else "; no projection yet, so the " + horizon + " score is today's value")
        river, coast = f["raw"].get("river"), f["raw"].get("coastal")
        ev["flood"] = f"Aqueduct flood risk today: river {'n/a' if river is None else river}, coastal {'n/a' if coast is None else coast} of 5 (WRI Aqueduct){tail}"
    if (r.get("grid") or {}).get("kind") == "own":
        ev["grid"] = r["grid"]["basis"]
    elif not _none(r.get("grid")) and r["grid"].get("summary"):
        ev["grid"] = r["grid"]["summary"] + " (national or city utility data; no projection)"
    other = r.get("other") or {}
    for key in ("cyclone", "volcano", "earthquake", "wildfire"):
        o = other.get(key)
        if not _none(o) and o.get("summary"):
            if key == "cyclone" and o.get("kind") == "modelled" and k.startswith("h"):
                tail = f"; high emissions: STORM changes 20 m/s winds by x{o['change']['ratio20']} and Category-1 winds by x{o['change']['ratio29']}, giving {o.get(k)}"
            elif key in ("cyclone", "wildfire"):
                tail = "" if k == "t" else ("; no projection yet, so this is the historical value" if key == "wildfire"
                                            else "; no projection for this pathway, so this is the historical value")
            else:
                tail = "; doesn't change over time"
            ev[key] = o["summary"] + tail
    ev["missing"] = [x for x in ("heat", "water", "flood", "grid") if _none(r.get(x))] + [x for x in ("cyclone", "volcano", "earthquake", "wildfire") if _none(other.get(x))]
    x, extras = r.get("extra") or {}, []
    if x.get("facilities"):
        extras.append(f"{x['facilities']['n']} data centre facilities listed within {x['facilities']['radiusKm']} km (PeeringDB)")
    sl = x.get("seaLevel")
    if sl:
        p = "mod" if pathway == "mod" else "high"
        y = sl[p]["2050"]
        extras.append(f"sea level at the nearest tide gauge ({sl['km']} km): +{y['mid']} cm by 2050, likely {y['lo']} to {y['hi']} cm "
                      f"({'moderate' if p == 'mod' else 'high'} emissions, IPCC AR6; context, not scored)")
    if x.get("solar"):
        extras.append(f"solar resource {x['solar']['kwhM2Day']} kWh/m²/day (NASA POWER)")
    if x.get("gridCarbon"):
        extras.append(f"national grid carbon {x['gridCarbon']['g']} gCO2/kWh in {x['gridCarbon']['year']} (Ember)")
    live = live_cache.get(hid)
    now = []
    if live and "data" in live and time.time() - live["at"] < LIVE_TTL:
        now = [f"{i['label']}: {i['value']}{' ' + i['unit'] if i.get('unit') else ''}{' (' + i['detail'] + ')' if i.get('detail') else ''} [{i['source']}]"
               for i in live["data"]["items"] if i.get("status") == "ok"]
    return {**ev, "extras": extras, "live": now}


def evidence_text(e: dict | None) -> str:
    if not e:
        return "No measured data for this hub."
    lines = [e.get("heat") and "Heat: " + e["heat"], e.get("water") and "Water: " + e["water"], e.get("flood") and "Flood: " + e["flood"],
             e.get("grid") and "Grid reliability: " + e["grid"], e.get("cyclone") and "Cyclones: " + e["cyclone"],
             e.get("volcano") and "Volcanoes: " + e["volcano"], e.get("earthquake") and "Earthquakes: " + e["earthquake"],
             e.get("wildfire") and "Wildfire: " + e["wildfire"],
             e["missing"] and "No data (left out of the overall score, never estimated): " + ", ".join("grid reliability" if k == "grid" else k for k in e["missing"]),
             e["extras"] and "Other: " + "; ".join(e["extras"]), e["live"] and "Live readings now: " + "; ".join(e["live"])]
    return "\n".join(x for x in lines if x)
