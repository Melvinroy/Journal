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
    published_db_path: Path | None = None
    eod_close_delay_minutes: int = 30
    eod_correction_overlap_sessions: int = 5
    eod_minimum_coverage_percent: float = 99.0

    @property
    def serving_db_path(self) -> Path:
        return self.published_db_path or self.db_path.with_name(
            f"{self.db_path.stem}.published{self.db_path.suffix}"
        )

    @classmethod
    def from_env(cls, *, require_alpaca: bool = False) -> "Settings":
        configured_env = os.getenv("BRONTIDE_ENV_FILE", "").strip()
        env_path = Path(configured_env).expanduser().resolve() if configured_env else None
        if env_path:
            if not env_path.is_file():
                raise RuntimeError("BRONTIDE_ENV_FILE does not identify a readable environment file")
            load_dotenv(env_path, override=False)
            env_directory = env_path.parent
        else:
            load_dotenv()
            env_directory = Path.cwd()

        def resolve_path(name: str, default: str) -> Path:
            value = Path(os.getenv(name, default)).expanduser()
            return value.resolve() if value.is_absolute() else (env_directory / value).resolve()

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
        db_path = resolve_path("BRONTIDE_DB_PATH", "./data/brontide.duckdb")
        published_value = os.getenv("BRONTIDE_PUBLISHED_DB_PATH", "").strip()
        close_delay = int(os.getenv("BRONTIDE_EOD_CLOSE_DELAY_MINUTES", "30"))
        overlap = int(os.getenv("BRONTIDE_EOD_CORRECTION_OVERLAP_SESSIONS", "5"))
        coverage = float(os.getenv("BRONTIDE_EOD_MINIMUM_COVERAGE_PERCENT", "99"))
        if not 0 <= close_delay <= 360:
            raise ValueError("BRONTIDE_EOD_CLOSE_DELAY_MINUTES must be between 0 and 360")
        if not 0 <= overlap <= 22:
            raise ValueError("BRONTIDE_EOD_CORRECTION_OVERLAP_SESSIONS must be between 0 and 22")
        if not 0 < coverage <= 100:
            raise ValueError("BRONTIDE_EOD_MINIMUM_COVERAGE_PERCENT must be greater than 0 and at most 100")
        return cls(
            alpaca_api_key=key,
            alpaca_api_secret=secret,
            db_path=db_path,
            api_host=os.getenv("BRONTIDE_API_HOST", "127.0.0.1"),
            alpaca_trading_base_url=os.getenv("BRONTIDE_ALPACA_TRADING_BASE_URL", "https://api.alpaca.markets").rstrip("/"),
            api_port=int(os.getenv("BRONTIDE_API_PORT", "8765")),
            alpaca_batch_size=batch_size,
            published_db_path=(resolve_path("BRONTIDE_PUBLISHED_DB_PATH", published_value) if published_value else None),
            eod_close_delay_minutes=close_delay,
            eod_correction_overlap_sessions=overlap,
            eod_minimum_coverage_percent=coverage,
        )
