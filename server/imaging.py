from dataclasses import asdict, dataclass
from functools import cache
from io import BytesIO
from math import ceil
from pathlib import Path
from threading import Lock

import cv2
from PIL import ExifTags, Image, ImageOps

from .anonymization import anonymize

MAX_IMAGE_BYTES = 12 * 1024 * 1024
Image.MAX_IMAGE_PIXELS = 25_000_000

DETECTOR_PATH = Path(__file__).resolve().parents[1] / 'yolo' / 'detector_3classes.pt'
DETECTOR_INPUT_SIZE = 768
SIGN_TILE_SIZE = (720, 576)
SIGN_TILE_OVERLAP = 0.20
DETECTOR_CLASSES = {
    'trash_container': ('residuos', 'contentor-lixo', 'Contentor de lixo'),
    'light_pole': ('iluminacao', 'poste-iluminacao', 'Poste de iluminação'),
    'street_sign': ('sinalizacao', 'sinal-transito', 'Sinal de trânsito'),
}
_detector_lock = Lock()


class DetectorError(RuntimeError):
    """The detector could not process the image."""


@dataclass(frozen=True)
class Detection:
    category: str
    class_name: str
    label: str
    confidence: float
    bbox: tuple[float, float, float, float]


@cache
def _load_detector():
    if not DETECTOR_PATH.is_file():
        raise FileNotFoundError(DETECTOR_PATH)

    from ultralytics import YOLO

    model = YOLO(DETECTOR_PATH, task='detect')
    if set(model.names.values()) != DETECTOR_CLASSES.keys():
        raise ValueError(f'Classes inesperadas no detetor: {model.names}')
    return model


def _read_detections(result, image_size, origin=(0, 0)) -> list[Detection]:
    width, height = image_size
    x, y = origin
    tile_height, tile_width = result.orig_shape
    boxes = result.boxes.cpu()
    detections = []
    for coords, class_id, confidence in zip(boxes.xyxy.tolist(), boxes.cls.int().tolist(),
                                            boxes.conf.tolist(), strict=True):
        left, top, right, bottom = coords
        if right <= left or bottom <= top:
            continue
        # A box cut by a tile boundary can be detected whole in the overlapping tile.
        if ((x > 0 and left <= 1) or (x + tile_width < width and right >= tile_width - 1)
                or (y > 0 and top <= 1) or (y + tile_height < height and bottom >= tile_height - 1)):
            continue
        category, class_name, label = DETECTOR_CLASSES[result.names[class_id]]
        detections.append(Detection(category, class_name, label, confidence,
                                    ((x + left) / width, (y + top) / height,
                                     (right - left) / width, (bottom - top) / height)))
    return detections


def _tile_origins(length: int, size: int) -> list[int]:
    last = length - size
    if last == 0:
        return [0]
    # Spread tiles evenly so both image edges are covered without a nearly duplicate final tile.
    steps = ceil(last / (size * (1 - SIGN_TILE_OVERLAP)))
    return [round(last * step / steps) for step in range(steps + 1)]


def detect(image: Image.Image) -> list[Detection]:
    """Detect furniture in the full image and look for small signs in overlapping tiles."""
    options = dict(imgsz=DETECTOR_INPUT_SIZE, conf=0.25, device='cpu', verbose=False, save=False)
    try:
        # YOLO shares mutable predictor state across calls, including its first setup.
        with _detector_lock:
            model = _load_detector()
            result, = model.predict(image, **options)
            detections = _read_detections(result, image.size)
            if max(image.size) <= DETECTOR_INPUT_SIZE:
                return detections

            sign_class = next(class_id for class_id, name in model.names.items() if name == 'street_sign')
            tile_width = min(image.width, SIGN_TILE_SIZE[0])
            tile_height = min(image.height, SIGN_TILE_SIZE[1])
            tiled_signs = []
            for y in _tile_origins(image.height, tile_height):
                for x in _tile_origins(image.width, tile_width):
                    crop = image.crop((x, y, x + tile_width, y + tile_height))
                    tile, = model.predict(crop, classes=[sign_class], **options)
                    tiled_signs.extend(_read_detections(tile, image.size, (x, y)))
    except Exception as exc:
        raise DetectorError('Falhou a execução do detetor YOLO.') from exc

    if not tiled_signs:
        return detections
    signs = [detection for detection in detections if detection.category == 'sinalizacao'] + tiled_signs
    keep = cv2.dnn.NMSBoxes([detection.bbox for detection in signs],
                            [detection.confidence for detection in signs], 0.0, 0.45)
    return [detection for detection in detections if detection.category != 'sinalizacao'] + [
        signs[int(index)] for index in keep
    ]


def gps_coordinate(value, reference, positive, negative, limit):
    try:
        if isinstance(reference, bytes):
            reference = reference.decode('ascii')
        degrees, minutes, seconds = map(float, value)
        coordinate = degrees + minutes / 60 + seconds / 3600
        if reference in (positive, negative) and 0 <= coordinate <= limit:
            return -coordinate if reference == negative else coordinate
    except (TypeError, ValueError, ZeroDivisionError):
        pass
    return None


def read_camera(image):
    try:
        gps = image.getexif().get_ifd(ExifTags.IFD.GPSInfo)
    except (ValueError, TypeError, OSError, SyntaxError, IndexError, KeyError):
        gps = {}
    try:
        heading = float(gps.get(17))  # GPSImgDirection, as opposed to GPSTrack
        # Magnetic headings need correction before use with geographic bearings.
        if not 0 <= heading < 360 or gps.get(16) not in ('T', b'T'):
            heading = None
    except (ValueError, TypeError, ZeroDivisionError):
        heading = None
    return {
        'latitude': gps_coordinate(gps.get(2), gps.get(1), 'N', 'S', 90),
        'longitude': gps_coordinate(gps.get(4), gps.get(3), 'E', 'W', 180),
        'heading': heading,
    }


def prepare_photo(contents: bytes, destination: Path, models_dir: Path):
    with Image.open(BytesIO(contents), formats=['JPEG', 'PNG', 'WEBP']) as original:
        if original.width * original.height > Image.MAX_IMAGE_PIXELS:
            raise Image.DecompressionBombError('Image exceeds pixel limit')
        if getattr(original, 'is_animated', False):
            raise ValueError('Animated image')
        camera = read_camera(original)
        photo = ImageOps.exif_transpose(original).convert('RGB')
    photo.thumbnail((1920, 1920))
    detections = [asdict(detection) for detection in detect(photo)]
    redacted = anonymize(photo, models_dir)
    # An explicit re-encode leaves out the source EXIF, ICC and embedded thumbnails.
    redacted.info.clear()
    with destination.open('xb') as output:
        redacted.save(output, format='JPEG', quality=88)
    return camera, detections


def projection(heading, bbox):
    x, _, width, height = bbox
    bearing = (heading + (x + width / 2 - 0.5) * 65) % 360
    distance = max(4, min(60, 5 / max(height, 0.01)))
    return distance, bearing
