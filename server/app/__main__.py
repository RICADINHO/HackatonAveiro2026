import argparse
import logging
import os
from ipaddress import ip_address
from pathlib import Path

import uvicorn

from ..imaging import PLACEHOLDER_BLUR
from . import create_app
from .config import DATA_DIR, HOST, PORT, Settings

logger = logging.getLogger(__name__)


def checked_host(host: str) -> str:
    if host.lower() == 'localhost':
        host = '127.0.0.1'
    try:
        loopback = ip_address(host).is_loopback
    except ValueError:
        loopback = False
    if PLACEHOLDER_BLUR and not loopback and os.environ.get('ALLOW_PLACEHOLDER_PUBLIC') != '1':
        raise ValueError('O desfoque experimental só permite um host loopback. Usa 127.0.0.1 ou define ALLOW_PLACEHOLDER_PUBLIC=1 no terminal.')
    return host


def main():
    parser = argparse.ArgumentParser(description='Inventário urbano de Aveiro')
    parser.add_argument('--host', default=HOST)
    parser.add_argument('--port', default=PORT, type=int)
    parser.add_argument('--data-dir', default=DATA_DIR, type=Path)
    args = parser.parse_args()
    logging.basicConfig(format='%(levelname)s: %(message)s')
    if PLACEHOLDER_BLUR:
        logger.warning('Desfoque experimental ativo. Usa imagens sem rostos ou matrículas visíveis.')
    try:
        host = checked_host(args.host)
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
