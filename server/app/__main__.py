import argparse
import logging
from pathlib import Path

import uvicorn

from . import create_app
from .config import DATA_DIR, HOST, PORT, Settings

logger = logging.getLogger(__name__)


def main():
    parser = argparse.ArgumentParser(description='Inventário urbano de Aveiro')
    parser.add_argument('--host', default=HOST)
    parser.add_argument('--port', default=PORT, type=int)
    parser.add_argument('--data-dir', default=DATA_DIR, type=Path)
    args = parser.parse_args()
    logging.basicConfig(format='%(levelname)s: %(message)s')
    host = '127.0.0.1' if args.host.lower() == 'localhost' else args.host
    try:
        data_dir = args.data_dir.expanduser()
        if any('onedrive' in str(path).casefold() for path in (data_dir, data_dir.resolve())):
            logger.warning('A pasta de dados está no OneDrive. A sincronização pode interferir com os ficheiros de imagens.')
        settings = Settings.from_env(data_dir.resolve())
        app = create_app(settings)
    except ValueError as exc:
        parser.error(str(exc))
    uvicorn.run(app, host=host, port=args.port)


if __name__ == '__main__':
    main()
