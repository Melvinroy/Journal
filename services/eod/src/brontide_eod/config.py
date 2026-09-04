from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv


@dataclass(frozen=True)
class Settings:
    alpaca_api_key: str
    alpaca_api_secret: str
    db_path: Path
    api_host: str = "127.0.0.1"
    alpaca_trading_base_url: str = "https://api.alpaca.markets"
    api_port: int = 8765
    alpaca_batch_size: int = 200

    @classmethod
    def from_env(cls, *, require_alpaca: bool = False) -> "Settings":
        load_dotenv()
        key = os.getenv("ALPACA_API_KEY", "").strip()
        secret = os.getenv("ALPACA_API_SECRET", "").strip()
        if require_alpaca and (not key or not secret):
            raise RuntimeError(
                "ALPACA_API_KEY and ALPACA_API_SECRET are required. "
                "Copy .env.example to .env and keep that file local."
            )
        batch_size = int(os.getenv("BRONTIDE_ALPACA_BATCH_SIZE", "200"))
        if not 1 <= batch_size <= 1_000:
            raise ValueError("BRONTIDE_ALPACA_BATCH_SIZE must be between 1 and 1000")
        return cls(
            alpaca_api_key=key,
            alpaca_api_secret=secret,
            db_path=Path(os.getenv("BRONTIDE_DB_PATH", "./data/brontide.duckdb")),
            api_host=os.getenv("BRONTIDE_API_HOST", "127.0.0.1"),
            alpaca_trading_base_url=os.getenv("BRONTIDE_ALPACA_TRADING_BASE_URL", "https://api.alpaca.markets").rstrip("/"),
            api_port=int(os.getenv("BRONTIDE_API_PORT", "8765")),
            alpaca_batch_size=batch_size,
        )
