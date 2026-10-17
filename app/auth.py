"""Accounts, roles and sign-in sessions, stored in a small SQLite file (instance/atlas.db, never deployed or committed).
Passwords are kept only as salted scrypt hashes; a session is a random token in an HttpOnly cookie, stored hashed."""
import hashlib
import hmac
import re
import secrets
import sqlite3
import threading
import time
from contextlib import contextmanager

from .settings import INSTANCE_DIR, SESSION_HOURS

DB_PATH = INSTANCE_DIR / "atlas.db"
ROLES = {"op": "Data centre operator", "colo": "Colocation & hyperscaler", "ten": "Enterprise tenant",
         "pol": "Policy maker or regulator", "admin": "Admin"}
COOKIE = "atlas_session"
_lock = threading.Lock()


class AuthError(ValueError):
    """A problem with an account request, worded for the person who made it."""


@contextmanager
def _db():
    """One connection per call: committed on success, rolled back on error, always closed."""
    INSTANCE_DIR.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(DB_PATH, timeout=10)
    try:
        con.row_factory = sqlite3.Row
        con.execute("PRAGMA foreign_keys = ON")
        with con:
            yield con
    finally:
        con.close()


def init() -> None:
    with _lock, _db() as con:
        con.executescript("""
        CREATE TABLE IF NOT EXISTS users (
          id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE COLLATE NOCASE, name TEXT NOT NULL, role TEXT NOT NULL,
          pw_hash TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, created REAL NOT NULL, last_login REAL);
        CREATE TABLE IF NOT EXISTS sessions (
          token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires REAL NOT NULL);
        """)


def hash_password(pw: str) -> str:
    salt = secrets.token_bytes(16)
    key = hashlib.scrypt(pw.encode(), salt=salt, n=2 ** 14, r=8, p=1, dklen=32)
    return f"scrypt$16384$8$1${salt.hex()}${key.hex()}"


def check_password(pw: str, stored: str) -> bool:
    try:
        _, n, r, p, salt, key = stored.split("$")
        got = hashlib.scrypt(pw.encode(), salt=bytes.fromhex(salt), n=int(n), r=int(r), p=int(p), dklen=len(bytes.fromhex(key)))
        return hmac.compare_digest(got.hex(), key)
    except Exception:  # noqa: BLE001
        return False


def _check_new(username: str, name: str, role: str, password: str | None) -> None:
    if not re.fullmatch(r"[A-Za-z0-9._@-]{3,60}", username or ""):
        raise AuthError("Usernames are 3 to 60 letters, numbers, dots, dashes, underscores or @.")
    if not (name or "").strip():
        raise AuthError("Enter the person's name.")
    if role not in ROLES:
        raise AuthError("Choose a role.")
    if password is not None and len(password) < 10:
        raise AuthError("Passwords need at least 10 characters.")


def user_count() -> int:
    with _db() as con:
        return con.execute("SELECT COUNT(*) FROM users").fetchone()[0]


def _public(row) -> dict:
    return {"id": row["id"], "username": row["username"], "name": row["name"], "role": row["role"], "roleName": ROLES.get(row["role"], row["role"]),
            "active": bool(row["active"]), "lastLogin": row["last_login"]}


def create_user(username: str, name: str, role: str, password: str) -> dict:
    username, name = (username or "").strip(), (name or "").strip()
    _check_new(username, name, role, password)
    with _lock, _db() as con:
        try:
            cur = con.execute("INSERT INTO users (username, name, role, pw_hash, created) VALUES (?, ?, ?, ?, ?)",
                              (username, name[:80], role, hash_password(password), time.time()))
        except sqlite3.IntegrityError:
            raise AuthError(f"The username {username} is already taken.") from None
        return _public(con.execute("SELECT * FROM users WHERE id = ?", (cur.lastrowid,)).fetchone())


def list_users() -> list[dict]:
    with _db() as con:
        return [_public(r) for r in con.execute("SELECT * FROM users ORDER BY active DESC, name COLLATE NOCASE")]


def update_user(uid: int, by_uid: int, name=None, role=None, active=None, password=None) -> dict:
    with _lock, _db() as con:
        row = con.execute("SELECT * FROM users WHERE id = ?", (uid,)).fetchone()
        if not row:
            raise AuthError("No such user.")
        new_role = role if role is not None else row["role"]
        new_active = row["active"] if active is None else int(bool(active))
        _check_new(row["username"], name if name is not None else row["name"], new_role, password)
        # Never leave the atlas without an active admin.
        if row["role"] == "admin" and (new_role != "admin" or not new_active):
            others = con.execute("SELECT COUNT(*) FROM users WHERE role = 'admin' AND active = 1 AND id != ?", (uid,)).fetchone()[0]
            if not others:
                raise AuthError("This is the only active admin. Make someone else an admin first.")
        con.execute("UPDATE users SET name = ?, role = ?, active = ? WHERE id = ?",
                    ((name if name is not None else row["name"]).strip()[:80], new_role, new_active, uid))
        if password is not None:
            con.execute("UPDATE users SET pw_hash = ? WHERE id = ?", (hash_password(password), uid))
        if uid != by_uid and (password is not None or not new_active or new_role != row["role"]):
            con.execute("DELETE FROM sessions WHERE user_id = ?", (uid,))  # sign them out everywhere
        return _public(con.execute("SELECT * FROM users WHERE id = ?", (uid,)).fetchone())


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def login(username: str, password: str) -> tuple[str, dict]:
    with _db() as con:
        row = con.execute("SELECT * FROM users WHERE username = ?", ((username or "").strip(),)).fetchone()
    # Check a hash even for unknown users, so response time doesn't reveal which usernames exist.
    ok = check_password(password or "", row["pw_hash"] if row else hash_password("x" * 12))
    if not row or not ok or not row["active"]:
        raise AuthError("That username and password don't match an active account.")
    token = secrets.token_urlsafe(32)
    with _lock, _db() as con:
        con.execute("DELETE FROM sessions WHERE expires < ?", (time.time(),))
        con.execute("INSERT INTO sessions (token_hash, user_id, expires) VALUES (?, ?, ?)", (_token_hash(token), row["id"], time.time() + SESSION_HOURS * 3600))
        con.execute("UPDATE users SET last_login = ? WHERE id = ?", (time.time(), row["id"]))
    return token, _public(row)


def user_for(token: str | None) -> dict | None:
    if not token:
        return None
    with _db() as con:
        row = con.execute("""SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
                             WHERE s.token_hash = ? AND s.expires > ? AND u.active = 1""", (_token_hash(token), time.time())).fetchone()
    return _public(row) if row else None


def logout(token: str | None) -> None:
    if token:
        with _lock, _db() as con:
            con.execute("DELETE FROM sessions WHERE token_hash = ?", (_token_hash(token),))


init()
