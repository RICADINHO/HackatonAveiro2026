from dataclasses import asdict, dataclass
from io import BytesIO
from pathlib import Path

from PIL import ExifTags, Image, ImageFilter, ImageOps

MAX_IMAGE_BYTES = 12 * 1024 * 1024
Image.MAX_IMAGE_PIXELS = 25_000_000


@dataclass(frozen=True)
class Detection:
    category: str
    class_name: str
    label: str
    confidence: float
    bbox: tuple[float, float, float, float]


def anonymize(image: Image.Image) -> Image.Image:
    """Placeholder. Replace with face and number plate localization and blurring."""
    width, height = image.size
    region = (0, height // 2, width, height)
    blurred = image.crop(region).filter(ImageFilter.GaussianBlur(max(12, min(image.size) / 16)))
    output = image.copy()
    output.paste(blurred, region)
    return output


def detect(image: Image.Image) -> list[Detection]:
    """Placeholder. A real detector receives the anonymized image and returns normalized boxes."""
    return [
        Detection('sinalizacao', 'stop', 'Stop', 0.87, (0.10, 0.30, 0.14, 0.22)),
        Detection('iluminacao', 'poste-iluminacao', 'Poste de iluminação', 0.81, (0.42, 0.15, 0.10, 0.52)),
        Detection('residuos', 'indiferenciado', 'Contentor de indiferenciados', 0.78, (0.66, 0.53, 0.22, 0.25)),
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


def prepare_photo(contents: bytes, destination: Path):
    with Image.open(BytesIO(contents), formats=['JPEG', 'PNG', 'WEBP']) as original:
        if original.width * original.height > Image.MAX_IMAGE_PIXELS:
            raise Image.DecompressionBombError('Image exceeds pixel limit')
        if getattr(original, 'is_animated', False):
            raise ValueError('Animated image')
        camera = read_camera(original)
        photo = ImageOps.exif_transpose(original).convert('RGB')
    photo.thumbnail((1920, 1920))
    redacted = anonymize(photo)
    detections = [asdict(detection) for detection in detect(redacted)]
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
