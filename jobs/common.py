"""Shared helpers for the data jobs: cached HTTP, polite pacing, large downloads, distances."""
import hashlib
import json
import math
import sys
import time
from pathlib import Path
from urllib.parse import urlparse

import httpx

from app.settings import CACHE_DIR

FRESH = "--fresh" in sys.argv
CACHE_DIR.mkdir(parents=True, exist_ok=True)
_last_call: dict[str, float] = {}
_http = httpx.Client(headers={"User-Agent": "adaptation-atlas-build/1.0"}, timeout=90, follow_redirects=True)


class FatalHTTP(RuntimeError):
    """A 4xx answer: retrying won't help."""


def get_json(url: str, headers: dict | None = None, gap_s: float = 0, cache_key: str | None = None):
    """GET JSON with a file cache (scripts/.cache, shared with the earlier Node build), pacing per host and
    three tries for 429/5xx. --fresh ignores the cache."""
    f = CACHE_DIR / (hashlib.sha1((cache_key or url).encode()).hexdigest() + ".json")
    if not FRESH and f.exists():
        return json.loads(f.read_text(encoding="utf-8"))
    host = urlparse(url).netloc
    wait = _last_call.get(host, 0) + gap_s - time.time()
    if wait > 0:
        time.sleep(wait)
    _last_call[host] = time.time()
    for attempt in range(3):
        try:
            r = _http.get(url, headers=headers or {})
            if r.status_code == 429 or r.status_code >= 500:
                raise RuntimeError(f"HTTP {r.status_code}")
            if r.status_code >= 400:
                raise FatalHTTP(f"HTTP {r.status_code}: {r.text[:200]}")
            data = r.json()
            f.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
            return data
        except FatalHTTP:
            raise
        except Exception:  # noqa: BLE001
            if attempt == 2:
                raise
            time.sleep(3 * (attempt + 1))


def download(url: str, name: str, max_age_days: float = 30) -> Path:
    """Download a large file into the cache once (streamed), refreshing it after max_age_days or with --fresh."""
    dest = CACHE_DIR / name
    if dest.exists() and not FRESH and time.time() - dest.stat().st_mtime < max_age_days * 86400:
        return dest
    tmp = dest.with_suffix(dest.suffix + ".part")
    print(f"Downloading {url} ...")
    with _http.stream("GET", url, timeout=600) as r:
        r.raise_for_status()
        with tmp.open("wb") as fh:
            for chunk in r.iter_bytes(1 << 20):
                fh.write(chunk)
    tmp.replace(dest)
    print(f"  saved {dest.name} ({dest.stat().st_size / 1e6:.0f} MB)")
    return dest


def km(a: float, b: float, c: float, d: float) -> float:
    """Great-circle distance in km between (lat a, lon b) and (lat c, lon d)."""
    r = math.pi / 180
    x = math.sin((c - a) * r / 2) ** 2 + math.cos(a * r) * math.cos(c * r) * math.sin((d - b) * r / 2) ** 2
    return 2 * 6371 * math.asin(math.sqrt(x))


def js_round(x, digits: int = 0):
    """Round half up like JavaScript; None stays None."""
    if x is None or (isinstance(x, float) and math.isnan(x)):
        return None
    f = 10 ** digits
    v = math.floor(x * f + 0.5) / f
    return int(v) if digits == 0 else v


def clamp(x, a, b):
    return max(a, min(b, x))
