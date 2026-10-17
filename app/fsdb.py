"""Firestore for the team's decision records (approval requests, the audit trail, meter summaries, assumptions).

On only when FIRESTORE=on (the Cloud Run deploy sets it); otherwise governance.py keeps using SQLite exactly as before.
The app reaches Firestore as its own service account, so there is no key; Firestore's security rules deny every
browser, because only this server reads or writes.

governance.py talks to a small store with get / list / put / transact, so the same code runs on real Firestore and,
in the tests, on MemoryStore below."""
import threading

from .settings import env

ON = env("FIRESTORE").strip().lower() in ("on", "1", "true", "yes")
DATABASE = env("FIRESTORE_DATABASE") or "(default)"
_store = None
_lock = threading.Lock()


class StoreDown(RuntimeError):
    """Firestore could not be reached; the message is shown to the person who made the request."""


class FirestoreStore:
    def __init__(self):
        from google.cloud import firestore          # imported only when Firestore is switched on
        self.fs = firestore
        self.db = firestore.Client(project=env("GOOGLE_CLOUD_PROJECT") or None, database=DATABASE)

    def _ref(self, col, did):
        return self.db.collection(col).document(did)

    def get(self, col, did):
        s = self._ref(col, did).get()
        return s.to_dict() if s.exists else None

    def list(self, col, order_by=None, desc=False, limit=None):
        q = self.db.collection(col)
        if order_by:
            q = q.order_by(order_by, direction=self.fs.Query.DESCENDING if desc else self.fs.Query.ASCENDING)
        if limit:
            q = q.limit(limit)
        return [d.to_dict() for d in q.stream()]

    def put(self, col, did, data):
        self._ref(col, did).set(data)

    def transact(self, fn):
        """Run fn(tx) in a Firestore transaction (retried by Firestore on contention, so fn only reads and writes
        through tx, and does all its reads before its writes)."""
        outer = self

        class Tx:
            def __init__(self, t):
                self.t = t

            def get(self, col, did):
                s = outer._ref(col, did).get(transaction=self.t)
                return s.to_dict() if s.exists else None

            def set(self, col, did, data):
                self.t.set(outer._ref(col, did), data)

            def delete(self, col, did):
                self.t.delete(outer._ref(col, did))

        @self.fs.transactional
        def run(t):
            return fn(Tx(t))
        return run(self.db.transaction())


class MemoryStore:
    """Stand-in with the same behaviour, for tests (Firestore's emulator needs Java)."""

    def __init__(self):
        self.data: dict = {}
        self.lock = threading.RLock()

    def get(self, col, did):
        with self.lock:
            v = self.data.get(col, {}).get(did)
            return dict(v) if v is not None else None

    def list(self, col, order_by=None, desc=False, limit=None):
        with self.lock:
            rows = [dict(v) for v in self.data.get(col, {}).values()]
        if order_by:
            rows.sort(key=lambda r: r.get(order_by), reverse=desc)
        return rows[:limit] if limit else rows

    def put(self, col, did, data):
        with self.lock:
            self.data.setdefault(col, {})[did] = dict(data)

    def transact(self, fn):
        store = self

        class Tx:
            def __init__(self):
                self.writes = []

            def get(self, col, did):
                return store.get(col, did)

            def set(self, col, did, data):
                self.writes.append(("set", col, did, dict(data)))

            def delete(self, col, did):
                self.writes.append(("del", col, did, None))

        with self.lock:                              # all or nothing, like a Firestore transaction
            tx = Tx()
            out = fn(tx)
            for op, col, did, data in tx.writes:
                if op == "set":
                    self.data.setdefault(col, {})[did] = data
                else:
                    self.data.get(col, {}).pop(did, None)
            return out


def store():
    global _store
    if _store is None:
        with _lock:
            if _store is None:
                try:
                    _store = FirestoreStore()
                except Exception as e:  # noqa: BLE001
                    raise StoreDown("The team records store (Firestore) is not reachable right now. Try again in a minute.") from e
    return _store


def use(s) -> None:
    """Tests: swap in a store (e.g. MemoryStore())."""
    global _store
    _store = s
