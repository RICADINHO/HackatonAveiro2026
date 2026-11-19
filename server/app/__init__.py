import asyncio
import logging
import os
from contextlib import asynccontextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Annotated, Literal
from uuid import UUID, uuid4

import requests
from fastapi import APIRouter, Depends, FastAPI, File, HTTPException, Query, Response, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from PIL import Image
from psycopg.errors import ForeignKeyViolation
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb
from psycopg_pool import ConnectionPool
from pydantic import BaseModel, ConfigDict, Field, StringConstraints

from .. import inventory
from ..imaging import MAX_IMAGE_BYTES, DetectorError, prepare_photo
from .config import Settings

logger = logging.getLogger(__name__)
bearer = HTTPBearer(auto_error=False)
Category = Literal['sinalizacao', 'iluminacao', 'residuos']
Latitude = Annotated[float, Field(ge=-90, le=90, allow_inf_nan=False)]
Longitude = Annotated[float, Field(ge=-180, le=180, allow_inf_nan=False)]
Heading = Annotated[float, Field(ge=0, lt=360, allow_inf_nan=False)]


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


def create_app(settings: Settings):
    pool = ConnectionPool(settings.database_url, open=False, min_size=1, max_size=8,
                          kwargs={'row_factory': dict_row, 'autocommit': True,
                                  'options': '-c default_transaction_isolation=read\\ committed'})
    private_dir = (settings.data_dir / 'images' / 'private').resolve()
    public_dir = (settings.data_dir / 'images' / 'public').resolve()
    models_dir = (settings.data_dir / 'models').resolve()
    frontend_dir = settings.frontend_dir.resolve()
    if private_dir.is_relative_to(public_dir) or public_dir.is_relative_to(private_dir):
        raise ValueError('As pastas de imagens privadas e públicas têm de ser separadas.')
    api = APIRouter()

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
        models_dir.mkdir(parents=True, exist_ok=True)
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

    @api.get('/me')
    def me(user: Annotated[Principal, Depends(authenticated)]):
        return {'id': user.id, 'public_name': user.public_name,
                'role': 'technician' if user.technician else 'authenticated'}

    @api.get('/items')
    def items(category: Annotated[list[Category] | None, Query()] = None,
              class_name: Annotated[list[str] | None, Query()] = None):
        with pool.connection() as db:
            return inventory.list_items(db, category, class_name)

    @api.get('/items/{item_id}')
    def item_detail(item_id: UUID):
        with pool.connection() as db, db.transaction():
            db.execute('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
            item = inventory.item_detail(db, item_id)
        if item is None:
            raise HTTPException(404, 'Elemento inexistente.')
        for image in item['images']:
            image['url'] = f"/img/{image.pop('file_path')}"
        return item

    @api.get('/images')
    def images(_user: Annotated[Principal, Depends(technician)]):
        with pool.connection() as db:
            rows = db.execute(f'''SELECT {inventory.IMAGE_FIELDS} FROM aveiro.images im
                                 ORDER BY im.submitted_at DESC, im.id''').fetchall()
        for image in rows:
            image['url'] = f"/img/{image.pop('file_path')}"
        return rows

    @api.post('/previews', status_code=201)
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
        except DetectorError as exc:
            remove_file(path)
            logger.exception('Falhou a deteção de mobiliário urbano')
            raise HTTPException(503, 'O detetor de mobiliário urbano está indisponível.') from exc
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

    @api.get('/previews/{preview_id}/image')
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

    @api.post('/previews/{preview_id}/publish')
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

    def require_publication(image_id: UUID):
        with pool.connection() as db:
            row = db.execute('SELECT id FROM aveiro.images WHERE id = %s', (image_id,)).fetchone()
        if row is None:
            raise HTTPException(404, 'Imagem inexistente.')

    @api.get('/published/{image_id}', status_code=204, include_in_schema=False)
    def published_image_exists(image_id: UUID):
        require_publication(image_id)
        return Response(status_code=204)

    @api.patch('/items/{item_id}', status_code=204)
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

    @api.delete('/items/{item_id}', status_code=204)
    def delete_item(item_id: UUID, _user: Annotated[Principal, Depends(technician)]):
        with pool.connection() as db, db.transaction():
            inventory.lock_inventory(db)
            if db.execute('DELETE FROM aveiro.items WHERE id = %s', (item_id,)).rowcount == 0:
                raise HTTPException(404, 'Elemento inexistente.')

    @api.patch('/images/{image_id}', status_code=204)
    def edit_image(image_id: UUID, update: CameraCorrection, _user: Annotated[Principal, Depends(technician)]):
        with pool.connection() as db, db.transaction():
            if not inventory.correct_camera(db, image_id, update):
                raise HTTPException(404, 'Imagem inexistente.')

    @api.delete('/images/{image_id}', status_code=204)
    def delete_image(image_id: UUID, _user: Annotated[Principal, Depends(technician)]):
        with pool.connection() as db, db.transaction():
            if not inventory.delete_image(db, image_id):
                raise HTTPException(404, 'Imagem inexistente.')
        remove_file(public_dir / f'{image_id}.jpg')

    @api.post('/reports', status_code=201)
    def create_report(report: ReportCreate, user: Annotated[Principal, Depends(authenticated)]):
        report_id = uuid4()
        try:
            with pool.connection() as db:
                db.execute('INSERT INTO aveiro.reports (id, description, author_id, item_id) VALUES (%s,%s,%s,%s)',
                           (report_id, report.description, user.id, report.item_id))
        except ForeignKeyViolation as exc:
            raise HTTPException(404, 'Elemento associado inexistente.') from exc
        return {'id': report_id}

    @api.get('/reports')
    def reports(_user: Annotated[Principal, Depends(technician)]):
        with pool.connection() as db:
            return db.execute('''
                SELECT r.*, i.label AS item_label FROM aveiro.reports r
                LEFT JOIN aveiro.items i ON i.id = r.item_id ORDER BY r.submitted_at DESC
            ''').fetchall()

    @api.patch('/reports/{report_id}/resolve', status_code=204)
    def resolve_report(report_id: UUID, user: Annotated[Principal, Depends(technician)]):
        with pool.connection() as db, db.transaction():
            db.execute("""UPDATE aveiro.reports SET status = 'resolved', resolved_by = %s, resolved_at = now()
                          WHERE id = %s AND status = 'open'""", (user.id, report_id))
            if not db.execute('SELECT id FROM aveiro.reports WHERE id = %s', (report_id,)).fetchone():
                raise HTTPException(404, 'Problema inexistente.')

    app.include_router(api, prefix='/api')
    app.include_router(api, include_in_schema=False)

    @app.api_route('/img/{filename}', methods=['GET', 'HEAD'], include_in_schema=False)
    def public_image(filename: str):
        try:
            image_id = UUID(filename.removesuffix('.jpg'))
        except ValueError as exc:
            raise HTTPException(404, 'Imagem inexistente.') from exc
        if filename != f'{image_id}.jpg':
            raise HTTPException(404, 'Imagem inexistente.')
        require_publication(image_id)
        photo = (public_dir / filename).resolve()
        if photo.parent != public_dir or not photo.is_file():
            raise HTTPException(404, 'Imagem inexistente.')
        return FileResponse(photo, media_type='image/jpeg', headers={
            'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff',
        })

    @app.api_route('/{path:path}', methods=['GET', 'HEAD'], include_in_schema=False)
    def frontend(path: str):
        namespace = path.partition('/')[0]
        if namespace in {'api', 'img', 'items', 'images', 'published', 'previews', 'reports', 'me'} or any(
            part.startswith('.') for part in Path(path).parts
        ):
            raise HTTPException(404)
        try:
            asset = (frontend_dir / path).resolve()
        except (OSError, ValueError) as exc:
            raise HTTPException(404) from exc
        if not asset.is_relative_to(frontend_dir) or any(
            asset.is_relative_to(data_folder) for data_folder in (private_dir, public_dir, models_dir)
        ):
            raise HTTPException(404)
        if asset.is_file():
            if asset.suffix.lower() in {'.js', '.mjs'}:
                return FileResponse(asset, media_type='text/javascript')
            return FileResponse(asset)
        if namespace == 'assets' or Path(path).suffix:
            raise HTTPException(404)
        index = (frontend_dir / 'index.html').resolve()
        if index.parent != frontend_dir or not index.is_file():
            raise HTTPException(503, 'Compila o frontend com npm run build em web/dot.')
        return FileResponse(index, headers={'Cache-Control': 'no-cache'})

    return app
