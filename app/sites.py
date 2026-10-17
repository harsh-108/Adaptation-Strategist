"""My sites: the team's data centre sites (one shared list, no login), scored at their own coordinates by jobs.site_hazards (the same
measured sources as hubs; nothing is borrowed from the nearest hub). Stored in instance/atlas.db next to the accounts.
Labelled sample sites (scripts/sample-sites.json) are shown per role so the page isn't empty."""
import asyncio
import json
import os
import sys
import time

from . import auth
from .settings import ROOT

SITE_ROLES = ("op", "colo", "ten", "admin")
MAX_SITES = 100
STATUSES = ("existing", "planned", "candidate")
_build_gate = asyncio.Semaphore(1)       # one site build at a time; each is a burst of open-data requests
_samples: dict | None = None


class SiteError(ValueError):
    """A problem with a site request, worded for the person who made it."""


def init() -> None:
    with auth._lock, auth._db() as con:
        con.executescript("""
        CREATE TABLE IF NOT EXISTS sites (
          id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          name TEXT NOT NULL, place TEXT NOT NULL DEFAULT '', country TEXT NOT NULL DEFAULT '', iso2 TEXT NOT NULL, iso3 TEXT NOT NULL,
          lat REAL NOT NULL, lon REAL NOT NULL, status TEXT NOT NULL DEFAULT 'existing', mw REAL,
          state TEXT NOT NULL DEFAULT 'building', error TEXT, record TEXT, warnings TEXT, built REAL, created REAL NOT NULL);
        CREATE INDEX IF NOT EXISTS sites_user ON sites(user_id);
        """)
        # A server restart mid-build leaves a site "building" forever; mark it so the user can retry.
        con.execute("UPDATE sites SET state = 'failed', error = 'The server restarted while fetching data. Try again.' WHERE state = 'building'")


def samples(role: str) -> list[dict]:
    global _samples
    if _samples is None:
        try:
            defs = json.loads((ROOT / "scripts" / "sample-sites.json").read_text(encoding="utf-8"))
            data = json.loads((ROOT / "scripts" / "sample-sites-data.json").read_text(encoding="utf-8")).get("records", {})
        except (OSError, ValueError):
            defs, data = {}, {}
        _samples = {k: [{**s, "sample": True, "state": "ready" if data.get(s["id"]) else "failed",
                         "error": None if data.get(s["id"]) else "Sample data not built yet (python -m jobs.site_hazards --samples).",
                         "record": data.get(s["id"])} for s in v] for k, v in defs.items() if not k.startswith("_")}
    if role == "admin":
        return [s for v in _samples.values() for s in v]
    return _samples.get(role, [])


def _public(r) -> dict:
    return {"id": r["id"], "name": r["name"], "place": r["place"], "country": r["country"], "iso2": r["iso2"], "iso3": r["iso3"],
            "lat": r["lat"], "lon": r["lon"], "status": r["status"], "mw": r["mw"], "state": r["state"], "error": r["error"],
            "record": json.loads(r["record"]) if r["record"] else None, "warnings": json.loads(r["warnings"]) if r["warnings"] else [],
            "built": r["built"], "sample": False}


def list_for(uid: int) -> list[dict]:
    with auth._db() as con:
        return [_public(r) for r in con.execute("SELECT * FROM sites WHERE user_id = ? ORDER BY created", (uid,))]


def _clean(b: dict, partial: bool = False) -> dict:
    o = {}
    if not partial or "name" in b:
        o["name"] = str(b.get("name") or "").strip()[:80]
        if not o["name"]:
            raise SiteError("Give the site a name.")
    if not partial or "status" in b:
        o["status"] = b.get("status") if b.get("status") in STATUSES else "existing"
    if not partial or "mw" in b:
        mw = b.get("mw")
        try:
            o["mw"] = None if mw in (None, "") else round(float(mw), 2)
        except (TypeError, ValueError):
            raise SiteError("IT capacity must be a number of MW.") from None
        if o["mw"] is not None and not 0 < o["mw"] <= 5000:
            raise SiteError("IT capacity must be between 0 and 5,000 MW.")
    if not partial:
        try:
            o["lat"], o["lon"] = round(float(b.get("lat")), 4), round(float(b.get("lon")), 4)
        except (TypeError, ValueError):
            raise SiteError("Pick the place from the search, or enter latitude and longitude.") from None
        if not (-60 <= o["lat"] <= 75 and -180 <= o["lon"] <= 180):
            raise SiteError("That latitude or longitude is outside the area the app covers.")
        o["iso2"], o["iso3"] = str(b.get("iso2") or "").upper()[:2], str(b.get("iso3") or "").upper()[:3]
        if len(o["iso2"]) != 2 or len(o["iso3"]) != 3:
            raise SiteError("The site needs its country; pick the place from the search.")
        o["place"], o["country"] = str(b.get("place") or "").strip()[:120], str(b.get("country") or "").strip()[:60]
    return o


def add(uid: int, b: dict) -> int:
    o = _clean(b)
    with auth._lock, auth._db() as con:
        if con.execute("SELECT COUNT(*) FROM sites WHERE user_id = ?", (uid,)).fetchone()[0] >= MAX_SITES:
            raise SiteError(f"The team can keep up to {MAX_SITES} sites. Remove one first.")
        cur = con.execute("""INSERT INTO sites (user_id, name, place, country, iso2, iso3, lat, lon, status, mw, created)
                             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                          (uid, o["name"], o["place"], o["country"], o["iso2"], o["iso3"], o["lat"], o["lon"], o["status"], o["mw"], time.time()))
        return cur.lastrowid


def _row(uid: int, sid: int, con):
    r = con.execute("SELECT * FROM sites WHERE id = ? AND user_id = ?", (sid, uid)).fetchone()
    if not r:
        raise SiteError("No such site.")
    return r


def update(uid: int, sid: int, b: dict) -> None:
    o = _clean(b, partial=True)
    if not o:
        return
    with auth._lock, auth._db() as con:
        _row(uid, sid, con)
        con.execute(f"UPDATE sites SET {', '.join(k + ' = ?' for k in o)} WHERE id = ?", (*o.values(), sid))


def remove(uid: int, sid: int) -> None:
    with auth._lock, auth._db() as con:
        _row(uid, sid, con)
        con.execute("DELETE FROM sites WHERE id = ?", (sid,))
        con.execute("DELETE FROM alert_rules WHERE user_id = ? AND kind = 'site' AND ref = ?", (uid, str(sid)))


def mark_building(uid: int, sid: int) -> None:
    with auth._lock, auth._db() as con:
        r = _row(uid, sid, con)
        if r["state"] == "building":
            raise SiteError("This site's data is already being fetched.")
        con.execute("UPDATE sites SET state = 'building', error = NULL WHERE id = ?", (sid,))


async def build(sid: int) -> None:
    """Fetch the site's open data in a child process (same code as the hub build) and store the result."""
    with auth._db() as con:
        r = con.execute("SELECT * FROM sites WHERE id = ?", (sid,)).fetchone()
    if not r:
        return
    payload = json.dumps({"lat": r["lat"], "lon": r["lon"], "iso2": r["iso2"], "iso3": r["iso3"], "place": r["place"]}).encode()
    state, error, record, warnings = "failed", None, None, None
    async with _build_gate:
        try:
            proc = await asyncio.create_subprocess_exec(sys.executable, "-m", "jobs.site_hazards", cwd=str(ROOT), env={**os.environ, "PYTHONIOENCODING": "utf-8"},
                                                        stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT)
            try:
                out, _ = await asyncio.wait_for(proc.communicate(payload), timeout=300)
            except asyncio.TimeoutError:
                proc.kill()
                raise RuntimeError("Fetching open data took too long. Try again later.") from None
            text = out.decode("utf-8", "replace")
            if "@@RESULT@@" not in text:
                lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
                raise RuntimeError((lines[-1] if lines else "The data job failed.")[:300])
            res = json.loads(text.split("@@RESULT@@", 1)[1])
            state, record, warnings = "ready", json.dumps(res["record"]), json.dumps(res.get("warnings") or [])
        except Exception as e:  # noqa: BLE001
            error = str(e)[:300]
    with auth._lock, auth._db() as con:
        con.execute("UPDATE sites SET state = ?, error = ?, record = COALESCE(?, record), warnings = COALESCE(?, warnings), built = ? WHERE id = ?",
                    (state, error, record, warnings, time.time() if state == "ready" else None, sid))


init()
