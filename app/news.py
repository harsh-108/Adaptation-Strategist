"""Recent events and news for a place, from open feeds (no AI search quota needed):

- GDACS (UN/EU Global Disaster Alert and Coordination System; public domain): earthquakes, tropical cyclones,
  floods, volcanoes, wildfires and droughts in the last 180 days, near the place or (drought) in its country.
- NASA EONET (public domain): natural events in the last 180 days near the place.
- RSS or Atom feeds an admin adds on the Manage hubs page (e.g. licensed news, a weather service, a utility's outage
  feed): items from the last 180 days that name the place.
- ReliefWeb (UN OCHA), only with RELIEFWEB_APPNAME set (ReliefWeb approves app names).

Google News RSS is deliberately not used: its feed licence allows personal, non-commercial feed readers only.
Feed text is untrusted: it is escaped in the page, links must be http(s), and the AI is told to treat it as data."""
import asyncio
import ipaddress
import re
import socket
import time
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from urllib.parse import urlparse
from xml.etree import ElementTree as ET

import httpx

from . import auth
from .live import km_between
from .settings import env

DAYS = 180
TTL = 1800
# How close an event must be, by GDACS type (km). Droughts are matched by country.
GDACS_KM = {"EQ": 300, "TC": 800, "FL": 300, "VO": 300, "WF": 200}
GDACS_TYPE = {"EQ": "Earthquake", "TC": "Tropical cyclone", "FL": "Flood", "VO": "Volcano", "WF": "Wildfire", "DR": "Drought"}
EONET_KM = 300
_cache: dict = {}
UA = {"User-Agent": "adaptation-atlas/1.0 (internal climate risk screening)"}


class FeedError(ValueError):
    """A problem with a feed an admin tried to add, worded for them."""


def init() -> None:
    with auth._lock, auth._db() as con:
        con.execute("""CREATE TABLE IF NOT EXISTS news_feeds (id INTEGER PRIMARY KEY, url TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
                       country TEXT NOT NULL DEFAULT '', created REAL NOT NULL)""")


def _cached(key, ttl=TTL):
    c = _cache.get(key)
    return c["v"] if c and time.time() - c["at"] < ttl else None


def _put(key, v):
    _cache[key] = {"at": time.time(), "v": v}
    return v


def _safe_link(u) -> str:
    u = str(u or "").strip()
    return u if u.lower().startswith(("http://", "https://")) else ""


def _date(s):
    if not s:
        return None
    try:
        d = parsedate_to_datetime(s)
    except (TypeError, ValueError):
        try:
            d = datetime.fromisoformat(str(s).replace("Z", "+00:00"))
        except ValueError:
            return None
    return d if d.tzinfo else d.replace(tzinfo=timezone.utc)


def _since():
    return datetime.now(timezone.utc) - timedelta(days=DAYS)


# ---------- GDACS ----------
async def gdacs(http, country: str, lat: float, lon: float) -> list[dict]:
    key = ("gdacs", country)
    feats = _cached(key)
    if feats is None:
        now = datetime.now(timezone.utc)
        r = await http.get("https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH",
                           params={"eventlist": "EQ;TC;FL;VO;WF;DR", "fromDate": (now - timedelta(days=DAYS)).date().isoformat(),
                                   "toDate": now.date().isoformat(), "alertlevel": "Green;Orange;Red", "country": country}, timeout=20)
        feats = _put(key, (r.json() or {}).get("features") or [] if r.status_code == 200 else [])
    out = []
    for f in feats:
        p, g = f.get("properties") or {}, f.get("geometry") or {}
        t = p.get("eventtype")
        d = _date(p.get("fromdate"))
        if t not in GDACS_TYPE or not d or d < _since():
            continue
        dist = None
        if g.get("type") == "Point" and len(g.get("coordinates") or []) >= 2:
            dist = km_between(lat, lon, g["coordinates"][1], g["coordinates"][0])
        if t != "DR" and (dist is None or dist > GDACS_KM[t]):
            continue
        out.append({"kind": "alert", "hazard": GDACS_TYPE[t], "level": p.get("alertlevel") or "",
                    "title": f"{GDACS_TYPE[t]}: {p.get('name') or p.get('eventname') or ''}".strip(),
                    "summary": re.sub(r"<[^>]+>", " ", str(p.get("description") or ""))[:300],
                    "url": _safe_link((p.get("url") or {}).get("report")), "source": "GDACS", "date": d.isoformat(),
                    "km": None if dist is None else round(dist)})
    return out


# ---------- NASA EONET ----------
async def eonet(http, lat: float, lon: float) -> list[dict]:
    key = ("eonet", round(lat), round(lon))
    evs = _cached(key)
    if evs is None:
        bbox = f"{lon - 3},{lat + 3},{lon + 3},{lat - 3}"
        r = await http.get("https://eonet.gsfc.nasa.gov/api/v3/events", params={"status": "all", "days": DAYS, "bbox": bbox}, timeout=20)
        evs = _put(key, (r.json() or {}).get("events") or [] if r.status_code == 200 else [])
    out = []
    for e in evs:
        best, when = None, None
        for g in e.get("geometry") or []:
            co = g.get("coordinates")
            if g.get("type") == "Point" and co and len(co) >= 2:
                d = km_between(lat, lon, co[1], co[0])
                if best is None or d < best:
                    best, when = d, _date(g.get("date"))
        if best is None or best > EONET_KM or not when or when < _since():
            continue
        cat = ((e.get("categories") or [{}])[0]).get("title") or "Natural event"
        src = (e.get("sources") or [{}])[0]
        if src.get("id") == "GDACS":                    # already listed from GDACS itself
            continue
        out.append({"kind": "event", "hazard": cat, "level": "", "title": e.get("title") or cat, "summary": "",
                    "url": _safe_link(src.get("url")) or _safe_link(e.get("link")), "source": f"NASA EONET ({src.get('id') or 'event'})",
                    "date": when.isoformat(), "km": round(best)})
    return out


# ---------- RSS / Atom feeds added by an admin ----------
def _items(xml: bytes) -> list[dict]:
    root = ET.fromstring(xml)
    out = []
    for it in root.iter():
        tag = it.tag.rsplit("}", 1)[-1]
        if tag not in ("item", "entry"):
            continue
        get = lambda name: next((c for c in it if c.tag.rsplit("}", 1)[-1] == name), None)  # noqa: E731
        title = (get("title").text if get("title") is not None else "") or ""
        link_el = get("link")
        link = (link_el.get("href") or link_el.text) if link_el is not None else ""
        desc_el = get("description") if get("description") is not None else get("summary")
        desc = re.sub(r"<[^>]+>", " ", (desc_el.text or "") if desc_el is not None else "")
        d_el = next((get(n) for n in ("pubDate", "published", "updated", "date") if get(n) is not None), None)
        out.append({"title": " ".join(title.split())[:300], "url": _safe_link(link), "summary": " ".join(desc.split())[:400],
                    "date": _date(d_el.text if d_el is not None else None)})
    return out


def _public_host(url: str) -> None:
    """Refuse feeds on this machine or a private network, so the server can't be pointed at internal services."""
    p = urlparse(url)
    if p.scheme not in ("http", "https") or not p.hostname:
        raise FeedError("Enter a full http or https address.")
    try:
        addrs = {a[4][0] for a in socket.getaddrinfo(p.hostname, None)}
    except OSError:
        raise FeedError("That address can't be found.") from None
    for a in addrs:
        ip = ipaddress.ip_address(a.split("%")[0])
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast:
            raise FeedError("Feeds on this machine or a private network aren't allowed.")


async def fetch_feed(http, url: str) -> list[dict]:
    items = _cached(("feed", url))
    if items is None:
        target = url
        for _ in range(4):                                   # follow redirects, checking every hop
            _public_host(target)
            r = await http.get(target, timeout=15, follow_redirects=False)
            if r.status_code in (301, 302, 303, 307, 308) and r.headers.get("location"):
                target = str(r.url.join(r.headers["location"]))
                continue
            break
        if r.status_code != 200:
            raise FeedError(f"The feed answered HTTP {r.status_code}.")
        if len(r.content) > 5_000_000:
            raise FeedError("The feed is too large (over 5 MB).")
        try:
            items = _put(("feed", url), _items(r.content))
        except ET.ParseError:
            raise FeedError("That address doesn't return an RSS or Atom feed.") from None
    return items


def list_feeds() -> list[dict]:
    with auth._db() as con:
        return [dict(r) for r in con.execute("SELECT id, url, name, country FROM news_feeds ORDER BY name COLLATE NOCASE")]


async def add_feed(url: str, name: str, country: str) -> dict:
    url, name = url.strip(), name.strip()[:80]
    if not name:
        raise FeedError("Give the feed a name.")
    async with httpx.AsyncClient(headers=UA) as http:
        items = await fetch_feed(http, url)
    with auth._lock, auth._db() as con:
        try:
            con.execute("INSERT INTO news_feeds (url, name, country, created) VALUES (?, ?, ?, ?)", (url, name, country.strip()[:60], time.time()))
        except Exception:  # noqa: BLE001
            raise FeedError("That feed is already added.") from None
    return {"items": len(items)}


def remove_feed(fid: int) -> None:
    with auth._lock, auth._db() as con:
        con.execute("DELETE FROM news_feeds WHERE id = ?", (fid,))


def _mentions(text: str, names: list[str]) -> bool:
    t = text.lower()
    return any(re.search(r"\b" + re.escape(n.lower()) + r"\b", t) for n in names if n and len(n) >= 3)


async def custom(http, names: list[str], country: str) -> list[dict]:
    out = []
    for f in list_feeds():
        if f["country"] and f["country"].lower() != country.lower():
            continue
        try:
            items = await fetch_feed(http, f["url"])
        except Exception:  # noqa: BLE001
            continue
        for it in items:
            if it["date"] and it["date"] < _since():
                continue
            if _mentions(it["title"] + " " + it["summary"], names):
                out.append({"kind": "news", "hazard": "", "level": "", "title": it["title"], "summary": it["summary"][:300], "url": it["url"],
                            "source": f["name"], "date": it["date"].isoformat() if it["date"] else "", "km": None})
    return out


# ---------- ReliefWeb (optional) ----------
async def reliefweb(http, name: str, iso3: str) -> list[dict]:
    app = env("RELIEFWEB_APPNAME")
    if not app or not iso3:
        return []
    r = await http.post(f"https://api.reliefweb.int/v2/reports?appname={app}", timeout=20, json={
        "query": {"value": f'"{name}"'}, "filter": {"field": "country.iso3", "value": iso3.lower()},
        "sort": ["date:desc"], "limit": 8, "fields": {"include": ["title", "date.created", "url", "source.name"]}})
    out = []
    for d in (r.json().get("data") or []) if r.status_code == 200 else []:
        f = d.get("fields") or {}
        when = _date((f.get("date") or {}).get("created"))
        if when and when >= _since():
            out.append({"kind": "news", "hazard": "", "level": "", "title": f.get("title") or "", "summary": "", "url": _safe_link(f.get("url")),
                        "source": "ReliefWeb · " + ", ".join(s.get("name", "") for s in (f.get("source") or [])[:2]), "date": when.isoformat(), "km": None})
    return out


async def for_place(name: str, country: str, iso3: str, lat: float, lon: float, aliases: list[str]) -> dict:
    """Items from every source, newest first, plus which sources answered."""
    names = [name, *aliases]
    async with httpx.AsyncClient(headers=UA) as http:
        tasks = {"gdacs": gdacs(http, country, lat, lon), "eonet": eonet(http, lat, lon), "feeds": custom(http, names, country),
                 "reliefweb": reliefweb(http, name, iso3)}
        res = await asyncio.gather(*tasks.values(), return_exceptions=True)
    items, status = [], {}
    for k, r in zip(tasks, res):
        status[k] = "error" if isinstance(r, BaseException) else len(r)
        if not isinstance(r, BaseException):
            items.extend(r)
    seen, uniq = set(), []
    for it in sorted(items, key=lambda x: x["date"] or "", reverse=True):
        key = (it["title"].lower()[:80], it["source"])
        if key not in seen and it["title"]:
            seen.add(key)
            uniq.append(it)
    status["reliefwebOn"] = bool(env("RELIEFWEB_APPNAME"))
    status["customFeeds"] = len(list_feeds())
    return {"items": uniq[:15], "status": status}


init()
