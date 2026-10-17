"""In-app alerts (nothing is emailed). Two kinds:
- data: a hub you watch, or one of your own sites, moves to a different risk band (today, or 2050 high emissions)
  after its data is rebuilt. Checked whenever you open the atlas, and by the background check.
- live: a live reading at a place you follow passes a limit you set (today's forecast high, wet-bulb temperature,
  PM2.5, river flow against its 30-day median). Checked every ALERT_MINUTES by the server, or with "Check now".
Readings come from Google's Weather and Air Quality APIs when GOOGLE_MAPS_API_KEY is set, otherwise (or if Google has no
answer) from Open-Meteo (no key); river flow always comes from Open-Meteo. Each rule fires at most once every 12 hours."""
import asyncio
import json
import statistics
import time

import httpx

from . import auth, gmaps, scoring, store
from .live import r1, wet_bulb
from .settings import env

ALERT_MINUTES = max(5, int(env("ALERT_MINUTES", "30") or 30))
WATCH_SCEN = ("t", "h50")
MAX_WATCH, MAX_RULES = 30, 40
REFIRE_S = 12 * 3600
METRICS = {
    "tmax": {"label": "Today's forecast high", "unit": "°C", "hint": "e.g. 40", "min": -30, "max": 60},
    "wetbulb": {"label": "Wet-bulb temperature now", "unit": "°C", "hint": "e.g. 28", "min": -20, "max": 40},
    "pm25": {"label": "PM2.5 now (modelled)", "unit": "µg/m³", "hint": "e.g. 75", "min": 0, "max": 1000},
    "river": {"label": "River flow vs its 30-day median", "unit": "%", "hint": "e.g. 200", "min": 0, "max": 10000},
}
_readings: dict = {}            # (lat, lon) -> {"at": t, "v": {...}}


class AlertError(ValueError):
    """A problem with an alert request, worded for the person who made it."""


def init() -> None:
    with auth._lock, auth._db() as con:
        con.executescript("""
        CREATE TABLE IF NOT EXISTS watches (user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, kind TEXT NOT NULL, ref TEXT NOT NULL,
          created REAL NOT NULL, PRIMARY KEY (user_id, kind, ref));
        CREATE TABLE IF NOT EXISTS alert_snaps (user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, kind TEXT NOT NULL, ref TEXT NOT NULL,
          scen TEXT NOT NULL, comp INTEGER, band TEXT NOT NULL, PRIMARY KEY (user_id, kind, ref, scen));
        CREATE TABLE IF NOT EXISTS alert_rules (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, kind TEXT NOT NULL,
          ref TEXT NOT NULL, metric TEXT NOT NULL, threshold REAL NOT NULL, last_value REAL, last_checked REAL, last_fired REAL, created REAL NOT NULL);
        CREATE TABLE IF NOT EXISTS alerts (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, kind TEXT NOT NULL,
          place TEXT NOT NULL, title TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '', created REAL NOT NULL, read INTEGER NOT NULL DEFAULT 0);
        CREATE INDEX IF NOT EXISTS alerts_user ON alerts(user_id, created);
        """)


# ---------- places a user follows ----------
def _hub_name(hid: str) -> str:
    try:
        from . import hubs
        for h in hubs.load()["map"]["hubs"]:
            if h["id"] == hid:
                return h["n"]
    except Exception:  # noqa: BLE001
        pass
    return hid


def places(uid: int, con) -> list[dict]:
    """Watched hubs plus the user's own sites that have data: {kind, ref, name, lat, lon, record}."""
    out = []
    hz = (store.HAZ or {}).get("hubs", {})
    for r in con.execute("SELECT ref FROM watches WHERE user_id = ? AND kind = 'hub' ORDER BY created", (uid,)):
        rec = hz.get(r["ref"])
        if rec:
            out.append({"kind": "hub", "ref": r["ref"], "name": _hub_name(r["ref"]), "lat": rec.get("lat"), "lon": rec.get("lon"), "record": rec})
    for r in con.execute("SELECT id, name, lat, lon, record FROM sites WHERE user_id = ? AND state = 'ready' AND record IS NOT NULL ORDER BY created", (uid,)):
        out.append({"kind": "site", "ref": str(r["id"]), "name": r["name"], "lat": r["lat"], "lon": r["lon"], "record": json.loads(r["record"])})
    return out


def _add(con, uid: int, kind: str, place: str, title: str, detail: str) -> None:
    con.execute("INSERT INTO alerts (user_id, kind, place, title, detail, created) VALUES (?, ?, ?, ?, ?, ?)", (uid, kind, place, title, detail, time.time()))


# ---------- data-change check (no network) ----------
def check_data(uid: int) -> int:
    made = 0
    with auth._lock, auth._db() as con:
        for p in places(uid, con):
            for scen in WATCH_SCEN:
                c = scoring.comp(scoring.scores(p["record"], scen))
                b = scoring.band(c)
                old = con.execute("SELECT comp, band FROM alert_snaps WHERE user_id = ? AND kind = ? AND ref = ? AND scen = ?", (uid, p["kind"], p["ref"], scen)).fetchone()
                if old is None:
                    con.execute("INSERT INTO alert_snaps VALUES (?, ?, ?, ?, ?, ?)", (uid, p["kind"], p["ref"], scen, c, b))
                    continue
                if old["band"] != b:
                    up = (c or 0) > (old["comp"] or 0)
                    _add(con, uid, "data", p["name"], f"{p['name']}: {old['band']} → {b} risk ({scoring.SCEN_LABEL[scen]})",
                         f"Overall risk {'rose' if up else 'fell'} from {old['comp'] if old['comp'] is not None else 'no data'} to {c if c is not None else 'no data'} "
                         f"after the {'hub' if p['kind'] == 'hub' else 'site'}'s open data was updated.")
                    made += 1
                if old["band"] != b or old["comp"] != c:
                    con.execute("UPDATE alert_snaps SET comp = ?, band = ? WHERE user_id = ? AND kind = ? AND ref = ? AND scen = ?", (c, b, uid, p["kind"], p["ref"], scen))
        # Forget snapshots for places no longer followed, so following again starts quietly.
        keep = {(p["kind"], p["ref"]) for p in places(uid, con)}
        for r in con.execute("SELECT DISTINCT kind, ref FROM alert_snaps WHERE user_id = ?", (uid,)).fetchall():
            if (r["kind"], r["ref"]) not in keep:
                con.execute("DELETE FROM alert_snaps WHERE user_id = ? AND kind = ? AND ref = ?", (uid, r["kind"], r["ref"]))
    return made


# ---------- live readings ----------
async def readings(lat: float, lon: float) -> dict:
    key = (round(lat, 2), round(lon, 2))
    c = _readings.get(key)
    if c and time.time() - c["at"] < 1500:
        return c["v"]
    v: dict = {}
    src: dict = {}              # metric -> source, when it isn't Open-Meteo
    async with httpx.AsyncClient(headers={"User-Agent": "adaptation-atlas/1.0"}, timeout=10) as http:
        async def weather():
            try:
                if not gmaps.enabled():
                    raise RuntimeError("no key")
                t, rh, tmax = await gmaps.weather(http, lat, lon)
                src["tmax"] = src["wetbulb"] = "Google Weather API"
            except Exception:  # noqa: BLE001  Google has no answer: use Open-Meteo, as before
                j = (await http.get("https://api.open-meteo.com/v1/forecast", params={"latitude": lat, "longitude": lon, "current": "temperature_2m,relative_humidity_2m",
                                                                                     "daily": "temperature_2m_max", "forecast_days": 1, "timezone": "auto"})).json()
                t, rh, tmax = j["current"]["temperature_2m"], j["current"]["relative_humidity_2m"], j["daily"]["temperature_2m_max"][0]
            v["wetbulb"], v["tmax"] = r1(wet_bulb(t, rh)), r1(tmax)

        async def air():
            try:
                if not gmaps.enabled():
                    raise RuntimeError("no key")
                v["pm25"] = r1(await gmaps.pm25(http, lat, lon))
                src["pm25"] = "Google Air Quality API"
            except Exception:  # noqa: BLE001
                j = (await http.get("https://air-quality-api.open-meteo.com/v1/air-quality", params={"latitude": lat, "longitude": lon, "current": "pm2_5"})).json()
                v["pm25"] = r1(j["current"]["pm2_5"])

        async def river():
            j = (await http.get("https://flood-api.open-meteo.com/v1/flood", params={"latitude": lat, "longitude": lon, "daily": "river_discharge", "past_days": 30, "forecast_days": 1})).json()
            q = [x for x in (j.get("daily") or {}).get("river_discharge") or [] if x is not None]
            if len(q) > 1 and statistics.median(q[:-1]) > 0:
                v["river"] = round(q[-1] / statistics.median(q[:-1]) * 100)

        await asyncio.gather(weather(), air(), river(), return_exceptions=True)
    _readings[key] = {"at": time.time(), "v": v, "src": src}
    return v


def source_of(lat: float, lon: float, metric: str) -> str:
    return ((_readings.get((round(lat, 2), round(lon, 2))) or {}).get("src") or {}).get(metric, "Open-Meteo")


async def check_live(uid: int) -> int:
    with auth._db() as con:
        rules = [dict(r) for r in con.execute("SELECT * FROM alert_rules WHERE user_id = ?", (uid,))]
        where = {(p["kind"], p["ref"]): p for p in places(uid, con)}
    made, now = 0, time.time()
    for r in rules:
        p = where.get((r["kind"], r["ref"]))
        if not p or p.get("lat") is None:
            continue
        val = (await readings(p["lat"], p["lon"])).get(r["metric"])
        fire = val is not None and val >= r["threshold"] and (not r["last_fired"] or now - r["last_fired"] > REFIRE_S)
        with auth._lock, auth._db() as con:
            con.execute("UPDATE alert_rules SET last_value = ?, last_checked = ?, last_fired = ? WHERE id = ?",
                        (val, now, now if fire else r["last_fired"], r["id"]))
            if fire:
                m = METRICS[r["metric"]]
                _add(con, uid, "live", p["name"], f"{p['name']}: {m['label'].lower()} {val:g} {m['unit']}",
                     f"Your limit is {r['threshold']:g} {m['unit']}. Source: {source_of(p['lat'], p['lon'], r['metric'])}. You won't get this alert again for 12 hours.")
                made += 1
    return made


async def check_all() -> None:
    from .team import team_id
    for uid in [team_id()]:
        try:
            check_data(uid)
            await check_live(uid)
        except Exception as e:  # noqa: BLE001
            print("Alert check failed for a user:", str(e)[:200])


async def loop() -> None:
    await asyncio.sleep(60)
    while True:
        await check_all()
        await asyncio.sleep(ALERT_MINUTES * 60)


# ---------- requests ----------
def overview(uid: int) -> dict:
    with auth._db() as con:
        items = [dict(r) for r in con.execute("SELECT id, kind, place, title, detail, created, read FROM alerts WHERE user_id = ? ORDER BY created DESC LIMIT 100", (uid,))]
        unread = con.execute("SELECT COUNT(*) FROM alerts WHERE user_id = ? AND read = 0", (uid,)).fetchone()[0]
        rules = [dict(r) for r in con.execute("SELECT id, kind, ref, metric, threshold, last_value, last_checked, last_fired FROM alert_rules WHERE user_id = ? ORDER BY created", (uid,))]
        pl = [{k: p[k] for k in ("kind", "ref", "name")} for p in places(uid, con)]
    for p in pl:
        p["rules"] = [r for r in rules if r["kind"] == p["kind"] and r["ref"] == p["ref"]]
    return {"alerts": items, "unread": unread, "places": pl, "metrics": METRICS, "minutes": ALERT_MINUTES}


def mark_read(uid: int, ids: list | None) -> None:
    with auth._lock, auth._db() as con:
        if ids:
            con.execute(f"UPDATE alerts SET read = 1 WHERE user_id = ? AND id IN ({','.join('?' * len(ids))})", (uid, *[int(i) for i in ids]))
        else:
            con.execute("UPDATE alerts SET read = 1 WHERE user_id = ?", (uid,))


def watch(uid: int, hid: str, on: bool) -> None:
    if hid not in (store.HAZ or {}).get("hubs", {}):
        raise AlertError("Unknown hub.")
    with auth._lock, auth._db() as con:
        if on:
            if con.execute("SELECT COUNT(*) FROM watches WHERE user_id = ?", (uid,)).fetchone()[0] >= MAX_WATCH:
                raise AlertError(f"You can watch up to {MAX_WATCH} hubs.")
            con.execute("INSERT OR IGNORE INTO watches VALUES (?, 'hub', ?, ?)", (uid, hid, time.time()))
        else:
            con.execute("DELETE FROM watches WHERE user_id = ? AND kind = 'hub' AND ref = ?", (uid, hid))
            con.execute("DELETE FROM alert_rules WHERE user_id = ? AND kind = 'hub' AND ref = ?", (uid, hid))


def add_rule(uid: int, kind: str, ref: str, metric: str, threshold) -> None:
    if metric not in METRICS:
        raise AlertError("Choose what to watch.")
    m = METRICS[metric]
    try:
        th = float(threshold)
    except (TypeError, ValueError):
        raise AlertError("Enter the limit as a number.") from None
    if not m["min"] <= th <= m["max"]:
        raise AlertError(f"The limit must be between {m['min']} and {m['max']} {m['unit']}.")
    with auth._lock, auth._db() as con:
        if not any(p["kind"] == kind and p["ref"] == str(ref) for p in places(uid, con)):
            raise AlertError("Follow that place first: watch the hub, or wait until your site has data.")
        if con.execute("SELECT COUNT(*) FROM alert_rules WHERE user_id = ?", (uid,)).fetchone()[0] >= MAX_RULES:
            raise AlertError(f"You can set up to {MAX_RULES} limits.")
        con.execute("INSERT INTO alert_rules (user_id, kind, ref, metric, threshold, created) VALUES (?, ?, ?, ?, ?, ?)", (uid, kind, str(ref), metric, th, time.time()))


def remove_rule(uid: int, rid: int) -> None:
    with auth._lock, auth._db() as con:
        con.execute("DELETE FROM alert_rules WHERE id = ? AND user_id = ?", (rid, uid))


init()
