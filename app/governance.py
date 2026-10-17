"""Shared team records for the Strategist screens:
- approval requests and their steps (the route comes from the design's approval rules, worked out in the page);
- the audit trail: every action carries a SHA-256 fingerprint of the entry before it, so editing an old entry breaks
  every fingerprint after it (verify() recomputes them);
- meter summaries: one row per uploaded meter file (country, size group, PUE, WUE, completeness). Hourly readings are
  never sent or kept. Pooled figures only show groups of 5 or more operators;
- assumptions: lever effects and costs with no open source. They start blank and count as zero until someone enters
  a value, with their name and a reason; every change is kept in a log.

Where they are kept: Firestore when FIRESTORE=on (Cloud Run; see fsdb.py), otherwise instance/atlas.db (SQLite) as
before. Both give the same answers. In Firestore each change is one transaction that also moves the audit trail's
head (meta/counters), so two decisions at the same moment can't break the fingerprint chain. The first time Firestore
is used, records already in SQLite are copied across once."""
import hashlib
import json
import re
import statistics
import threading
import time
from datetime import datetime, timezone

from . import auth, fsdb

PERSONAS = ("op", "colo", "ten", "pol")
K_MIN = 5                                    # pooled groups smaller than this are suppressed
SIZES = (("Edge (under 5 MW)", 5), ("Mid-size (5 to 50 MW)", 50), ("Large (over 50 MW)", None))
ASSUME_KEY = re.compile(r"^(op|colo|ten|pol)\.[a-z0-9_]{1,30}\.[a-z0-9_]{1,20}$")
GENESIS = "0" * 64


class GovError(ValueError):
    """A problem with a request, worded for the person who made it."""


def init() -> None:
    with auth._lock, auth._db() as con:
        con.executescript("""
        CREATE TABLE IF NOT EXISTS requests (
          id TEXT PRIMARY KEY, persona TEXT NOT NULL, title TEXT NOT NULL, entity TEXT NOT NULL, levers TEXT NOT NULL,
          reason TEXT NOT NULL, text TEXT NOT NULL, by_name TEXT NOT NULL, at REAL NOT NULL, state TEXT NOT NULL, steps TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS audit (
          i INTEGER PRIMARY KEY, at TEXT NOT NULL, actor TEXT NOT NULL, action TEXT NOT NULL, detail TEXT NOT NULL,
          prev TEXT NOT NULL, hash TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS meter_summaries (
          id INTEGER PRIMARY KEY, at REAL NOT NULL, country TEXT NOT NULL, hub TEXT NOT NULL, size TEXT NOT NULL, mw REAL,
          pue REAL NOT NULL, wue REAL, complete REAL NOT NULL, hours INTEGER NOT NULL, file_hash TEXT NOT NULL UNIQUE);
        CREATE TABLE IF NOT EXISTS assumptions (
          key TEXT PRIMARY KEY, value REAL NOT NULL, note TEXT NOT NULL, by_name TEXT NOT NULL, at REAL NOT NULL);
        CREATE TABLE IF NOT EXISTS assumption_log (
          id INTEGER PRIMARY KEY, key TEXT NOT NULL, value REAL, note TEXT NOT NULL, by_name TEXT NOT NULL, at REAL NOT NULL);
        """)


def _txt(v, n: int) -> str:
    return re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f]", "", "" if v is None else str(v)).strip()[:n]


# ---------- Firestore plumbing ----------
_fs_ready = False
_fs_lock = threading.Lock()


def _fs():
    """The Firestore store, after the one-time copy of any SQLite records. Store failures become fsdb.StoreDown."""
    global _fs_ready
    s = fsdb.store()
    if not _fs_ready:
        with _fs_lock:
            if not _fs_ready:
                try:
                    if s.get("meta", "counters") is None:
                        _copy_sqlite_to(s)
                except fsdb.StoreDown:
                    raise
                except Exception as e:  # noqa: BLE001
                    raise fsdb.StoreDown("The team records store (Firestore) is not reachable right now. Try again in a minute.") from e
                _fs_ready = True
    return s


def _guard(fn):
    """Run a Firestore operation; GovError passes through, anything else means the store is down."""
    try:
        return fn()
    except (GovError, fsdb.StoreDown):
        raise
    except Exception as e:  # noqa: BLE001
        raise fsdb.StoreDown("The team records store (Firestore) is not reachable right now. Try again in a minute.") from e


def _copy_sqlite_to(s) -> None:
    """First use of Firestore: bring across what SQLite already holds, then write the counters (marks the copy done)."""
    with auth._db() as con:
        reqs = [_req(r) for r in con.execute("SELECT * FROM requests")]
        audit = [dict(r) for r in con.execute("SELECT * FROM audit ORDER BY i")]
        meters = [dict(r) for r in con.execute("SELECT * FROM meter_summaries")]
        items = [dict(r) for r in con.execute("SELECT * FROM assumptions")]
        log = [dict(r) for r in con.execute("SELECT * FROM assumption_log ORDER BY id")]
    for r in reqs:
        s.put("requests", r["id"], r)
    for a in audit:
        s.put("audit", f"{a['i']:09d}", a)
    for m in meters:
        s.put("meter_summaries", m["file_hash"], {k: m[k] for k in ("at", "country", "hub", "size", "mw", "pue", "wue", "complete", "hours", "file_hash")})
    for a in items:
        s.put("assumptions", a["key"], {"key": a["key"], "value": a["value"], "note": a["note"], "by": a["by_name"], "at": a["at"]})
    for n, a in enumerate(log, 1):
        s.put("assumption_log", f"{n:09d}", {"n": n, "key": a["key"], "value": a["value"], "note": a["note"], "by": a["by_name"], "at": a["at"]})
    last = audit[-1] if audit else None
    s.put("meta", "counters", {"requests": len(reqs), "audit_i": last["i"] if last else 0, "audit_hash": last["hash"] if last else GENESIS,
                               "alog": len(log), "copied_from_sqlite": time.time()})


# ---------- audit trail ----------
def _fp(prev: str, i: int, at: str, actor: str, action: str, detail: str) -> str:
    return hashlib.sha256(f"{prev}|{i}|{at}|{actor}|{action}|{detail}".encode("utf-8")).hexdigest()


def _entry(i: int, prev: str, actor: str, action: str, detail: str) -> dict:
    at = datetime.now(timezone.utc).isoformat(timespec="seconds")
    return {"i": i, "at": at, "actor": actor, "action": action, "detail": detail, "prev": prev, "hash": _fp(prev, i, at, actor, action, detail)}


def _append(con, actor: str, action: str, detail: str) -> dict:
    last = con.execute("SELECT i, hash FROM audit ORDER BY i DESC LIMIT 1").fetchone()
    e = _entry(last["i"] + 1 if last else 1, last["hash"] if last else GENESIS, actor, action, detail)
    con.execute("INSERT INTO audit (i, at, actor, action, detail, prev, hash) VALUES (?, ?, ?, ?, ?, ?, ?)",
                (e["i"], e["at"], e["actor"], e["action"], e["detail"], e["prev"], e["hash"]))
    return e


def _fs_append(tx, meta: dict, actor: str, action: str, detail: str) -> dict:
    """Write the next audit entry inside a transaction; meta (read earlier in the same transaction) is moved on."""
    e = _entry(int(meta.get("audit_i", 0)) + 1, meta.get("audit_hash") or GENESIS, actor, action, detail)
    tx.set("audit", f"{e['i']:09d}", e)
    meta["audit_i"], meta["audit_hash"] = e["i"], e["hash"]
    return e


def audit_entries(limit: int = 500) -> list[dict]:
    if fsdb.ON:
        return _guard(lambda: _fs().list("audit", order_by="i", desc=True, limit=limit))
    with auth._db() as con:
        return [dict(r) for r in con.execute("SELECT * FROM audit ORDER BY i DESC LIMIT ?", (limit,))]


def verify() -> dict:
    """Recompute every fingerprint from the start. Returns the first broken entry, if any."""
    if fsdb.ON:
        rows = _guard(lambda: _fs().list("audit", order_by="i"))
    else:
        with auth._db() as con:
            rows = [dict(r) for r in con.execute("SELECT * FROM audit ORDER BY i")]
    prev, n = GENESIS, 0
    for r in rows:
        n += 1
        if r["prev"] != prev or _fp(prev, r["i"], r["at"], r["actor"], r["action"], r["detail"]) != r["hash"]:
            return {"ok": False, "broken": r["i"], "count": n}
        prev = r["hash"]
    return {"ok": True, "broken": None, "count": n}


# ---------- approval requests ----------
def _req(r) -> dict:
    return {"id": r["id"], "persona": r["persona"], "title": r["title"], "entity": r["entity"], "levers": r["levers"], "reason": r["reason"],
            "text": r["text"], "by": r["by_name"], "at": r["at"], "state": r["state"], "steps": json.loads(r["steps"])}


PERSONA_NAME = {"op": "Data centre operator", "colo": "Colocation & hyperscaler", "ten": "Enterprise tenant", "pol": "Policy maker"}


def requests(limit: int = 200) -> list[dict]:
    if fsdb.ON:
        rows = _guard(lambda: _fs().list("requests", order_by="at", desc=True, limit=limit))
        return sorted(rows, key=lambda r: (r.get("at") or 0, r.get("id") or ""), reverse=True)   # same instant: the higher number is newer
    with auth._db() as con:
        return [_req(r) for r in con.execute("SELECT * FROM requests ORDER BY at DESC, id DESC LIMIT ?", (limit,))]


def create_request(b: dict) -> dict:
    persona = b.get("persona") if b.get("persona") in PERSONAS else None
    by = _txt(b.get("by"), 60)
    reason = _txt(b.get("reason"), 600)
    title, entity, levers, text = _txt(b.get("title"), 160), _txt(b.get("entity"), 160), _txt(b.get("levers"), 1200), _txt(b.get("text"), 3000)
    steps = [_txt(x, 80) for x in (b.get("steps") if isinstance(b.get("steps"), list) else [])][:4]
    if not persona:
        raise GovError("Unknown persona.")
    if not by:
        raise GovError("Type your name: there is no login.")
    if len(reason) < 8:
        raise GovError("Write a justification of at least a few words.")
    if not title or not entity:
        raise GovError("The request is missing what it is for.")
    if any(not x for x in steps):
        raise GovError("Every approver needs a name.")
    state = "pending" if steps else "logged"
    step_rows = [{"who": x, "state": "waiting", "by": None, "note": None, "at": None} for x in steps]
    actor, detail = f"{by} ({PERSONA_NAME[persona]})", f"{entity} · {levers}"[:1200]
    if fsdb.ON:
        def tx_fn(tx):
            meta = tx.get("meta", "counters") or {}
            rid = f"REQ-{int(meta.get('requests', 0)) + 1:04d}"
            doc = {"id": rid, "persona": persona, "title": title, "entity": entity, "levers": levers, "reason": reason, "text": text,
                   "by": by, "at": time.time(), "state": state, "steps": step_rows}
            tx.set("requests", rid, doc)
            _fs_append(tx, meta, actor, ("Request " if steps else "Logged ") + rid, detail)
            meta["requests"] = int(meta.get("requests", 0)) + 1
            tx.set("meta", "counters", meta)
            return doc
        return _guard(lambda: _fs().transact(tx_fn))
    with auth._lock, auth._db() as con:
        n = con.execute("SELECT COUNT(*) FROM requests").fetchone()[0]
        rid = f"REQ-{n + 1:04d}"
        con.execute("INSERT INTO requests (id, persona, title, entity, levers, reason, text, by_name, at, state, steps) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                    (rid, persona, title, entity, levers, reason, text, by, time.time(), state, json.dumps(step_rows)))
        _append(con, actor, ("Request " if steps else "Logged ") + rid, detail)
        return _req(con.execute("SELECT * FROM requests WHERE id = ?", (rid,)).fetchone())


def _decide_steps(r_state: str, steps: list, decision: str, by: str, note: str):
    if r_state != "pending":
        raise GovError("This request has already been decided.")
    cur = next((s for s in steps if s["state"] == "waiting"), None)
    if not cur:
        raise GovError("This request has no step waiting.")
    cur.update({"state": "approved" if decision == "approve" else "rejected", "by": by, "note": note, "at": time.time()})
    state = "rejected" if decision == "reject" else ("approved" if all(s["state"] == "approved" for s in steps) else "pending")
    return cur, state


def decide(rid: str, b: dict) -> dict:
    decision = b.get("decision")
    by, note = _txt(b.get("by"), 60), _txt(b.get("note"), 400)
    if decision not in ("approve", "reject"):
        raise GovError("Choose approve or reject.")
    if not by:
        raise GovError("Type the approver's name: there is no login.")
    if len(note) < 3:
        raise GovError("Write a short reason.")
    rid = _txt(rid, 12)
    if fsdb.ON:
        def tx_fn(tx):
            meta = tx.get("meta", "counters") or {}
            r = tx.get("requests", rid) if rid else None
            if not r:
                raise GovError("No such request.")
            steps = [dict(s) for s in r["steps"]]
            cur, state = _decide_steps(r["state"], steps, decision, by, note)
            r.update(steps=steps, state=state)
            tx.set("requests", rid, r)
            _fs_append(tx, meta, f"{by} ({cur['who']})", ("Approved " if decision == "approve" else "Rejected ") + rid + " as " + cur["who"], note)
            tx.set("meta", "counters", meta)
            return r
        return _guard(lambda: _fs().transact(tx_fn))
    with auth._lock, auth._db() as con:
        r = con.execute("SELECT * FROM requests WHERE id = ?", (rid,)).fetchone()
        if not r:
            raise GovError("No such request.")
        steps = json.loads(r["steps"])
        cur, state = _decide_steps(r["state"], steps, decision, by, note)
        con.execute("UPDATE requests SET steps = ?, state = ? WHERE id = ?", (json.dumps(steps), state, r["id"]))
        _append(con, f"{by} ({cur['who']})", ("Approved " if decision == "approve" else "Rejected ") + r["id"] + " as " + cur["who"], note)
        return _req(con.execute("SELECT * FROM requests WHERE id = ?", (r["id"],)).fetchone())


# ---------- meter summaries (pooled with k-anonymity) ----------
def size_group(mw) -> str:
    if mw is None:
        return "Size not given"
    for name, top in SIZES:
        if top is None or mw < top:
            return name
    return SIZES[-1][0]


def add_meter(b: dict) -> dict:
    def num(k, lo, hi, need=True):
        v = b.get(k)
        if v in (None, "") and not need:
            return None
        try:
            f = float(v)
        except (TypeError, ValueError):
            raise GovError(f"{k} must be a number.") from None
        if not lo <= f <= hi:
            raise GovError(f"{k} is out of range.")
        return f
    country, hub = _txt(b.get("country"), 60), _txt(b.get("hub"), 8).upper()
    fh = _txt(b.get("fileHash"), 64)
    if not country or not hub:
        raise GovError("The summary needs the site's country.")
    if not re.fullmatch(r"[0-9a-f]{64}", fh):
        raise GovError("Missing file fingerprint.")
    pue, wue, complete = num("pue", 1.0, 5.0), num("wue", 0, 20, need=False), num("complete", 0, 100)
    hours, mw = int(num("hours", 1, 100000)), num("mw", 0.01, 5000, need=False)
    row = {"at": time.time(), "country": country, "hub": hub, "size": size_group(mw), "mw": mw, "pue": round(pue, 4),
           "wue": None if wue is None else round(wue, 4), "complete": round(complete, 2), "hours": hours, "file_hash": fh}
    if fsdb.ON:
        def tx_fn(tx):                       # the file's fingerprint is the document id, so a file counts once
            if tx.get("meter_summaries", fh):
                return {"stored": False, "duplicate": True}
            tx.set("meter_summaries", fh, row)
            return {"stored": True, "duplicate": False}
        return _guard(lambda: _fs().transact(tx_fn))
    with auth._lock, auth._db() as con:
        if con.execute("SELECT 1 FROM meter_summaries WHERE file_hash = ?", (fh,)).fetchone():
            return {"stored": False, "duplicate": True}
        con.execute("INSERT INTO meter_summaries (at, country, hub, size, mw, pue, wue, complete, hours, file_hash) VALUES (?,?,?,?,?,?,?,?,?,?)",
                    tuple(row[k] for k in ("at", "country", "hub", "size", "mw", "pue", "wue", "complete", "hours", "file_hash")))
    return {"stored": True, "duplicate": False}


def pooled() -> dict:
    """Median PUE and WUE per country and size group, from files at least 90% complete. Groups under K_MIN are suppressed
    and their count is not shown."""
    if fsdb.ON:
        rows = [r for r in _guard(lambda: _fs().list("meter_summaries")) if r.get("complete", 0) >= 90]
    else:
        with auth._db() as con:
            rows = [dict(r) for r in con.execute("SELECT country, size, pue, wue FROM meter_summaries WHERE complete >= 90")]
    groups: dict = {}
    for r in rows:
        groups.setdefault((r["country"], r["size"]), []).append(r)
    out = []
    for (country, size), g in sorted(groups.items()):
        if len(g) < K_MIN:
            out.append({"country": country, "size": size, "suppressed": True})
            continue
        w = [x["wue"] for x in g if x["wue"] is not None]
        out.append({"country": country, "size": size, "suppressed": False, "n": len(g), "pue": round(statistics.median(x["pue"] for x in g), 2),
                    "wue": round(statistics.median(w), 2) if len(w) >= K_MIN else None})
    return {"groups": out, "k": K_MIN, "files": len(rows)}


# ---------- assumptions ----------
def assumptions() -> dict:
    if fsdb.ON:
        def read():
            s = _fs()
            items = {r["key"]: {"value": r["value"], "note": r["note"], "by": r["by"], "at": r["at"]} for r in s.list("assumptions")}
            log = [{k: r[k] for k in ("key", "value", "note", "by", "at")} for r in s.list("assumption_log", order_by="n", desc=True, limit=100)]
            return {"items": items, "log": log}
        return _guard(read)
    with auth._db() as con:
        items = {r["key"]: {"value": r["value"], "note": r["note"], "by": r["by_name"], "at": r["at"]} for r in con.execute("SELECT * FROM assumptions")}
        log = [dict(r) for r in con.execute("SELECT key, value, note, by_name AS by, at FROM assumption_log ORDER BY id DESC LIMIT 100")]
    return {"items": items, "log": log}


def set_assumption(b: dict) -> dict:
    key, by, note = _txt(b.get("key"), 60), _txt(b.get("by"), 60), _txt(b.get("note"), 300)
    if not ASSUME_KEY.match(key):
        raise GovError("Unknown assumption.")
    if not by:
        raise GovError("Type your name: there is no login.")
    if len(note) < 3:
        raise GovError("Say where the value comes from or why.")
    v = b.get("value")
    if v in (None, ""):
        value = None
    else:
        try:
            value = float(v)
        except (TypeError, ValueError):
            raise GovError("The value must be a number.") from None
        if value != value or abs(value) > 1e6:
            raise GovError("The value is out of range.")
    action = ("Cleared assumption " if value is None else "Set assumption ") + key
    detail = (f"{value} · " if value is not None else "") + note
    if fsdb.ON:
        def tx_fn(tx):
            meta = tx.get("meta", "counters") or {}
            now = time.time()
            if value is None:
                tx.delete("assumptions", key)
            else:
                tx.set("assumptions", key, {"key": key, "value": value, "note": note, "by": by, "at": now})
            n = int(meta.get("alog", 0)) + 1
            tx.set("assumption_log", f"{n:09d}", {"n": n, "key": key, "value": value, "note": note, "by": by, "at": now})
            _fs_append(tx, meta, by, action, detail)
            meta["alog"] = n
            tx.set("meta", "counters", meta)
        _guard(lambda: _fs().transact(tx_fn))
        return assumptions()
    with auth._lock, auth._db() as con:
        if value is None:
            con.execute("DELETE FROM assumptions WHERE key = ?", (key,))
        else:
            con.execute("INSERT INTO assumptions (key, value, note, by_name, at) VALUES (?,?,?,?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, "
                        "note = excluded.note, by_name = excluded.by_name, at = excluded.at", (key, value, note, by, time.time()))
        con.execute("INSERT INTO assumption_log (key, value, note, by_name, at) VALUES (?,?,?,?,?)", (key, value, note, by, time.time()))
        _append(con, by, action, detail)
    return assumptions()


init()
