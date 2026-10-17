"""No login: the whole team shares one workspace. Sites, watches and alerts belong to a single "team" record in the
users table (it cannot sign in: there is no sign-in any more). On first use, anything the old accounts had is moved
to it, so nothing is lost. The old accounts stay in the table untouched."""
import time

from . import auth

_TEAM: int | None = None


def team_id() -> int:
    global _TEAM
    if _TEAM is not None:
        return _TEAM
    with auth._lock, auth._db() as con:
        r = con.execute("SELECT id FROM users WHERE username = 'team'").fetchone()
        tid = r["id"] if r else con.execute(
            "INSERT INTO users (username, name, role, pw_hash, active, created) VALUES ('team', 'Team workspace', 'admin', '!', 1, ?)",
            (time.time(),)).lastrowid
        for t in ("sites", "alert_rules", "alerts"):
            con.execute(f"UPDATE {t} SET user_id = ? WHERE user_id != ?", (tid, tid))
        con.execute("INSERT OR IGNORE INTO watches (user_id, kind, ref, created) SELECT ?, kind, ref, created FROM watches WHERE user_id != ?", (tid, tid))
        con.execute("DELETE FROM watches WHERE user_id != ?", (tid,))
        con.execute("DELETE FROM alert_snaps WHERE user_id != ?", (tid,))
        con.execute("DELETE FROM sessions")
    _TEAM = tid
    return tid
