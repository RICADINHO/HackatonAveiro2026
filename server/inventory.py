from uuid import uuid4

from psycopg.types.json import Jsonb

from .imaging import projection

POINT = 'ST_SetSRID(ST_MakePoint(%s, %s), 4326)::geography'
ITEM_FIELDS = '''i.id, i.category, i.class_name, i.label, i.position_manually_corrected,
                 ST_Y(i.position::geometry) AS latitude, ST_X(i.position::geometry) AS longitude'''
IMAGE_FIELDS = '''im.id, im.file_path, im.camera_heading AS heading, im.uploader_name, im.submitted_at,
                  ST_Y(im.camera_position::geometry) AS latitude,
                  ST_X(im.camera_position::geometry) AS longitude'''


def lock_inventory(db):
    # Serialize the nearest-neighbor lookup and all writes that can move or remove its candidates.
    db.execute('SELECT pg_advisory_xact_lock(610305215)')


def list_items(db, category, classes):
    return db.execute(f'''
        SELECT {ITEM_FIELDS} FROM aveiro.items i
        WHERE (%s::text[] IS NULL OR i.category = ANY(%s))
          AND (%s::text[] IS NULL OR i.class_name = ANY(%s))
        ORDER BY i.label, i.id
    ''', (category, category, classes, classes)).fetchall()


def item_detail(db, item_id):
    item = db.execute(f'SELECT {ITEM_FIELDS} FROM aveiro.items i WHERE i.id = %s', (item_id,)).fetchone()
    if item is None:
        return None
    item['images'] = db.execute(f'''
        SELECT {IMAGE_FIELDS}, jsonb_agg(jsonb_build_object(
            'bbox', d.bbox, 'confidence', d.confidence, 'predicted_class', d.predicted_class,
            'latitude', ST_Y(d.estimated_position::geometry), 'longitude', ST_X(d.estimated_position::geometry)
        ) ORDER BY d.id) AS detections
        FROM aveiro.images im JOIN aveiro.detections d ON d.image_id = im.id
        WHERE d.item_id = %s GROUP BY im.id ORDER BY im.submitted_at DESC, im.id
    ''', (item_id,)).fetchall()
    return item


def update_item_position(db, item_id):
    db.execute('''
        UPDATE aveiro.items i SET position = observations.center::geography
        FROM (SELECT ST_Centroid(ST_Collect(estimated_position::geometry)) AS center
              FROM aveiro.detections WHERE item_id = %s) observations
        WHERE i.id = %s AND NOT i.position_manually_corrected AND observations.center IS NOT NULL
    ''', (item_id, item_id))


def record_image(db, image_id, principal, camera, detections, radius):
    db.execute(f'''
        INSERT INTO aveiro.images (id, file_path, camera_position, camera_heading, uploader_id, uploader_name)
        VALUES (%s, %s, {POINT}, %s, %s, %s)
    ''', (image_id, f'{image_id}.jpg', camera.longitude, camera.latitude, camera.heading,
          principal.id, principal.public_name))
    for detection in detections:
        distance, bearing = projection(camera.heading, detection['bbox'])
        estimate = db.execute(f'SELECT ST_Project({POINT}, %s, radians(%s)) AS point',
                              (camera.longitude, camera.latitude, distance, bearing)).fetchone()['point']
        nearest = db.execute('''
            SELECT id FROM aveiro.items WHERE class_name = %s
              AND ST_DWithin(position, %s::geography, %s)
            ORDER BY ST_Distance(position, %s::geography), id LIMIT 1
        ''', (detection['class_name'], estimate, radius, estimate)).fetchone()
        item_id = nearest['id'] if nearest else uuid4()
        if nearest is None:
            db.execute('''
                INSERT INTO aveiro.items (id, category, class_name, label, position)
                VALUES (%s, %s, %s, %s, %s::geography)
            ''', (item_id, detection['category'], detection['class_name'], detection['label'], estimate))
        db.execute('''
            INSERT INTO aveiro.detections (image_id, item_id, predicted_class, confidence, bbox, estimated_position)
            VALUES (%s, %s, %s, %s, %s, %s::geography)
        ''', (image_id, item_id, detection['class_name'], detection['confidence'],
              Jsonb(detection['bbox']), estimate))
        update_item_position(db, item_id)


def correct_camera(db, image_id, coordinates):
    lock_inventory(db)
    image = db.execute(f'''
        UPDATE aveiro.images SET camera_position = {POINT}, camera_heading = COALESCE(%s, camera_heading)
        WHERE id = %s RETURNING camera_heading
    ''', (coordinates.longitude, coordinates.latitude, coordinates.heading, image_id)).fetchone()
    if image is None:
        return False
    detections = db.execute('SELECT id, item_id, bbox FROM aveiro.detections WHERE image_id = %s',
                            (image_id,)).fetchall()
    for detection in detections:
        distance, bearing = projection(image['camera_heading'], detection['bbox'])
        db.execute(f'''
            UPDATE aveiro.detections SET estimated_position = ST_Project({POINT}, %s, radians(%s)) WHERE id = %s
        ''', (coordinates.longitude, coordinates.latitude, distance, bearing, detection['id']))
    for item_id in {detection['item_id'] for detection in detections}:
        update_item_position(db, item_id)
    return True


def delete_image(db, image_id):
    lock_inventory(db)
    items = db.execute('SELECT DISTINCT item_id FROM aveiro.detections WHERE image_id = %s',
                       (image_id,)).fetchall()
    deleted = db.execute('DELETE FROM aveiro.images WHERE id = %s RETURNING id', (image_id,)).fetchone()
    for item in items:
        update_item_position(db, item['item_id'])
    return deleted is not None
