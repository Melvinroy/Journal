from __future__ import annotations

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from brontide_eod.config import Settings
from brontide_eod.store import DuckDBStore

app = FastAPI(title="Brontide EOD API", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=False,
    allow_methods=["GET"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "brontide-eod"}


@app.get("/v1/instruments")
def instruments(q: str = "", limit: int = Query(25, ge=1, le=100)) -> list[dict[str, object]]:
    settings = Settings.from_env()
    with DuckDBStore(settings.db_path) as store:
        pattern = f"%{q.strip().upper()}%"
        columns = [item[0] for item in store.connection.execute("DESCRIBE instruments").fetchall()]
        rows = store.connection.execute(
            """
            SELECT * FROM instruments
            WHERE symbol ILIKE ? OR name ILIKE ?
            ORDER BY CASE WHEN symbol = ? THEN 0 ELSE 1 END, symbol
            LIMIT ?
            """,
            [pattern, pattern, q.strip().upper(), limit],
        ).fetchall()
        return [dict(zip(columns, row, strict=True)) for row in rows]


@app.get("/v1/bars/{symbol}")
def bars(symbol: str, limit: int = Query(300, ge=1, le=5_000)) -> list[dict[str, object]]:
    settings = Settings.from_env()
    with DuckDBStore(settings.db_path) as store:
        result = store.bars(symbol, limit)
    if not result:
        raise HTTPException(status_code=404, detail=f"No bars found for {symbol.upper()}")
    return result
