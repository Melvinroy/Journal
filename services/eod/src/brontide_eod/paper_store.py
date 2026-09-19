"""Private SQLite command/event ledger. Durable intent precedes every broker write."""
from contextlib import contextmanager
import json
import os
from pathlib import Path
import sqlite3
import uuid

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
        existed = self.path.exists()
        db = sqlite3.connect(self.path, timeout=5)
        db.row_factory = sqlite3.Row
        try:
            db.execute("PRAGMA synchronous=FULL")
            db.execute("CREATE TABLE IF NOT EXISTS objects (kind TEXT, id TEXT, body TEXT NOT NULL, PRIMARY KEY(kind,id))")
            db.execute("CREATE TABLE IF NOT EXISTS commands (id TEXT PRIMARY KEY, campaign TEXT, request TEXT NOT NULL, state TEXT NOT NULL)")
            db.execute("CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, body TEXT NOT NULL)")
            version = db.execute("PRAGMA user_version").fetchone()[0]
            if version > 1: raise PaperSafetyError("Paper database version is newer than this application.")
            if version == 0:
                if existed: self.backup(self.path.with_name(self.path.name + ".pre-v1." + uuid.uuid4().hex + ".bak"))
                db.execute("PRAGMA user_version=1")
            db.execute("BEGIN IMMEDIATE")
            yield db
            db.commit()
        except Exception:
            db.rollback()
            raise
        finally:
            db.close()

    def backup(self, destination):
        """SQLite's backup API captures a consistent database, including WAL data."""
        destination = Path(destination)
        if destination.exists(): raise PaperSafetyError("Backup destination already exists.")
        destination.parent.mkdir(parents=True, exist_ok=True)
        with sqlite3.connect(self.path.as_uri() + "?mode=ro", uri=True) as source:
            with sqlite3.connect(destination) as target:
                source.backup(target)
                if target.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
                    raise PaperSafetyError("Backup integrity verification failed.")
        return destination

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
