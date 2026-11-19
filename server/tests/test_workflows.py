import os
import unittest
from concurrent.futures import ThreadPoolExecutor
from io import BytesIO
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import Mock, patch
from uuid import uuid4

import psycopg
from fastapi.testclient import TestClient
from PIL import Image, ImageDraw
from PIL.TiffImagePlugin import IFDRational
from psycopg import sql
from psycopg.conninfo import make_conninfo

from server.app import Settings, create_app
from server.app.__main__ import checked_host
from server.imaging import prepare_photo


class CameraMetadata(unittest.TestCase):
    def test_extracts_exif_and_removes_it_from_output(self):
        exif = Image.Exif()
        exif[34853] = {
            1: 'N', 2: (IFDRational(40), IFDRational(38), IFDRational(30)),
            3: 'W', 4: (IFDRational(8), IFDRational(39), IFDRational(0)),
            16: 'T', 17: IFDRational(0),
        }
        source = BytesIO()
        Image.new('RGB', (320, 240)).save(source, format='JPEG', exif=exif)
        with TemporaryDirectory() as scratch:
            destination = Path(scratch) / 'processed.jpg'
            camera, detections = prepare_photo(source.getvalue(), destination)
            self.assertAlmostEqual(camera['latitude'], 40.6416666667)
            self.assertAlmostEqual(camera['longitude'], -8.65)
            self.assertEqual(camera['heading'], 0)
            self.assertEqual(len(detections), 3)
            with Image.open(destination) as processed:
                self.assertFalse(processed.getexif())


class LocalBind(unittest.TestCase):
    def test_placeholder_requires_explicit_opt_in_for_non_loopback(self):
        with patch.dict(os.environ, {'ALLOW_PLACEHOLDER_PUBLIC': '0'}):
            self.assertEqual(checked_host('localhost'), '127.0.0.1')
            self.assertEqual(checked_host('::1'), '::1')
            for host in ('0.0.0.0', '::', '192.168.0.1'):
                with self.assertRaises(ValueError):
                    checked_host(host)
        with patch.dict(os.environ, {'ALLOW_PLACEHOLDER_PUBLIC': '1'}):
            self.assertEqual(checked_host('0.0.0.0'), '0.0.0.0')


@unittest.skipUnless(os.getenv('AVEIRO_TEST_DATABASE_URL'), 'PostGIS test connection not configured')
class InventoryWorkflow(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        admin = psycopg.connect(os.environ['AVEIRO_TEST_DATABASE_URL'], autocommit=True)
        cls.addClassCleanup(admin.close)
        database = 'aveiro_test_' + uuid4().hex
        admin.execute(sql.SQL('CREATE DATABASE {}').format(sql.Identifier(database)))
        cls.addClassCleanup(admin.execute, sql.SQL('DROP DATABASE {}').format(sql.Identifier(database)))
        cls.dsn = make_conninfo(os.environ['AVEIRO_TEST_DATABASE_URL'], dbname=database)
        migrate = (Path(__file__).resolve().parents[1] / 'migrations' / '001_inventory.sql').read_text(encoding='utf-8')
        with psycopg.connect(cls.dsn, autocommit=True) as db:
            db.execute('CREATE TABLE public.existing_data (content text)')
            db.execute("INSERT INTO public.existing_data VALUES ('keep')")
            db.execute(migrate)
            db.execute(migrate)
            assert db.execute('SELECT content FROM public.existing_data').fetchone() == ('keep',)

    def test_inventory_workflow(self):
        owner, technician, other = uuid4(), uuid4(), uuid4()
        users = {
            'member': {'id': str(owner), 'app_metadata': {},
                       'user_metadata': {'role': 'technician', 'public_name': 'Conta de teste'}},
            'tech': {'id': str(technician), 'app_metadata': {'role': 'technician'}},
            'other': {'id': str(other), 'app_metadata': {}},
        }

        def fake_auth(url, *, headers, **_kwargs):
            self.assertEqual(url, 'https://test.supabase.co/auth/v1/user')
            self.assertEqual(headers['apikey'], 'test-key')
            user = users.get(headers['Authorization'].removeprefix('Bearer '))
            return Mock(status_code=200 if user else 401, json=lambda: {'role': 'authenticated', **user})

        def auth(token):
            return {'Authorization': f'Bearer {token}'}

        source = Image.new('RGB', (320, 240), 'white')
        ImageDraw.Draw(source).rectangle((40, 160, 100, 200), fill='black')
        exif = Image.Exif()
        exif[305] = 'PRIVATE_SOURCE_METADATA'
        image_file = BytesIO()
        source.save(image_file, format='PNG', exif=exif)
        files = {'image': ('test.png', image_file.getvalue(), 'image/png')}
        camera = {'latitude': 40.6405, 'longitude': -8.6538, 'heading': 0}

        with TemporaryDirectory() as scratch:
            root = Path(scratch)
            frontend = root / 'dist'
            (frontend / 'assets').mkdir(parents=True)
            (frontend / 'index.html').write_text('<html><title>Aveiro SPA</title></html>', encoding='utf-8')
            (frontend / 'assets' / 'app.js').write_text('console.log("Aveiro")', encoding='utf-8')
            settings = Settings(self.dsn, 'https://test.supabase.co', 'test-key', root,
                                cors_origins=('https://ricadinho.github.io',), frontend_dir=frontend)
            with patch('server.app.requests.get', side_effect=fake_auth), TestClient(create_app(settings)) as client:
                self.assertIn('Aveiro SPA', client.get('/').text)
                self.assertIn('Aveiro SPA', client.get('/mapa/aveiro').text)
                self.assertIn('console.log', client.get('/assets/app.js').text)
                for missing in ('/api/unknown', '/img/private/test.jpg', '/assets/missing.js', '/.env'):
                    self.assertEqual(client.get(missing).status_code, 404, missing)
                self.assertTrue((root / 'models').is_dir())
                self.assertEqual(client.get('/api/items').json(), [])
                self.assertEqual(client.get('/items').json(), [])
                cors = client.get('/items', headers={'Origin': 'https://ricadinho.github.io'})
                self.assertEqual(cors.headers['access-control-allow-origin'], 'https://ricadinho.github.io')
                self.assertEqual(client.get('/me', headers=auth('invalid')).status_code, 401)
                self.assertEqual(client.get('/me', headers=auth('member')).json()['role'], 'authenticated')
                self.assertEqual(client.post('/previews', files=files).status_code, 401)
                self.assertEqual(client.post('/previews', files={'image': ('broken.jpg', b'invalid')},
                                             headers=auth('member')).status_code, 422)

                def prepare():
                    response = client.post('/previews', headers=auth('member'), files=files)
                    self.assertEqual(response.status_code, 201, response.text)
                    staged = response.json()
                    self.assertEqual(staged['camera'], dict.fromkeys(camera))
                    self.assertEqual(len(staged['detections']), 3)
                    return staged['id']

                first, second = prepare(), prepare()
                image_path = f'/api/previews/{first}/image'
                public_photo = f'/img/{first}.jpg'
                self.assertEqual(client.get(image_path).status_code, 401)
                self.assertEqual(client.get(image_path, headers=auth('other')).status_code, 404)
                self.assertEqual(client.get(image_path, headers=auth('tech')).status_code, 404)
                preview = client.get(image_path, headers=auth('member'))
                self.assertEqual(preview.status_code, 200)
                self.assertEqual(preview.headers['cache-control'], 'private, no-store')
                with Image.open(BytesIO(preview.content)) as processed:
                    self.assertFalse(processed.getexif())
                    self.assertGreater(processed.getpixel((48, 170))[0], 0)
                self.assertEqual(client.get(f'/published/{first}').status_code, 404)
                self.assertEqual(client.get(public_photo).status_code, 404)
                self.assertEqual(client.post(f'/previews/{first}/publish', json=camera,
                                             headers=auth('other')).status_code, 404)
                self.assertEqual(client.post(f'/previews/{first}/publish', json={},
                                             headers=auth('member')).status_code, 422)

                def publish(preview_id, coordinates):
                    response = client.post(f'/api/previews/{preview_id}/publish', json=coordinates, headers=auth('member'))
                    self.assertEqual(response.status_code, 200, response.text)
                    self.assertEqual(response.json(), {'id': preview_id})

                with ThreadPoolExecutor(2) as executor:
                    writes = [executor.submit(publish, first, camera),
                              executor.submit(publish, second, camera | {'latitude': 40.6406})]
                    for write in writes:
                        write.result()
                publish(first, camera)
                self.assertEqual(client.get(image_path, headers=auth('member')).status_code, 404)
                self.assertEqual(client.get(f'/published/{first}').status_code, 204)
                photo = client.get(public_photo)
                self.assertEqual(photo.headers['content-type'], 'image/jpeg')
                self.assertEqual(photo.content, preview.content)
                self.assertEqual(client.head(public_photo).status_code, 200)
                self.assertEqual((root / 'images' / 'public' / f'{first}.jpg').read_bytes(), preview.content)

                self.assertEqual(len(client.get('/items').json()), 3)
                for category in ('sinalizacao', 'iluminacao', 'residuos'):
                    self.assertEqual(len(client.get('/items', params={'category': category}).json()), 1)
                stop, = client.get('/items', params={'class_name': 'stop'}).json()
                stop_path = f"/items/{stop['id']}"
                details = client.get(stop_path).json()
                self.assertEqual({image['id'] for image in details['images']}, {first, second})
                self.assertIn(public_photo, {image['url'] for image in details['images']})
                self.assertEqual(details['images'][0]['uploader_name'], 'Conta de teste')
                self.assertNotEqual(details['images'][0]['detections'][0]['latitude'], details['images'][0]['latitude'])
                estimated = [image['detections'][0]['latitude'] for image in details['images']]
                self.assertAlmostEqual(sum(estimated) / 2, details['latitude'], places=10)

                update = {'label': 'STOP corrigido', 'latitude': 40.6407, 'longitude': -8.6538}
                self.assertEqual(client.patch(stop_path, json=update).status_code, 401)
                self.assertEqual(client.patch(stop_path, headers=auth('member'), json=update).status_code, 403)
                self.assertEqual(client.delete(stop_path, headers=auth('member')).status_code, 403)
                self.assertEqual(client.patch(f'/images/{first}', headers=auth('member'), json=camera).status_code, 403)
                self.assertEqual(client.delete(f'/images/{first}', headers=auth('member')).status_code, 403)
                self.assertEqual(client.patch(stop_path, headers=auth('tech'), json=update).status_code, 204)
                self.assertEqual(client.patch(f'/images/{first}', headers=auth('tech'),
                                              json=camera | {'latitude': 40.6408}).status_code, 204)
                corrected = client.get(stop_path).json()
                self.assertTrue(corrected['position_manually_corrected'])
                self.assertAlmostEqual(corrected['latitude'], update['latitude'], places=10)
                self.assertEqual(corrected['label'], update['label'])

                report = client.post('/reports', headers=auth('member'),
                                     json={'description': 'Má deteção', 'item_id': stop['id']})
                self.assertEqual(report.status_code, 201, report.text)
                self.assertEqual(client.get('/reports', headers=auth('member')).status_code, 403)
                report_path = f"/reports/{report.json()['id']}/resolve"
                self.assertEqual(client.patch(report_path, headers=auth('member')).status_code, 403)
                self.assertEqual(client.patch(report_path, headers=auth('tech')).status_code, 204)
                recorded, = client.get('/reports', headers=auth('tech')).json()
                self.assertEqual(recorded['status'], 'resolved')
                self.assertEqual(recorded['author_id'], str(owner))
                self.assertEqual(recorded['resolved_by'], str(technician))
                self.assertIsNotNone(recorded['resolved_at'])

                self.assertEqual(client.delete(stop_path, headers=auth('tech')).status_code, 204)
                self.assertIsNone(client.get('/reports', headers=auth('tech')).json()[0]['item_id'])
                self.assertEqual(client.delete(f'/images/{first}', headers=auth('tech')).status_code, 204)
                self.assertEqual(client.get(f'/published/{first}').status_code, 404)
                self.assertEqual(client.get(public_photo).status_code, 404)
                self.assertFalse((root / 'images' / 'public' / f'{first}.jpg').exists())
