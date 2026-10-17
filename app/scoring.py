"""The atlas's scoring, in Python, for server-side alerts. Must match public/app.js (scoresOf, comp, band):
measured hazards only; overall = 60% their mean + 40% the worst; no data = left out."""
import math

HZK = ["heat", "flood", "water", "grid", "cyclone", "volcano", "earthquake", "wildfire"]
SCEN_LABEL = {"t": "today", "m30": "2030, moderate emissions", "h30": "2030, high emissions",
              "m50": "2050, moderate emissions", "h50": "2050, high emissions"}


def js_round(x: float) -> int:
    return math.floor(x + 0.5)


def scores(rec: dict | None, key: str) -> list:
    rec, out = rec or {}, []
    other = rec.get("other") or {}
    for k in HZK:
        e = rec.get(k) or other.get(k)
        if not e or e.get("kind") == "none" or e.get("t") is None:
            out.append(None)
        else:
            out.append(e[key] if e.get(key) is not None else e["t"])
    return out


def comp(sc: list):
    m = [v for v in sc if v is not None]
    if not m:
        return None
    return js_round(0.6 * sum(m) / len(m) + 0.4 * max(m))


def band(c) -> str:
    if c is None:
        return "No data"
    return "Low" if c < 35 else "Moderate" if c < 55 else "High" if c < 70 else "Severe"
