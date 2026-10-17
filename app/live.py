"""Live conditions for one hub: no AI; each source optional; the caller caches results for an hour."""
import asyncio
import math
import statistics
from datetime import datetime, timedelta, timezone

import httpx

from . import gmaps
from .settings import env

OM = "https://open-meteo.com/"


async def get_json(http: httpx.AsyncClient, url: str, headers: dict | None = None, timeout: float = 8.0, params: dict | None = None):
    r = await http.get(url, headers={"User-Agent": "adaptation-atlas/1.0", **(headers or {})}, timeout=timeout, params=params)
    if r.status_code >= 400:
        raise RuntimeError(f"HTTP {r.status_code}")
    return r.json()


def r1(v):
    return None if v is None else math.floor(v * 10 + 0.5) / 10


def wet_bulb(t: float, rh: float) -> float:
    """Stull (2011) wet-bulb approximation from air temperature (°C) and relative humidity (%)."""
    return (t * math.atan(0.151977 * math.sqrt(rh + 8.313659)) + math.atan(t + rh) - math.atan(rh - 1.676331)
            + 0.00391838 * rh ** 1.5 * math.atan(0.023101 * rh) - 4.686035)


def km_between(a, b, c, d) -> float:
    r = math.pi / 180
    x = math.sin((c - a) * r / 2) ** 2 + math.cos(a * r) * math.cos(c * r) * math.sin((d - b) * r / 2) ** 2
    return 12742 * math.asin(math.sqrt(x))


def item(**o) -> dict:
    return {"status": "ok", "unit": "", "detail": "", "url": "", **o}


async def live_for(hid: str, h: dict) -> dict:
    lat, lon = h["lat"], h["lon"]
    async with httpx.AsyncClient() as http:
        async def weather():
            src, url = "Open-Meteo", OM
            try:
                if not gmaps.enabled():
                    raise RuntimeError("no key")
                t, rh, tmax = await gmaps.weather(http, lat, lon)
                src, url = "Google Weather API", gmaps.WEATHER_URL
            except Exception as e:  # noqa: BLE001  Google has no answer: use Open-Meteo, as before
                if gmaps.enabled():
                    print(f"Google weather for {hid} failed, using Open-Meteo: {str(e)[:120]}")
                j = await get_json(http, f"https://api.open-meteo.com/v1/forecast?latitude={lat}&longitude={lon}&current=temperature_2m,relative_humidity_2m&daily=temperature_2m_max&forecast_days=1&timezone=auto")
                t, rh, tmax = j["current"]["temperature_2m"], j["current"]["relative_humidity_2m"], j["daily"]["temperature_2m_max"][0]
            return item(label="Air temperature", value=r1(t), unit="°C", source=src, url=url,
                        detail=f"humidity {round(rh)}%, wet-bulb about {r1(wet_bulb(t, rh))} °C; today's high {r1(tmax)} °C")

        async def river():
            j = await get_json(http, f"https://flood-api.open-meteo.com/v1/flood?latitude={lat}&longitude={lon}&daily=river_discharge&past_days=30&forecast_days=1")
            v = [x for x in (j.get("daily") or {}).get("river_discharge") or [] if x is not None]
            if not v:
                return item(label="River flow", status="none", detail="No river in the GloFAS grid at this point", source="Open-Meteo Flood API", url=OM)
            now = v[-1]
            med = statistics.median(v[:-1]) if len(v) > 1 else 0
            return item(label="River flow", value=r1(now), unit="m³/s", detail=f"{round(now / med * 100)}% of the 30-day median" if med > 0 else "",
                        source="Open-Meteo Flood API (GloFAS)", url=OM)

        async def pm25():
            try:
                if not gmaps.enabled():
                    raise RuntimeError("no key")
                v, src, url = await gmaps.pm25(http, lat, lon), "Google Air Quality API", gmaps.AIR_URL
            except Exception as e:  # noqa: BLE001  Google has no answer: use Open-Meteo, as before
                if gmaps.enabled():
                    print(f"Google air quality for {hid} failed, using Open-Meteo: {str(e)[:120]}")
                j = await get_json(http, f"https://air-quality-api.open-meteo.com/v1/air-quality?latitude={lat}&longitude={lon}&current=pm2_5")
                v, src, url = j["current"]["pm2_5"], "Open-Meteo (CAMS)", OM
            return item(label="PM2.5, modelled", value=r1(v), unit="µg/m³", detail="matters for outside-air cooling filters",
                        source=src, url=url)

        async def pm25station():
            key = env("OPENAQ_API_KEY")
            if not key:
                return item(label="PM2.5, nearest station", status="off", source="OpenAQ (OPENAQ_API_KEY)")
            hd = {"X-API-Key": key}
            locs = (await get_json(http, f"https://api.openaq.org/v3/locations?coordinates={lat},{lon}&radius=25000&parameters_id=2&limit=20", hd)).get("results") or []
            cutoff = datetime.now(timezone.utc) - timedelta(days=3)
            fresh = []
            for loc in locs:
                last = ((loc.get("datetimeLast") or {}).get("utc"))
                co = loc.get("coordinates")
                if last and co and datetime.fromisoformat(last.replace("Z", "+00:00")) > cutoff:
                    fresh.append((km_between(lat, lon, co["latitude"], co["longitude"]), loc))
            if not fresh:
                return item(label="PM2.5, nearest station", status="none", detail="No station reporting within 25 km", source="OpenAQ", url="https://explore.openaq.org/")
            d, loc = min(fresh, key=lambda x: x[0])
            sensor = next((s for s in loc.get("sensors") or [] if (s.get("parameter") or {}).get("name") == "pm25"), None)
            rows = (await get_json(http, f"https://api.openaq.org/v3/locations/{loc['id']}/latest", hd)).get("results") or []
            latest = next((x for x in rows if not sensor or x.get("sensorsId") == sensor["id"]), None)
            if not latest:
                return item(label="PM2.5, nearest station", status="none", detail="No recent reading", source="OpenAQ", url="https://explore.openaq.org/")
            return item(label="PM2.5, nearest station", value=r1(latest["value"]), unit="µg/m³", detail=f"{loc.get('name')}, {r1(d)} km away",
                        source="OpenAQ", url=f"https://explore.openaq.org/locations/{loc['id']}")

        async def carbon():
            if h.get("ukCarbon"):
                x = (await get_json(http, "https://api.carbonintensity.org.uk/intensity"))["data"][0]["intensity"]
                return item(label="Grid carbon intensity", value=x["actual"] if x.get("actual") is not None else x.get("forecast"), unit="gCO₂/kWh",
                            detail=f"Great Britain, {x.get('index')}{' (forecast)' if x.get('actual') is None else ''}",
                            source="National Grid ESO Carbon Intensity API", url="https://carbonintensity.org.uk/")
            key = env("ELECTRICITYMAPS_API_KEY")
            if not key or not h.get("emZone"):
                return item(label="Grid carbon intensity", status="off", source="Electricity Maps (ELECTRICITYMAPS_API_KEY)")
            j = await get_json(http, "https://api.electricitymaps.com/v3/carbon-intensity/latest", {"auth-token": key}, params={"zone": h["emZone"]})
            return item(label="Grid carbon intensity", value=j.get("carbonIntensity"), unit="gCO₂eq/kWh",
                        detail=f"zone {j.get('zone') or h['emZone']}{', estimated' if j.get('isEstimated') else ''}", source="Electricity Maps", url="https://app.electricitymaps.com/")

        async def demand():
            if not h.get("eia"):
                return None
            key = env("EIA_API_KEY") or "DEMO_KEY"
            # Without a start date EIA can return a stale page, so ask for the last 8 days and sort here.
            start = (datetime.now(timezone.utc) - timedelta(days=8)).strftime("%Y-%m-%dT%H")
            params = [("frequency", "hourly"), ("data[0]", "value"), ("facets[respondent][]", h["eia"]), ("facets[type][]", "D"),
                      ("start", start), ("length", "500"), ("api_key", key)]
            r = await http.get("https://api.eia.gov/v2/electricity/rto/region-data/data/", params=params, timeout=15.0)
            if r.status_code >= 400:
                raise RuntimeError(f"HTTP {r.status_code}")
            rows = sorted([x for x in (r.json().get("response") or {}).get("data") or [] if float(x.get("value") or 0) > 0],
                          key=lambda x: x["period"], reverse=True)[:168]
            v = [float(x["value"]) for x in rows]
            if not v:
                return item(label="Grid demand", status="none", detail="No recent data", source="EIA", url="https://www.eia.gov/electricity/gridmonitor/")
            return item(label="Grid demand", value=f"{round(v[0]):,}", unit="MW", detail=f"{h['eia']}, {round(v[0] / max(v) * 100)}% of its 7-day peak, hour ending {rows[0]['period']} UTC",
                        source="EIA" + ("" if env("EIA_API_KEY") else " (demo key)"), url="https://www.eia.gov/electricity/gridmonitor/")

        tasks = {"weather": weather, "river": river, "pm25": pm25, "pm25station": pm25station, "carbon": carbon, "demand": demand}
        labels = {"weather": "Air temperature", "river": "River flow", "pm25": "PM2.5, modelled", "pm25station": "PM2.5, nearest station",
                  "carbon": "Grid carbon intensity", "demand": "Grid demand"}
        results = await asyncio.gather(*(f() for f in tasks.values()), return_exceptions=True)
    items = []
    for k, res in zip(tasks, results):
        if isinstance(res, BaseException):
            print(f"Live {k} for {hid} failed: {str(res)[:160]}")
            items.append({"label": labels[k], "status": "error", "source": "", "detail": ""})
        elif res is not None:
            items.append(res)
    return {"id": hid, "place": h.get("place"), "fetchedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"), "items": items}
