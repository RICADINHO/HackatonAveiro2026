from dataclasses import asdict, dataclass
from functools import cache
from io import BytesIO
from pathlib import Path
from threading import Lock

from PIL import ExifTags, Image, ImageOps

from .anonymization import anonymize

MAX_IMAGE_BYTES = 12 * 1024 * 1024
Image.MAX_IMAGE_PIXELS = 25_000_000

DETECTOR_PATH = Path(__file__).resolve().parents[1] / 'yolo' / 'detector_3classes.pt'
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


def detect(image: Image.Image) -> list[Detection]:
    """Detect items using normalized top-left boxes."""
    try:
        # YOLO shares mutable predictor state across calls, including its first setup.
        with _detector_lock:
            result, = _load_detector().predict(image, imgsz=768, device='cpu', verbose=False, save=False)
    except Exception as exc:
        raise DetectorError('Falhou a execução do detetor YOLO.') from exc

    boxes = result.boxes.cpu()
    detections = []
    for coords, class_id, confidence in zip(boxes.xyxyn.tolist(), boxes.cls.int().tolist(),
                                            boxes.conf.tolist(), strict=True):
        left, top, right, bottom = coords
        if right > left and bottom > top:
            category, class_name, label = DETECTOR_CLASSES[result.names[class_id]]
            detections.append(Detection(category, class_name, label, confidence,
                                        (left, top, right - left, bottom - top)))
    return detections


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
