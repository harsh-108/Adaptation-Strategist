"""Google Cloud helpers. Each one is off unless its setting is present, so the app runs the same on a laptop or EC2.

GCS_BUCKET keeps the team's records (instance/atlas.db) and hub edits (data.js, hazards.json/.js, hub-meta.json) in a
Cloud Storage bucket, because Cloud Run's disk is wiped at every deploy and restart. They are restored before the app
starts and copied back a few seconds after each change, after scheduled tasks and at shutdown. Nothing about how the
app reads or writes them changes. Run one instance (--max-instances 1) so there is only one writer.
TASK_TOKEN lets Cloud Scheduler call /tasks/* (sent in the X-Task-Token header)."""
import asyncio
import sqlite3
import tempfile
import time
import urllib.parse
from pathlib import Path

import httpx

from .settings import DATA_JS, HAZARDS_JS, HAZARDS_JSON, INSTANCE_DIR, META_JSON, env

BUCKET = env("GCS_BUCKET")
PREFIX = (env("GCS_PREFIX") or "atlas").strip("/")
TASK_TOKEN = env("TASK_TOKEN")
DB = INSTANCE_DIR / "atlas.db"
FILES = {"public/data.js": DATA_JS, "public/hazards.json": HAZARDS_JSON, "public/hazards.js": HAZARDS_JS, "scripts/hub-meta.json": META_JSON}
_token = {"v": "", "exp": 0.0}
_sent: dict = {}            # object -> file mtime when last copied, so unchanged files aren't sent again
_pending = None
_lock = None


def enabled() -> bool:
    return bool(BUCKET)


def _access_token() -> str:
    """Cloud Run's service account token from the metadata server. Locally, set GCS_ACCESS_TOKEN
    (gcloud auth print-access-token) to try the bucket sync."""
    if env("GCS_ACCESS_TOKEN"):
        return env("GCS_ACCESS_TOKEN")
    if time.time() < _token["exp"] - 60:
        return _token["v"]
    r = httpx.get("http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token",
                  headers={"Metadata-Flavor": "Google"}, timeout=5)
    r.raise_for_status()
    j = r.json()
    _token.update(v=j["access_token"], exp=time.time() + float(j.get("expires_in", 300)))
    return _token["v"]


def _get(rel: str) -> bytes | None:
    name = urllib.parse.quote(f"{PREFIX}/{rel}", safe="")
    r = httpx.get(f"https://storage.googleapis.com/storage/v1/b/{BUCKET}/o/{name}", params={"alt": "media"},
                  headers={"Authorization": "Bearer " + _access_token()}, timeout=60)
    if r.status_code == 404:
        return None
    r.raise_for_status()
    return r.content


def _put(rel: str, data: bytes) -> None:
    r = httpx.post(f"https://storage.googleapis.com/upload/storage/v1/b/{BUCKET}/o", params={"uploadType": "media", "name": f"{PREFIX}/{rel}"},
                   content=data, headers={"Authorization": "Bearer " + _access_token(), "Content-Type": "application/octet-stream"}, timeout=120)
    r.raise_for_status()


def restore() -> None:
    """Before the app starts: bring back the team's records and hub edits from the bucket, if any are saved.
    If the bucket can't be read the server stops, so a blank database never overwrites the saved one."""
    if not enabled():
        return
    try:
        db = _get("instance/atlas.db")
        if db is not None:
            INSTANCE_DIR.mkdir(parents=True, exist_ok=True)
            DB.write_bytes(db)
        for rel, path in FILES.items():
            b = _get(rel)
            if b is not None:
                path.write_bytes(b)
    except Exception as e:  # noqa: BLE001
        raise SystemExit(f"Could not read gs://{BUCKET}/{PREFIX}: {str(e)[:200]}") from e
    for rel, path in {**FILES, "instance/atlas.db": DB}.items():
        if path.exists():
            _sent[rel] = path.stat().st_mtime
    print(f"Records restored from gs://{BUCKET}/{PREFIX}" + ("" if db is not None else " (nothing saved yet; starting fresh)"))


def _snapshot() -> bytes:
    """A consistent copy of the database, taken with SQLite's backup API while the app keeps running."""
    with tempfile.TemporaryDirectory() as d:
        tmp = Path(d) / "atlas.db"
        src, dst = sqlite3.connect(DB, timeout=10), sqlite3.connect(tmp)
        try:
            src.backup(dst)
        finally:
            dst.close()
            src.close()
        return tmp.read_bytes()


def backup_now() -> None:
    if not enabled():
        return
    if DB.exists() and _sent.get("instance/atlas.db") != (m := DB.stat().st_mtime):
        _put("instance/atlas.db", _snapshot())
        _sent["instance/atlas.db"] = m
    for rel, path in FILES.items():
        if path.exists() and _sent.get(rel) != (m := path.stat().st_mtime):
            _put(rel, path.read_bytes())
            _sent[rel] = m


async def backup() -> None:
    global _lock
    if not enabled():
        return
    _lock = _lock or asyncio.Lock()
    async with _lock:
        try:
            await asyncio.to_thread(backup_now)
        except Exception as e:  # noqa: BLE001
            print("Copy to Cloud Storage failed:", str(e)[:200])


_again = False


def soon(delay: float = 5.0) -> None:
    """Copy to the bucket a few seconds after a change; one copy covers a burst of changes, and a change made
    while a copy is running gets another copy straight after."""
    global _pending, _again
    if not enabled():
        return
    if _pending and not _pending.done():
        _again = True
        return

    async def later():
        global _again
        await asyncio.sleep(delay)
        while True:
            _again = False
            await backup()
            if not _again:
                break
    _pending = asyncio.ensure_future(later())
