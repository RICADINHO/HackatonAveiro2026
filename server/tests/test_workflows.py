import os
import unittest
from concurrent.futures import ThreadPoolExecutor
from io import BytesIO
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import Mock, patch
from uuid import uuid4

import cv2
import numpy as np
import psycopg
from fastapi.testclient import TestClient
from PIL import Image, ImageDraw
from PIL.TiffImagePlugin import IFDRational
from psycopg import sql
from psycopg.conninfo import make_conninfo

from server.app import Settings, create_app
from server.anonymization import AnonymizationError, anonymize
from server.imaging import Detection, classify_detections, detect, prepare_photo
from server.video import VideoInputError, read_video_samples


def write_video(path: Path, seconds: int):
    writer = cv2.VideoWriter(str(path), cv2.CAP_FFMPEG, cv2.VideoWriter_fourcc(*'mp4v'), 2, (160, 120))
    if not writer.isOpened():
        raise RuntimeError('Could not create test video.')
    try:
        for frame in range(seconds * 2):
            writer.write(np.full((120, 160, 3), (frame * 5, 0, 0), dtype=np.uint8))
    finally:
        writer.release()


class VideoSampling(unittest.TestCase):
    def test_decodes_at_most_four_distinct_samples(self):
        with TemporaryDirectory() as directory:
            path = Path(directory) / 'sample.mp4'
            write_video(path, seconds=12)
            with path.open('rb') as video:
                samples = read_video_samples(video, '.mp4')
            self.assertEqual([timestamp for timestamp, _ in samples], [0, 3000, 6000, 9000])
            self.assertTrue(all(frame.size == (160, 120) and frame.mode == 'RGB' for _, frame in samples))
            self.assertEqual(len({frame.getpixel((10, 10)) for _, frame in samples}), 4)

    def test_rejects_long_and_invalid_videos(self):
        with TemporaryDirectory() as directory:
            path = Path(directory) / 'long.mp4'
            write_video(path, seconds=21)
            with path.open('rb') as video, self.assertRaisesRegex(VideoInputError, '20 segundos'):
                read_video_samples(video, '.mp4')
        with self.assertRaises(VideoInputError):
            read_video_samples(BytesIO(b'not a video'), '.webm')


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
        with (
            TemporaryDirectory() as scratch,
            patch('server.imaging.detect', return_value=[]) as detector,
            patch('server.imaging.classify_detections', return_value=[]) as classifier,
            patch('server.imaging.anonymize', side_effect=lambda photo, _: photo.copy()) as redactor,
        ):
            destination = Path(scratch) / 'processed.jpg'
            pipeline = Mock()
            pipeline.attach_mock(detector, 'detect')
            pipeline.attach_mock(classifier, 'classify')
            pipeline.attach_mock(redactor, 'anonymize')
            camera, detections = prepare_photo(source.getvalue(), destination, Path(scratch))
            self.assertEqual([call[0] for call in pipeline.mock_calls], ['detect', 'classify', 'anonymize'])
            self.assertAlmostEqual(camera['latitude'], 40.6416666667)
            self.assertAlmostEqual(camera['longitude'], -8.65)
            self.assertEqual(camera['heading'], 0)
            self.assertEqual(detections, [])
            with Image.open(destination) as processed:
                self.assertFalse(processed.getexif())


class YoloDetection(unittest.TestCase):
    def test_maps_classes_and_converts_boxes_to_top_left_coordinates(self):
        import numpy as np
        import torch
        from ultralytics.engine.results import Results

        image = Image.new('RGB', (128, 64))
        prediction = Results(np.asarray(image), path='test.jpg',
                             names={0: 'trash_container', 1: 'light_pole', 2: 'street_sign'},
                             boxes=torch.tensor([[16, 16, 48, 32, 0.75, 0],
                                                 [64, 0, 80, 48, 0.875, 1],
                                                 [96, 8, 128, 24, 0.5, 2]]))
        with patch('server.imaging._load_detector') as load_detector:
            load_detector.return_value.predict.return_value = [prediction]
            self.assertEqual(detect(image), [
                Detection('residuos', 'contentor-lixo', 'Contentor de lixo', 0.75, (0.125, 0.25, 0.25, 0.25)),
                Detection('iluminacao', 'poste-iluminacao', 'Poste de iluminação', 0.875, (0.5, 0., 0.125, 0.75)),
                Detection('sinalizacao', 'sinal-transito', 'Sinal de trânsito', 0.5, (0.75, 0.125, 0.25, 0.25)),
            ])

    def test_remaps_tile_detections_and_suppresses_duplicates_within_each_category(self):
        import numpy as np
        import torch
        from ultralytics.engine.results import Results

        image = Image.new('RGB', (1440, 1152))
        names = {0: 'trash_container', 1: 'light_pole', 2: 'street_sign'}

        def prediction_for(source, rows):
            return Results(np.asarray(source), path='test.jpg', names=names,
                           boxes=torch.tensor(rows).reshape(-1, 6))

        def predict(source, **options):
            if source is image:
                return [prediction_for(source, [[800, 660, 840, 700, 0.5, 2]])]
            self.assertEqual(set(options['classes']), {0, 2})
            # Only the bottom-right crop contains the marked pixel.
            rows = [[80, 84, 120, 124, 0.75, 2], [300, 160, 340, 200, 0.625, 2],
                    [80, 84, 120, 124, 0.875, 0], [80, 84, 120, 124, 0.625, 0],
                    [690, 250, 720, 280, 0.9375, 0],
                    [0, 250, 18, 280, 0.875, 2]] if source.getpixel((700, 550)) == (255, 255, 255) else []
            return [prediction_for(source, rows)]

        image.putpixel((1420, 1126), (255, 255, 255))
        with patch('server.imaging._load_detector', return_value=Mock(names=names, predict=predict)):
            results = detect(image)
        self.assertEqual([(item.category, item.confidence, item.bbox) for item in results], [
            ('residuos', 0.875, (800 / 1440, 660 / 1152, 40 / 1440, 40 / 1152)),
            ('sinalizacao', 0.75, (800 / 1440, 660 / 1152, 40 / 1440, 40 / 1152)),
            ('sinalizacao', 0.625, (1020 / 1440, 736 / 1152, 40 / 1440, 40 / 1152)),
        ])

    def test_combines_optional_yoloe_with_primary_detections(self):
        import numpy as np
        import torch
        from ultralytics.engine.results import Results

        image = Image.new('RGB', (128, 64))
        primary = Results(np.asarray(image), path='test.jpg', names={0: 'street_sign', 1: 'light_pole'},
                          boxes=torch.tensor([[16, 8, 32, 24, 0.5, 0], [64, 0, 80, 48, 0.75, 1]]))
        supplemental = Results(np.asarray(image), path='test.jpg',
                               names={0: 'stop sign', 1: 'recycling container'},
                               boxes=torch.tensor([[16, 8, 32, 24, 0.875, 0], [96, 8, 128, 24, 0.625, 1]]))
        with (
            TemporaryDirectory() as scratch,
            patch('server.imaging._load_detector', return_value=Mock(predict=Mock(return_value=[primary]))),
            patch('server.imaging._load_yoloe', return_value=Mock(predict=Mock(return_value=[supplemental]))) as load,
        ):
            models = Path(scratch)
            self.assertEqual(len(detect(image, models)), 2)
            load.assert_not_called()
            weights = models / 'yoloe-26s-seg.pt'
            weights.touch()
            results = detect(image, models)
            load.assert_called_once_with(weights)
        self.assertEqual([(item.class_name, item.confidence) for item in results], [
            ('poste-iluminacao', 0.75), ('contentor-lixo', 0.625), ('sinal-transito', 0.875),
        ])


class Classification(unittest.TestCase):
    def test_maps_supported_subtypes_and_keeps_uncertain_detections_generic(self):
        image = Image.new('RGB', (100, 80))
        bbox = (0.2, 0.25, 0.3, 0.5)
        traffic_sign = Detection('sinalizacao', 'sinal-transito', 'Sinal de trânsito', 0.8, bbox)
        waste_bin = Detection('residuos', 'contentor-lixo', 'Contentor de lixo', 0.7, bbox)
        recycling_island = Detection('residuos', 'ilha-reciclagem', 'Ilha de reciclagem', 0.86, bbox)

        def prediction(class_name, confidence):
            return Mock(names={0: class_name}, probs=Mock(top1=0, top1conf=confidence))

        signs = Mock()
        signs.predict.return_value = [prediction('eu_dfg_regulatory_stop', 0.98),
                                      prediction('collect_organize_images', 0.99)]
        bins = Mock()
        bins.predict.return_value = [prediction('indiferenciado', 0.99),
                                     prediction('indiferenciado', 0.88)]
        models = {'classifier_sinais.pt': signs, 'classifier_lixos.pt': bins}
        with patch('server.imaging._load_classifier', side_effect=models.__getitem__):
            result = classify_detections(image, [traffic_sign, traffic_sign, waste_bin, waste_bin, recycling_island])
        self.assertEqual([d.class_name for d in result], [
            'stop', 'sinal-transito', 'indiferenciado', 'contentor-lixo', 'ilha-reciclagem',
        ])
        self.assertTrue(all(d.bbox == bbox for d in result))
        self.assertEqual(result[0].confidence, traffic_sign.confidence)
        self.assertEqual([crop.size for crop in signs.predict.call_args.args[0]], [(30, 40), (30, 40)])
        self.assertEqual(len(bins.predict.call_args.args[0]), 2)


class ImageAnonymization(unittest.TestCase):
    def test_redacts_both_types_of_regions(self):
        photo = Image.new('RGB', (120, 100), 'white')
        draw = ImageDraw.Draw(photo)
        draw.rectangle((0, 0, 18, 16), fill='black')
        draw.rectangle((70, 75, 95, 90), fill='black')
        with (
            patch('server.anonymization._load_model'),
            patch('server.anonymization._face_boxes', return_value=[(0, 0, 19, 17)]),
            patch('server.anonymization._plate_boxes', return_value=[(70, 75, 96, 91)]),
        ):
            redacted = anonymize(photo, Path('models'))
        self.assertEqual(redacted.size, photo.size)
        for point in ((9, 8), (83, 82)):
            self.assertNotEqual(redacted.getpixel(point), photo.getpixel(point))
        self.assertEqual(redacted.getpixel((50, 50)), photo.getpixel((50, 50)))


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

    def test_video_previews_are_private_and_publish_individually(self):
        user_id, other_id = uuid4(), uuid4()
        owners = {'Bearer owner': user_id, 'Bearer other': other_id}
        coordinates = {'latitude': 40.6405, 'longitude': -8.6538, 'heading': 90}
        owner_headers = {'Authorization': 'Bearer owner'}
        other_headers = {'Authorization': 'Bearer other'}
        detected = Detection('sinalizacao', 'stop', 'Sinal de STOP', 0.9, (0.1, 0.2, 0.3, 0.4))

        def fake_auth(_url, *, headers, **_kwargs):
            identity = owners[headers['Authorization']]
            return Mock(status_code=200, json=lambda: {'role': 'authenticated', 'id': str(identity)})

        with TemporaryDirectory() as directory:
            root = Path(directory)
            media = root / 'source.mp4'
            write_video(media, seconds=4)
            files = {'video': ('source.mp4', media.read_bytes(), 'video/mp4')}
            settings = Settings(self.dsn, 'https://test.supabase.co', 'test-key', root)
            with (
                patch('server.app.requests.get', side_effect=fake_auth),
                patch('server.imaging.detect', return_value=[detected]),
                patch('server.imaging.anonymize', side_effect=[Image.new('RGB', (160, 120)), AnonymizationError]),
                TestClient(create_app(settings)) as client,
            ):
                self.assertEqual(client.post('/api/video-previews', files=files).status_code, 401)
                self.assertEqual(client.post('/api/video-previews', headers=owner_headers, files=files).status_code, 503)
                self.assertEqual(list((root / 'images/private').glob('*')), [])

                with patch('server.imaging.anonymize', side_effect=lambda frame, _: Image.new('RGB', frame.size, 'white')):
                    result = client.post('/api/video-previews', headers=owner_headers, files=files)
                self.assertEqual(result.status_code, 201, result.text)
                first, second = result.json()['frames']
                self.assertEqual([first['timestamp_ms'], second['timestamp_ms']], [0, 2000])
                self.assertEqual(first['camera'], dict.fromkeys(coordinates))
                self.assertEqual(second['camera'], dict.fromkeys(coordinates))
                self.assertEqual(first['detections'][0]['class_name'], 'stop')
                first_path = f"/api/previews/{first['id']}"
                second_path = f"/api/previews/{second['id']}"
                private_path = first_path + '/image'
                self.assertEqual(client.get(private_path, headers=other_headers).status_code, 404)
                preview = client.get(private_path, headers=owner_headers)
                self.assertEqual(preview.status_code, 200)
                with Image.open(BytesIO(preview.content)) as staged:
                    self.assertEqual(staged.format, 'JPEG')
                    self.assertEqual(staged.getpixel((10, 10)), (255, 255, 255))
                self.assertEqual(client.post(first_path + '/publish', headers=owner_headers, json={}).status_code, 422)
                self.assertEqual(client.post(first_path + '/publish', headers=owner_headers, json=coordinates).status_code, 200)
                self.assertEqual(client.get(f"/img/{first['id']}.jpg").content, preview.content)
                self.assertEqual(client.get(second_path + '/image', headers=owner_headers).status_code, 200)
                self.assertEqual(client.get(f"/img/{second['id']}.jpg").status_code, 404)

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
        detections = [
            Detection('sinalizacao', 'stop', 'Stop', 0.87, (0.10, 0.30, 0.14, 0.22)),
            Detection('iluminacao', 'poste-iluminacao', 'Poste de iluminação', 0.81, (0.42, 0.15, 0.10, 0.52)),
            Detection('residuos', 'indiferenciado', 'Contentor de indiferenciados', 0.78, (0.66, 0.53, 0.22, 0.25)),
        ]

        with TemporaryDirectory() as scratch:
            root = Path(scratch)
            frontend = root / 'dist'
            (frontend / 'assets').mkdir(parents=True)
            (frontend / 'index.html').write_text('<html><title>Aveiro SPA</title></html>', encoding='utf-8')
            (frontend / 'assets' / 'app.js').write_text('console.log("Aveiro")', encoding='utf-8')
            settings = Settings(self.dsn, 'https://test.supabase.co', 'test-key', root,
                                cors_origins=('https://ricadinho.github.io',), frontend_dir=frontend)
            with (
                patch('server.app.requests.get', side_effect=fake_auth),
                patch('server.imaging.detect', return_value=detections),
                patch('server.anonymization._load_model'),
                patch('server.anonymization._face_boxes', return_value=[]),
                patch('server.anonymization._plate_boxes', return_value=[(40, 160, 101, 201)]),
                TestClient(create_app(settings)) as client,
            ):
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
                with patch('server.imaging.anonymize', side_effect=AnonymizationError):
                    self.assertEqual(client.post('/previews', headers=auth('member'), files=files).status_code, 503)
                self.assertEqual(list((root / 'images' / 'private').iterdir()), [])

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
