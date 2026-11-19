import logging
from dataclasses import asdict, dataclass, replace
from functools import cache
from io import BytesIO
from math import ceil
from pathlib import Path
from threading import Lock

import cv2
from PIL import ExifTags, Image, ImageOps

from .anonymization import anonymize

logger = logging.getLogger(__name__)

MAX_IMAGE_BYTES = 12 * 1024 * 1024
Image.MAX_IMAGE_PIXELS = 25_000_000

DETECTOR_PATH = Path(__file__).resolve().parents[1] / 'yolo' / 'detector_3classes.pt'
YOLOE_WEIGHTS = 'yoloe-26s-seg.pt'
YOLOE_PROMPTS = DETECTOR_PATH.with_name('yoloe-26s-prompts.npz')
DETECTOR_INPUT_SIZE = 768
TILE_SIZE = (720, 576)
TILE_OVERLAP = 0.20
TILE_MODEL_CLASSES = {'street_sign', 'trash_container'}
DETECTOR_CLASSES = {
    'trash_container': ('residuos', 'contentor-lixo', 'Contentor de lixo'),
    'light_pole': ('iluminacao', 'poste-iluminacao', 'Poste de iluminação'),
    'street_sign': ('sinalizacao', 'sinal-transito', 'Sinal de trânsito'),
}
RECYCLING_ISLAND = ('residuos', 'ilha-reciclagem', 'Ilha de reciclagem')
YOLOE_CLASSES = {
    'traffic sign': DETECTOR_CLASSES['street_sign'],
    'stop sign': DETECTOR_CLASSES['street_sign'],
    'pedestrian crossing sign': DETECTOR_CLASSES['street_sign'],
    'recycling container': DETECTOR_CLASSES['trash_container'],
    'garbage dumpster': DETECTOR_CLASSES['trash_container'],
    'blue green and yellow recycling containers': RECYCLING_ISLAND,
}
SIGN_SUBTYPES = {
    'stop': ('stop', 'Sinal de STOP'),
    'eu_dfg_regulatory_stop': ('stop', 'Sinal de STOP'),
    'crosswalk': ('passadeira', 'Passagem para peões'),
    'give_way': ('cedencia', 'Cedência de passagem'),
    'eu_dfg_regulatory_yield': ('cedencia', 'Cedência de passagem'),
    'no_entry': ('sentido-proibido', 'Sentido proibido'),
    'eu_dfg_regulatory_no_entry': ('sentido-proibido', 'Sentido proibido'),
    'parking': ('estacionamento', 'Estacionamento'),
    'eu_dfg_information_parking': ('estacionamento', 'Estacionamento'),
    'eu_dfg_regulatory_no_parking': ('estacionamento-proibido', 'Estacionamento proibido'),
    'roundabout_mandatory': ('rotunda', 'Rotunda'),
    'eu_dfg_regulatory_roundabout': ('rotunda', 'Rotunda'),
    'road_work': ('obras', 'Trabalhos na via'),
    'eu_dfg_warning_roadworks': ('obras', 'Trabalhos na via'),
    'hiz_siniri_50': ('velocidade-50', 'Limite de 50 km/h'),
    **{f'speed_limit_{speed}': (f'velocidade-{speed}', f'Limite de {speed} km/h')
       for speed in (20, 30, 50, 60, 70, 80, 100, 120)},
}
WASTE_SUBTYPES = {
    'ilha_de_reciclagem': RECYCLING_ISLAND[1:],
    'indiferenciado': ('indiferenciado', 'Contentor de indiferenciados'),
    'subterraneo': ('subterraneo', 'Contentor subterrâneo'),
}
CLASSIFIERS = {
    'sinal-transito': ('classifier_sinais.pt', 0.70, SIGN_SUBTYPES),
    'contentor-lixo': ('classifier_lixos.pt', 0.95, WASTE_SUBTYPES),
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


@cache
def _load_yoloe(weights: Path):
    from ultralytics import YOLOE

    model = YOLOE(weights)
    model.load_prompt_embeddings(YOLOE_PROMPTS)
    if set(model.names.values()) != YOLOE_CLASSES.keys():
        raise ValueError(f'Classes inesperadas no YOLOE: {model.names}')
    return model


@cache
def _load_classifier(filename: str):
    from ultralytics import YOLO

    weights = DETECTOR_PATH.with_name(filename)
    if not weights.is_file():
        raise FileNotFoundError(weights)
    return YOLO(weights, task='classify')


def _read_detections(result, image_size, origin=(0, 0), classes=DETECTOR_CLASSES) -> list[Detection]:
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
        category, class_name, label = classes[result.names[class_id]]
        if class_name == 'ilha-reciclagem' and confidence < 0.75:
            category, class_name, label = DETECTOR_CLASSES['trash_container']
        # Cropped fences and walls at the photo edge can look like containers.
        if (category == 'residuos' and (tile_width, tile_height) != image_size
                and (left <= 1 or top <= 1 or right >= tile_width - 1 or bottom >= tile_height - 1)):
            continue
        detections.append(Detection(category, class_name, label, confidence,
                                    ((x + left) / width, (y + top) / height,
                                     (right - left) / width, (bottom - top) / height)))
    return detections


def _tile_origins(length: int, size: int) -> list[int]:
    last = length - size
    if last == 0:
        return [0]
    # Spread tiles evenly so both image edges are covered without a nearly duplicate final tile.
    steps = ceil(last / (size * (1 - TILE_OVERLAP)))
    return [round(last * step / steps) for step in range(steps + 1)]


def detect(image: Image.Image, models_dir: Path | None = None) -> list[Detection]:
    """Combine full-image detections, overlapping tiles and optional YOLOE detections."""
    options = dict(imgsz=DETECTOR_INPUT_SIZE, conf=0.25, device='cpu', verbose=False, save=False)
    additional = []
    try:
        # YOLO shares mutable predictor state across calls, including its first setup.
        with _detector_lock:
            model = _load_detector()
            result, = model.predict(image, **options)
            detections = _read_detections(result, image.size)
            if max(image.size) > DETECTOR_INPUT_SIZE:
                tile_classes = [class_id for class_id, name in model.names.items() if name in TILE_MODEL_CLASSES]
                tile_width = min(image.width, TILE_SIZE[0])
                tile_height = min(image.height, TILE_SIZE[1])
                for y in _tile_origins(image.height, tile_height):
                    for x in _tile_origins(image.width, tile_width):
                        crop = image.crop((x, y, x + tile_width, y + tile_height))
                        tile, = model.predict(crop, classes=tile_classes, **options)
                        additional.extend(_read_detections(tile, image.size, (x, y)))
            if models_dir is not None:
                weights = models_dir / YOLOE_WEIGHTS
                if weights.is_file():
                    result, = _load_yoloe(weights).predict(image, **options)
                    additional.extend(_read_detections(result, image.size, classes=YOLOE_CLASSES))
    except Exception as exc:
        raise DetectorError('Falhou a execução do detetor YOLO.') from exc

    for category in sorted({detection.category for detection in additional}):
        candidates = [detection for detection in detections + additional if detection.category == category]
        keep = cv2.dnn.NMSBoxes([detection.bbox for detection in candidates],
                                [detection.confidence for detection in candidates], 0.0, 0.45)
        detections = [detection for detection in detections if detection.category != category]
        detections.extend(candidates[int(index)] for index in keep)
    return detections


def classify_detections(image: Image.Image, detections: list[Detection]) -> list[Detection]:
    classified = detections.copy()
    for generic, (filename, threshold, subtypes) in CLASSIFIERS.items():
        indexes = []
        crops = []
        for index, detection in enumerate(detections):
            if detection.class_name != generic:
                continue
            x, y, width, height = detection.bbox
            left, top = max(0, round(x * image.width)), max(0, round(y * image.height))
            right = min(image.width, round((x + width) * image.width))
            bottom = min(image.height, round((y + height) * image.height))
            if right > left and bottom > top:
                indexes.append(index)
                crops.append(image.crop((left, top, right, bottom)))

        if not crops:
            continue
        try:
            with _detector_lock:
                model = _load_classifier(filename)
                results = []
                for start in range(0, len(crops), 16):
                    results.extend(model.predict(crops[start:start + 16], device='cpu', verbose=False, save=False))
        except Exception:
            logger.exception('Falhou a classificação com %s', filename)
            continue

        for index, result in zip(indexes, results, strict=True):
            subtype = subtypes.get(result.names[result.probs.top1])
            if subtype and float(result.probs.top1conf) >= threshold:
                class_name, label = subtype
                classified[index] = replace(detections[index], class_name=class_name, label=label)
    return classified


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
    detections = [asdict(detection) for detection in classify_detections(photo, detect(photo, models_dir))]
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
