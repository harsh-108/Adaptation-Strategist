"""Google Maps Platform: Weather, Air Quality and Geocoding. Used only when GOOGLE_MAPS_API_KEY is set; every caller
falls back to its Open-Meteo source if Google has no answer, so readings and the place search work either way."""
import httpx

from .settings import env

KEY = env("GOOGLE_MAPS_API_KEY")
WEATHER_URL = "https://developers.google.com/maps/documentation/weather"
AIR_URL = "https://developers.google.com/maps/documentation/air-quality"


def enabled() -> bool:
    return bool(KEY)


async def _get(http: httpx.AsyncClient, url: str, params: dict) -> dict:
    r = await http.get(url, params={"key": KEY, **params}, timeout=8)
    if r.status_code >= 400:
        raise RuntimeError(f"Google HTTP {r.status_code}: {r.text[:160]}")
    return r.json()


async def weather(http: httpx.AsyncClient, lat: float, lon: float) -> tuple[float, float, float]:
    """(temperature now °C, relative humidity %, today's forecast high °C) from the Weather API."""
    loc = {"location.latitude": lat, "location.longitude": lon}
    now = await _get(http, "https://weather.googleapis.com/v1/currentConditions:lookup", loc)
    day = await _get(http, "https://weather.googleapis.com/v1/forecast/days:lookup", {**loc, "days": 1})
    return float(now["temperature"]["degrees"]), float(now["relativeHumidity"]), float(day["forecastDays"][0]["maxTemperature"]["degrees"])


async def pm25(http: httpx.AsyncClient, lat: float, lon: float) -> float:
    """PM2.5 now (µg/m³) from the Air Quality API."""
    r = await http.post("https://airquality.googleapis.com/v1/currentConditions:lookup", params={"key": KEY}, timeout=8,
                        json={"location": {"latitude": lat, "longitude": lon}, "extraComputations": ["POLLUTANT_CONCENTRATION"], "languageCode": "en"})
    if r.status_code >= 400:
        raise RuntimeError(f"Google HTTP {r.status_code}: {r.text[:160]}")
    p = next(x for x in r.json().get("pollutants") or [] if x.get("code") == "pm25")
    return float(p["concentration"]["value"])


async def geocode(http: httpx.AsyncClient, q: str) -> list[dict]:
    """Places matching q from the Geocoding API, in the same shape as Open-Meteo's search results
    (name, admin1, country, country_code, latitude, longitude, population). Google gives no population."""
    j = await _get(http, "https://maps.googleapis.com/maps/api/geocode/json", {"address": q, "language": "en"})
    if j.get("status") not in ("OK", "ZERO_RESULTS"):
        raise RuntimeError(f"Google geocoding {j.get('status')}: {j.get('error_message', '')[:160]}")
    out = []
    for g in j.get("results") or []:
        comp = {t: c for c in g.get("address_components") or [] for t in c.get("types") or []}
        country = comp.get("country")
        if not country:
            continue
        name = (comp.get("locality") or comp.get("administrative_area_level_2") or comp.get("administrative_area_level_1") or country)["long_name"]
        out.append({"name": name, "admin1": (comp.get("administrative_area_level_1") or {}).get("long_name", ""), "country": country["long_name"],
                    "country_code": country["short_name"], "latitude": g["geometry"]["location"]["lat"], "longitude": g["geometry"]["location"]["lng"],
                    "population": None})
    return out
