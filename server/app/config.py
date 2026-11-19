import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import dotenv_values

PROJECT_DIR = Path(__file__).resolve().parents[2]
FRONTEND_DIR = PROJECT_DIR / 'web' / 'dist'
DATA_DIR = Path.home() / 'aveiro-data'
HOST = '127.0.0.1'
PORT = 8000
SUPABASE_URL = 'https://vvokqdzayayfzktkabqa.supabase.co'
SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_tLFd82qfB5miKQWpYATt0g_xQRck8hM'
CORS_ORIGINS = ('http://localhost:5173', 'http://127.0.0.1:5173', 'https://ricadinho.github.io')
DEDUP_RADIUS_METERS = 50


@dataclass(frozen=True)
class Settings:
    database_url: str
    supabase_url: str
    supabase_publishable_key: str
    data_dir: Path
    cors_origins: tuple[str, ...] = CORS_ORIGINS
    dedup_radius: float = DEDUP_RADIUS_METERS
    frontend_dir: Path = FRONTEND_DIR

    @classmethod
    def from_env(cls, data_dir: Path):
        secrets = dotenv_values(PROJECT_DIR / '.env', interpolate=False)
        database_url = os.environ.get('DATABASE_URL') or secrets.get('DATABASE_URL')
        if not database_url:
            raise ValueError('Define DATABASE_URL no .env da raiz.')
        return cls(database_url, SUPABASE_URL.rstrip('/'), SUPABASE_PUBLISHABLE_KEY, data_dir)
