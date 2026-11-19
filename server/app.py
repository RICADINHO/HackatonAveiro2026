import asyncio
import logging
import math
import os
from contextlib import asynccontextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Annotated, Literal
from uuid import UUID, uuid4

import requests
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, File, HTTPException, Query, Response, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from PIL import Image
from psycopg.errors import ForeignKeyViolation
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb
from psycopg_pool import ConnectionPool
from pydantic import BaseModel, ConfigDict, Field, StringConstraints

from . import inventory
from .imaging import MAX_IMAGE_BYTES, prepare_photo

logger = logging.getLogger(__name__)
bearer = HTTPBearer(auto_error=False)
Category = Literal['sinalizacao', 'iluminacao', 'residuos']
Latitude = Annotated[float, Field(ge=-90, le=90, allow_inf_nan=False)]
Longitude = Annotated[float, Field(ge=-180, le=180, allow_inf_nan=False)]
Heading = Annotated[float, Field(ge=0, lt=360, allow_inf_nan=False)]


@dataclass(frozen=True)
class Settings:
    database_url: str
    supabase_url: str
    supabase_publishable_key: str
    image_dir: Path
    public_image_base_url: str
    cors_origins: tuple[str, ...]
    dedup_radius: float = 50

    @classmethod
    def from_env(cls):
        load_dotenv(Path(__file__).resolve().parents[1] / '.env')
        radius = float(os.getenv('DEDUP_RADIUS_METERS', '50'))
        if not math.isfinite(radius) or radius <= 0:
            raise ValueError('DEDUP_RADIUS_METERS must be positive and finite')
        return cls(
            os.environ['DATABASE_URL'], os.environ['SUPABASE_URL'].rstrip('/'),
            os.environ['SUPABASE_PUBLISHABLE_KEY'], Path(os.environ['IMAGE_DIR']),
            os.environ['PUBLIC_IMAGE_BASE_URL'].rstrip('/'),
            tuple(origin.strip() for origin in os.environ['CORS_ORIGINS'].split(',') if origin.strip()),
            radius,
        )


@dataclass(frozen=True)
class Principal:
    id: UUID
    technician: bool
    public_name: str | None


class CameraInput(BaseModel):
    model_config = ConfigDict(extra='forbid')
    latitude: Latitude | None = None
    longitude: Longitude | None = None
    heading: Heading | None = None


class CameraCorrection(CameraInput):
    latitude: Latitude
    longitude: Longitude


class ItemUpdate(BaseModel):
    model_config = ConfigDict(extra='forbid')
    label: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=160)]
    latitude: Latitude | None = None
    longitude: Longitude | None = None


class ReportCreate(BaseModel):
    model_config = ConfigDict(extra='forbid')
    description: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=4000)]
    item_id: UUID | None = None


def remove_file(path: Path):
    try:
        path.unlink(missing_ok=True)
    except OSError:
        logger.exception('Could not remove %s', path)


def create_app(settings: Settings | None = None):
    settings = settings or Settings.from_env()
    pool = ConnectionPool(settings.database_url, open=False, min_size=1, max_size=8,
                          kwargs={'row_factory': dict_row, 'autocommit': True,
                                  'options': '-c default_transaction_isolation=read\\ committed'})
    private_dir = settings.image_dir / 'private'
    public_dir = settings.image_dir / 'public'

    def clean_previews():
        with pool.connection() as db, db.transaction():
            expired = db.execute('''
                DELETE FROM aveiro.image_previews WHERE id IN (
                    SELECT id FROM aveiro.image_previews WHERE expires_at <= now() FOR UPDATE SKIP LOCKED
                ) RETURNING id
            ''').fetchall()
        for row in expired:
            filename = f"{row['id']}.jpg"
            remove_file(private_dir / filename)
            # An interrupted publication can leave a link without a committed image row.
            remove_file(public_dir / filename)

    @asynccontextmanager
    async def lifespan(_app):
        private_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
        public_dir.mkdir(parents=True, exist_ok=True, mode=0o755)
        await run_in_threadpool(pool.open, wait=True)
        try:
            async def cleanup_loop():
                while True:
                    try:
                        await run_in_threadpool(clean_previews)
                    except Exception:
                        logger.exception('Could not clean up image previews')
                    await asyncio.sleep(300)

            task = asyncio.create_task(cleanup_loop())
            try:
                yield
            finally:
                task.cancel()
                await asyncio.gather(task, return_exceptions=True)
        finally:
            await run_in_threadpool(pool.close)

    app = FastAPI(title='Inventário urbano de Aveiro', lifespan=lifespan)
    app.add_middleware(CORSMiddleware, allow_origins=list(settings.cors_origins),
                       allow_methods=['GET', 'POST', 'PATCH', 'DELETE'],
                       allow_headers=['Authorization', 'Content-Type'])

    def authenticated(credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)]):
        unauthorized = HTTPException(401, 'Inicia sessão para continuar.', headers={'WWW-Authenticate': 'Bearer'})
        if credentials is None:
            raise unauthorized
        try:
            # Auth validates the JWT and returns current app_metadata, including after role changes.
            result = requests.get(f'{settings.supabase_url}/auth/v1/user', timeout=5, headers={
                'apikey': settings.supabase_publishable_key,
                'Authorization': f'Bearer {credentials.credentials}',
            }, allow_redirects=False)
            if result.status_code in (400, 401, 403, 404):
                raise unauthorized
            result.raise_for_status()
            if result.status_code != 200:
                raise ValueError('Unexpected response from Supabase')
            user = result.json()
            if user.get('is_anonymous') or user.get('role') != 'authenticated':
                raise unauthorized
            app_metadata = user.get('app_metadata') or {}
            public_name = (user.get('user_metadata') or {}).get('public_name')
            name = public_name.strip()[:120] if isinstance(public_name, str) else ''
            return Principal(UUID(user['id']), app_metadata.get('role') == 'technician', name or None)
        except (requests.RequestException, ValueError, TypeError, KeyError, AttributeError) as exc:
            raise HTTPException(503, 'Não foi possível validar a sessão no Supabase.') from exc

    def technician(user: Annotated[Principal, Depends(authenticated)]):
        if not user.technician:
            raise HTTPException(403, 'Esta operação requer o papel de técnico.')
        return user

    def image_record(db, image_id, owner_id):
        return db.execute('SELECT id FROM aveiro.images WHERE id = %s AND uploader_id = %s',
                          (image_id, owner_id)).fetchone()

    @app.get('/me')
    def me(user: Annotated[Principal, Depends(authenticated)]):
        return {'id': user.id, 'public_name': user.public_name,
                'role': 'technician' if user.technician else 'authenticated'}

    @app.get('/items')
    def items(category: Annotated[list[Category] | None, Query()] = None,
              class_name: Annotated[list[str] | None, Query()] = None):
        with pool.connection() as db:
            return inventory.list_items(db, category, class_name)

    @app.get('/items/{item_id}')
    def item_detail(item_id: UUID):
        with pool.connection() as db, db.transaction():
            db.execute('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
            item = inventory.item_detail(db, item_id)
        if item is None:
            raise HTTPException(404, 'Elemento inexistente.')
        for image in item['images']:
            image['url'] = f"{settings.public_image_base_url}/{image.pop('file_path')}"
        return item

    @app.get('/images')
    def images(_user: Annotated[Principal, Depends(technician)]):
        with pool.connection() as db:
            rows = db.execute(f'''SELECT {inventory.IMAGE_FIELDS} FROM aveiro.images im
                                 ORDER BY im.submitted_at DESC, im.id''').fetchall()
        for image in rows:
            image['url'] = f"{settings.public_image_base_url}/{image.pop('file_path')}"
        return rows

    @app.post('/previews', status_code=201)
    def create_preview(user: Annotated[Principal, Depends(authenticated)], image: Annotated[UploadFile, File()]):
        contents = image.file.read(MAX_IMAGE_BYTES + 1)
        if len(contents) > MAX_IMAGE_BYTES:
            raise HTTPException(413, 'O limite por imagem é 12 MiB.')
        preview_id = uuid4()
        path = private_dir / f'{preview_id}.jpg'
        try:
            camera, detections = prepare_photo(contents, path)
            with pool.connection() as db:
                db.execute('INSERT INTO aveiro.image_previews (id, owner_id, metadata, detections) VALUES (%s,%s,%s,%s)',
                           (preview_id, user.id, Jsonb(camera), Jsonb(detections)))
        except (ValueError, SyntaxError, Image.DecompressionBombError) as exc:
            remove_file(path)
            raise HTTPException(422, 'Seleciona uma imagem JPEG, PNG ou WebP válida.') from exc
        except OSError as exc:
            remove_file(path)
            if exc.errno is not None:
                raise
            raise HTTPException(422, 'A imagem não pôde ser lida.') from exc
        except Exception:
            remove_file(path)
            raise
        return {'id': preview_id, 'camera': camera, 'detections': detections}

    @app.get('/previews/{preview_id}/image')
    def preview_image(preview_id: UUID, user: Annotated[Principal, Depends(authenticated)]):
        with pool.connection() as db, db.transaction():
            row = db.execute('''
                SELECT id FROM aveiro.image_previews WHERE id = %s AND owner_id = %s
                AND expires_at > statement_timestamp() FOR SHARE
            ''', (preview_id, user.id)).fetchone()
            if row is None:
                raise HTTPException(404, 'Pré-visualização inexistente ou expirada.')
            try:
                contents = (private_dir / f'{preview_id}.jpg').read_bytes()
            except FileNotFoundError as exc:
                raise HTTPException(404, 'Pré-visualização inexistente ou expirada.') from exc
        return Response(contents, media_type='image/jpeg', headers={'Cache-Control': 'private, no-store'})

    @app.post('/previews/{preview_id}/publish')
    def publish(preview_id: UUID, manual: CameraInput, user: Annotated[Principal, Depends(authenticated)]):
        staged = private_dir / f'{preview_id}.jpg'
        published = public_dir / staged.name
        with pool.connection() as db, db.transaction():
            preview = db.execute('''
                SELECT metadata, detections FROM aveiro.image_previews WHERE id = %s AND owner_id = %s
                AND expires_at > statement_timestamp() FOR UPDATE
            ''', (preview_id, user.id)).fetchone()
            if preview is None:
                if image_record(db, preview_id, user.id):
                    return {'id': preview_id}
                raise HTTPException(404, 'Pré-visualização inexistente ou expirada.')
            camera = CameraInput.model_validate(preview['metadata'] | manual.model_dump(exclude_none=True))
            if None in (camera.latitude, camera.longitude, camera.heading):
                raise HTTPException(422, 'Preenche a latitude, a longitude e a direção da câmara.')
            inventory.lock_inventory(db)
            inventory.record_image(db, preview_id, user, camera, preview['detections'], settings.dedup_radius)
            try:
                os.link(staged, published)
            except FileExistsError:
                # A prior interrupted transaction may already have linked this processed file.
                if not staged.samefile(published):
                    raise
            except FileNotFoundError as exc:
                raise HTTPException(404, 'O ficheiro da pré-visualização já não está disponível.') from exc
            db.execute('DELETE FROM aveiro.image_previews WHERE id = %s', (preview_id,))
        remove_file(staged)
        return {'id': preview_id}

    @app.get('/published/{image_id}', status_code=204, include_in_schema=False)
    def published_image_exists(image_id: UUID):
        """Caddy checks publication in PostGIS before opening the processed JPEG."""
        with pool.connection() as db:
            row = db.execute('SELECT id FROM aveiro.images WHERE id = %s', (image_id,)).fetchone()
        if row is None:
            raise HTTPException(404, 'Imagem inexistente.')
        return Response(status_code=204)

    @app.patch('/items/{item_id}', status_code=204)
    def edit_item(item_id: UUID, update: ItemUpdate, _user: Annotated[Principal, Depends(technician)]):
        if (update.latitude is None) != (update.longitude is None):
            raise HTTPException(422, 'Indica as duas coordenadas.')
        with pool.connection() as db, db.transaction():
            inventory.lock_inventory(db)
            if update.latitude is None:
                row = db.execute('UPDATE aveiro.items SET label = %s WHERE id = %s RETURNING id',
                                 (update.label, item_id)).fetchone()
            else:
                row = db.execute(f'''UPDATE aveiro.items SET label = %s, position = {inventory.POINT},
                                     position_manually_corrected = true WHERE id = %s RETURNING id''',
                                 (update.label, update.longitude, update.latitude, item_id)).fetchone()
            if row is None:
                raise HTTPException(404, 'Elemento inexistente.')

    @app.delete('/items/{item_id}', status_code=204)
    def delete_item(item_id: UUID, _user: Annotated[Principal, Depends(technician)]):
        with pool.connection() as db, db.transaction():
            inventory.lock_inventory(db)
            if db.execute('DELETE FROM aveiro.items WHERE id = %s', (item_id,)).rowcount == 0:
                raise HTTPException(404, 'Elemento inexistente.')

    @app.patch('/images/{image_id}', status_code=204)
    def edit_image(image_id: UUID, update: CameraCorrection, _user: Annotated[Principal, Depends(technician)]):
        with pool.connection() as db, db.transaction():
            if not inventory.correct_camera(db, image_id, update):
                raise HTTPException(404, 'Imagem inexistente.')

    @app.delete('/images/{image_id}', status_code=204)
    def delete_image(image_id: UUID, _user: Annotated[Principal, Depends(technician)]):
        with pool.connection() as db, db.transaction():
            if not inventory.delete_image(db, image_id):
                raise HTTPException(404, 'Imagem inexistente.')
        remove_file(public_dir / f'{image_id}.jpg')

    @app.post('/reports', status_code=201)
    def create_report(report: ReportCreate, user: Annotated[Principal, Depends(authenticated)]):
        report_id = uuid4()
        try:
            with pool.connection() as db:
                db.execute('INSERT INTO aveiro.reports (id, description, author_id, item_id) VALUES (%s,%s,%s,%s)',
                           (report_id, report.description, user.id, report.item_id))
        except ForeignKeyViolation as exc:
            raise HTTPException(404, 'Elemento associado inexistente.') from exc
        return {'id': report_id}

    @app.get('/reports')
    def reports(_user: Annotated[Principal, Depends(technician)]):
        with pool.connection() as db:
            return db.execute('''
                SELECT r.*, i.label AS item_label FROM aveiro.reports r
                LEFT JOIN aveiro.items i ON i.id = r.item_id ORDER BY r.submitted_at DESC
            ''').fetchall()

    @app.patch('/reports/{report_id}/resolve', status_code=204)
    def resolve_report(report_id: UUID, user: Annotated[Principal, Depends(technician)]):
        with pool.connection() as db, db.transaction():
            db.execute("""UPDATE aveiro.reports SET status = 'resolved', resolved_by = %s, resolved_at = now()
                          WHERE id = %s AND status = 'open'""", (user.id, report_id))
            if not db.execute('SELECT id FROM aveiro.reports WHERE id = %s', (report_id,)).fetchone():
                raise HTTPException(404, 'Problema inexistente.')

    return app
