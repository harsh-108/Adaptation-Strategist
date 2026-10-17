"""Server checks for the Adaptation Strategist: no login, team workspace, approvals + audit trail, meter summaries,
assumptions, and the Google Cloud additions (Firestore store, demo hub lock, Firebase Hosting origin, Analytics config).
Runs on a throwaway database; nothing is sent anywhere.

    python tests/test_strategist.py               # records in SQLite (local / EC2)
    python tests/test_strategist.py --firestore   # records in Firestore (a stand-in store; the emulator needs Java)"""
import hashlib
import pathlib
import sys
import tempfile
import time

import os

FS = "--firestore" in sys.argv
os.environ.pop("DEMO_LOCK_HUBS", None)
os.environ.pop("GA_MEASUREMENT_ID", None)
os.environ["FIRESTORE"] = "on" if FS else ""
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))
from app import auth, fsdb  # noqa: E402

MEM = fsdb.MemoryStore()
if FS:
    fsdb.use(MEM)

tmp = pathlib.Path(tempfile.mkdtemp())
auth.DB_PATH = tmp / "t.db"
auth.init()
from app import sites  # noqa: E402

sites.init()
from app import alerts  # noqa: E402

alerts.init()
from app import governance  # noqa: E402

governance.init()

# An account and a site from before the change, to check they move into the team workspace.
old = auth.create_user("op1", "Olu", "op", "oppass123456")
with auth._db() as con:
    con.execute("INSERT INTO sites (user_id, name, place, country, iso2, iso3, lat, lon, status, mw, state, created) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                (old["id"], "Old Chennai site", "Chennai", "India", "IN", "IND", 13.08, 80.27, "existing", 10, "failed", time.time()))
    con.execute("INSERT INTO watches (user_id, kind, ref, created) VALUES (?,?,?,?)", (old["id"], "hub", "MAA", time.time()))

import app.main as m  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

fails = []


def ok(name, cond):
    print(("PASS " if cond else "FAIL ") + name)
    if not cond:
        fails.append(name)


c = TestClient(m.app, base_url="http://testserver")
c.__enter__()

# ---- no login ----
ok("home page served without sign-in", c.get("/").status_code == 200 and "Adaptation Strategist" in c.get("/").text)
ok("old sign-in page redirects home", c.get("/login.html", follow_redirects=False).status_code == 303)
ok("sign-in API gone", c.get("/api/auth/me").status_code == 404 and c.post("/api/auth/login", json={}).status_code == 404)
ok("user admin API gone", c.get("/api/admin/users").status_code == 404)
ok("health says no login", c.get("/api/health").json().get("login") is False)
ok("posts from other sites refused", c.post("/api/requests", json={}, headers={"Origin": "https://evil.example"}).status_code == 403)
ok("parse needs no sign-in", c.post("/api/parse", json={"text": "hi"}).status_code == 400)

# ---- team workspace ----
j = c.get("/api/sites?persona=op").json()
ok("old account's site moved to the team list", [s["name"] for s in j["sites"]] == ["Old Chennai site"])
ok("operator samples per persona", len(j["samples"]) == 3 and all(s["sample"] for s in j["samples"]))
ok("tenant samples per persona", [s["id"] for s in c.get("/api/sites?persona=ten").json()["samples"]] == ["S-TE1", "S-TE2", "S-TE3"])
ok("team cap is 100", j["max"] == 100)
with auth._db() as con:
    tid = con.execute("SELECT id FROM users WHERE username='team'").fetchone()["id"]
    ok("old watch moved to the team", con.execute("SELECT COUNT(*) FROM watches WHERE user_id=? AND ref='MAA'", (tid,)).fetchone()[0] == 1)
    ok("old sessions cleared", con.execute("SELECT COUNT(*) FROM sessions").fetchone()[0] == 0)
ok("missing country refused", c.post("/api/sites", json={"name": "x", "lat": 26.91, "lon": 75.79}).status_code == 400)
sid = j["sites"][0]["id"]
ok("site rename", c.put(f"/api/sites/{sid}", json={"name": "Chennai campus"}).json()["sites"][0]["name"] == "Chennai campus")
ok("site delete", c.delete(f"/api/sites/{sid}").json()["sites"] == [])
ok("alerts work without sign-in", c.get("/api/alerts").status_code == 200)

# ---- approvals + audit trail ----
base = {"persona": "op", "title": "Retrofit plan: Chennai", "entity": "Chennai", "levers": "Hybrid dry coolers", "reason": "Lifts resilience within budget", "text": "Requested by: Ravi", "by": "Ravi Menon"}
ok("request needs a name", c.post("/api/requests", json={**base, "by": ""}).status_code == 400)
ok("request needs a justification", c.post("/api/requests", json={**base, "reason": "ok"}).status_code == 400)
ok("unknown persona refused", c.post("/api/requests", json={**base, "persona": "admin"}).status_code == 400)
r = c.post("/api/requests", json={**base, "steps": ["Facility lead", "Capex committee"]}).json()["request"]
ok("request created and pending", r["id"] == "REQ-0001" and r["state"] == "pending" and [s["state"] for s in r["steps"]] == ["waiting", "waiting"])
ok("decision needs a name", c.post("/api/requests/REQ-0001/decide", json={"decision": "approve", "note": "fine"}).status_code == 400)
ok("decision needs a reason", c.post("/api/requests/REQ-0001/decide", json={"decision": "approve", "by": "Asha", "note": ""}).status_code == 400)
r = c.post("/api/requests/REQ-0001/decide", json={"decision": "approve", "by": "Asha", "note": "Within plan"}).json()["request"]
ok("first step approved, still pending", r["state"] == "pending" and r["steps"][0]["state"] == "approved" and r["steps"][0]["by"] == "Asha")
r = c.post("/api/requests/REQ-0001/decide", json={"decision": "approve", "by": "Chair", "note": "Funded"}).json()["request"]
ok("second step approves the request", r["state"] == "approved")
ok("no decisions after approval", c.post("/api/requests/REQ-0001/decide", json={"decision": "reject", "by": "X", "note": "late"}).status_code == 400)
r2 = c.post("/api/requests", json={**base, "persona": "colo", "steps": ["Investment committee"]}).json()["request"]
r2 = c.post(f"/api/requests/{r2['id']}/decide", json={"decision": "reject", "by": "IC", "note": "Too risky"}).json()["request"]
ok("rejection ends the request", r2["state"] == "rejected")
r3 = c.post("/api/requests", json={**base, "steps": []}).json()["request"]
ok("no route means logged", r3["state"] == "logged")
ok("unknown request", c.post("/api/requests/REQ-9999/decide", json={"decision": "approve", "by": "A", "note": "fine"}).status_code == 400)
a = c.get("/api/audit").json()
ok("audit trail recorded every action", len(a["entries"]) == 6 and a["verify"]["ok"] and a["verify"]["count"] == 6)
ok("requests listed newest first", [q["id"] for q in c.get("/api/requests").json()["requests"]][0] == "REQ-0003")
def edit_entry_2(on):
    if FS:
        d = MEM.data["audit"]["000000002"]
        d["detail"] = d["detail"] + " (edited)" if on else d["detail"].replace(" (edited)", "")
    else:
        with auth._db() as con:
            con.execute("UPDATE audit SET detail = detail || ' (edited)' WHERE i = 2" if on else "UPDATE audit SET detail = replace(detail, ' (edited)', '') WHERE i = 2")


edit_entry_2(True)
v = c.get("/api/audit").json()["verify"]
ok("tampering is caught at the edited entry", v["ok"] is False and v["broken"] == 2)
edit_entry_2(False)
ok("chain checks out again once restored", c.get("/api/audit").json()["verify"]["ok"])

# ---- meter summaries (k = 5) ----
def meter(n, country="India", mw=80, complete=99.0, pue=1.4):
    return {"country": country, "hub": "MAA", "mw": mw, "pue": pue, "wue": 1.6, "complete": complete, "hours": 168,
            "fileHash": hashlib.sha256(f"{n}{country}{mw}{complete}".encode()).hexdigest()}
ok("summary needs a file fingerprint", c.post("/api/meters", json={**meter(0), "fileHash": "x"}).status_code == 400)
ok("PUE out of range refused", c.post("/api/meters", json=meter(0, pue=0.5)).status_code == 400)
ok("summary stored", c.post("/api/meters", json=meter(1)).json()["stored"] is True)
ok("same file not counted twice", c.post("/api/meters", json=meter(1)).json()["duplicate"] is True)
for i in range(2, 5):
    c.post("/api/meters", json=meter(i, pue=1.3 + i / 100))
g = c.get("/api/meters/pooled").json()
ok("group of 4 is hidden, count too", g["groups"] == [{"country": "India", "size": "Large (over 50 MW)", "suppressed": True}])
c.post("/api/meters", json=meter(5, pue=1.5))
c.post("/api/meters", json=meter(6, complete=80))
g = c.get("/api/meters/pooled").json()["groups"][0]
ok("group of 5 shows the median", g["suppressed"] is False and g["n"] == 5 and g["pue"] == 1.34 and g["wue"] == 1.6)
ok("incomplete files left out of pooling", c.get("/api/meters/pooled").json()["files"] == 5)
if FS:
    cols = set().union(*[set(d) for d in MEM.data["meter_summaries"].values()]) | {"id"}
else:
    with auth._db() as con:
        cols = {r[1] for r in con.execute("PRAGMA table_info(meter_summaries)")}
ok("no readings kept, only the summary", cols == {"id", "at", "country", "hub", "size", "mw", "pue", "wue", "complete", "hours", "file_hash"})

# ---- assumptions (blank until entered) ----
ok("assumptions start blank", c.get("/api/assumptions").json()["items"] == {})
ok("unknown key refused", c.put("/api/assumptions", json={"key": "bad key", "value": 1, "note": "x y z", "by": "A"}).status_code == 400)
ok("value needs a name", c.put("/api/assumptions", json={"key": "op.rdhx.pue", "value": -0.1, "note": "Vendor quote", "by": ""}).status_code == 400)
ok("value needs a source", c.put("/api/assumptions", json={"key": "op.rdhx.pue", "value": -0.1, "note": "", "by": "Asha"}).status_code == 400)
j = c.put("/api/assumptions", json={"key": "op.rdhx.pue", "value": "-0.1", "note": "Vendor quote", "by": "Asha"}).json()
ok("value saved with who and why", j["items"]["op.rdhx.pue"]["value"] == -0.1 and j["items"]["op.rdhx.pue"]["by"] == "Asha")
j = c.put("/api/assumptions", json={"key": "op.rdhx.pue", "value": "", "note": "Quote withdrawn", "by": "Asha"}).json()
ok("clearing makes it blank again", "op.rdhx.pue" not in j["items"] and len(j["log"]) == 2 and j["log"][0]["value"] is None)
ok("assumption changes are in the audit trail", c.get("/api/audit").json()["entries"][0]["action"] == "Cleared assumption op.rdhx.pue")

# ---- hubs: open to everyone ----
ok("hub list without sign-in", c.get("/api/admin/hubs").status_code == 200)
pv = c.post("/api/admin/hubs", json={"preview": True, "mode": "add", "id": "KOC", "name": "Kochi", "country": "India", "region": "Asia-Pacific", "lat": 9.93, "lon": 76.27, "iso3": "IND", "iso2": "IN"})
ok(f"hub check works without sign-in ({pv.status_code})", pv.status_code == 200 and pv.json().get("preview") is True)

# ---- Google Cloud additions ----
cfg = c.get("/api/google-config").json()
ok("browser config has the Analytics ID and lock flag", {"oauthClientId", "mapsKey", "gaId", "hubsLocked"} <= set(cfg) and cfg["gaId"] == "" and cfg["hubsLocked"] is False)
g = c.get("/api/health").json()["google"]
ok("health lists Firestore, Hosting and Analytics", {"firestore", "firebaseHosting", "analytics"} <= set(g) and g["firestore"] is FS and g["firebaseHosting"] is False)
ok("health sees Firebase Hosting in front", c.get("/api/health", headers={"X-Forwarded-Host": "demo-proj.web.app"}).json()["google"]["firebaseHosting"] is True)
ok("analytics script served and loaded by the page", c.get("/analytics.js").status_code == 200 and "analytics.js" in c.get("/").text)
r = c.post("/api/requests", json={}, headers={"Origin": "https://demo-proj.web.app", "X-Forwarded-Host": "demo-proj.web.app"})
ok("Firebase Hosting origin may post (forwarded host)", r.status_code == 400)
m.ALLOWED_ORIGINS[:] = ["demo-proj.web.app"]
ok("Firebase Hosting origin may post (allowed list)", c.post("/api/requests", json={}, headers={"Origin": "https://demo-proj.web.app"}).status_code == 400)
ok("other sites still refused", c.post("/api/requests", json={}, headers={"Origin": "https://evil.example"}).status_code == 403)
m.ALLOWED_ORIGINS[:] = []
m.DEMO_LOCK_HUBS = True
hub = {"preview": True, "mode": "add", "id": "KOC", "name": "Kochi", "country": "India", "region": "Asia-Pacific", "lat": 9.93, "lon": 76.27, "iso3": "IND", "iso2": "IN"}
lr = c.post("/api/admin/hubs", json=hub)
ok("demo lock refuses hub edits", lr.status_code == 403 and "switched off" in lr.json().get("error", ""))
ok("demo lock refuses feed edits", c.post("/api/admin/feeds", json={"name": "x", "url": "https://example.org/rss"}).status_code == 403)
ok("demo lock still shows the hubs", c.get("/api/admin/hubs").status_code == 200)
ok("demo lock leaves approvals open", c.post("/api/requests", json={**base, "steps": []}).status_code == 200)
ok("page is told hubs are locked", c.get("/api/google-config").json()["hubsLocked"] is True)
m.DEMO_LOCK_HUBS = False

if FS:
    from app import governance  # noqa: E402

    class Broken:
        def __getattr__(self, name):
            raise RuntimeError("network down")
    fsdb.use(Broken())
    governance._fs_ready = True
    r = c.get("/api/requests")
    ok("Firestore outage answers 503 with a plain message", r.status_code == 503 and "Firestore" in r.json().get("error", ""))
    # one-time copy: records written while Firestore was off appear once it is switched on
    fsdb.ON = False
    governance.create_request({**base, "steps": ["Facility lead"], "title": "From SQLite"})
    fsdb.ON = True
    fresh = fsdb.MemoryStore()
    fsdb.use(fresh)
    governance._fs_ready = False
    q = c.get("/api/requests").json()["requests"]
    ok("first Firestore use copies SQLite records", any(x["title"] == "From SQLite" for x in q))
    a = c.get("/api/audit").json()
    ok("copied audit trail still verifies", a["verify"]["ok"] and a["verify"]["count"] >= 1)
    n0 = a["verify"]["count"]
    nr = c.post("/api/requests", json={**base, "steps": []}).json()["request"]
    ok("numbering and chain continue after the copy", nr["id"] == f"REQ-{len(q) + 1:04d}" and c.get("/api/audit").json()["verify"]["count"] == n0 + 1)

c.__exit__(None, None, None)
print(f"\n{len(fails)} failed" if fails else f"\nall passed ({'Firestore' if FS else 'SQLite'})")
sys.exit(1 if fails else 0)
