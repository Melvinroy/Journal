"""Private SQLite command/event ledger. Durable intent precedes every broker write."""
from contextlib import contextmanager
import json
import os
from pathlib import Path
import sqlite3

from .ibkr_tws import PaperSafetyError


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False)


class PaperStore:
    def __init__(self, path=None):
        self.path = Path(path or os.environ.get("BRONTIDE_PAPER_DATABASE") or
                         Path(os.environ.get("LOCALAPPDATA") or Path.home()) / "Brontide" / "paper-lifecycle.sqlite3")

    @contextmanager
    def transaction(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        db = sqlite3.connect(self.path, timeout=5)
        db.row_factory = sqlite3.Row
        try:
            db.execute("PRAGMA synchronous=FULL")
            db.execute("CREATE TABLE IF NOT EXISTS objects (kind TEXT, id TEXT, body TEXT NOT NULL, PRIMARY KEY(kind,id))")
            db.execute("CREATE TABLE IF NOT EXISTS commands (id TEXT PRIMARY KEY, campaign TEXT, request TEXT NOT NULL, state TEXT NOT NULL)")
            db.execute("CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, body TEXT NOT NULL)")
            db.execute("BEGIN IMMEDIATE")
            yield db
            db.commit()
        except Exception:
            db.rollback()
            raise
        finally:
            db.close()

    @staticmethod
    def put(db, kind, identity, value):
        db.execute("INSERT INTO objects VALUES (?,?,?) ON CONFLICT(kind,id) DO UPDATE SET body=excluded.body", (kind, identity, canonical(value)))

    @staticmethod
    def get(db, kind, identity):
        row = db.execute("SELECT body FROM objects WHERE kind=? AND id=?", (kind, identity)).fetchone()
        if row is None: raise PaperSafetyError(f"Unknown {kind} identity.")
        return json.loads(row["body"])

    def all(self, kind):
        if not self.path.exists(): return []
        with self.transaction() as db:
            return [json.loads(r[0]) for r in db.execute("SELECT body FROM objects WHERE kind=? ORDER BY rowid", (kind,))]

    @staticmethod
    def command(db, identity, campaign, request):
        row = db.execute("SELECT * FROM commands WHERE id=?", (identity,)).fetchone()
        if row:
            if row["campaign"] != campaign or row["request"] != canonical(request):
                raise PaperSafetyError("Command identity already belongs to a different action.")
            return False
        db.execute("INSERT INTO commands VALUES (?,?,?,?)", (identity, campaign, canonical(request), "unknown"))
        return True

    @staticmethod
    def event(db, identity, event):
        row = db.execute("SELECT body FROM events WHERE id=?", (identity,)).fetchone()
        if row:
            if row["body"] != canonical(event):
                raise PaperSafetyError("Conflicting broker event identity requires reconciliation.")
            return False
        db.execute("INSERT INTO events VALUES (?,?)", (identity, canonical(event)))
        return True
