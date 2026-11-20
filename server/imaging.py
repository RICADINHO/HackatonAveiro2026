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
    # Regulatory signs
    **dict.fromkeys(('stop', 'eu_dfg_regulatory_stop'), ('stop', 'Sinal de STOP')),
    **dict.fromkeys(('give_way', 'eu_dfg_regulatory_yield',
                     'eu_dfg_regulatory_yield_to_oncoming_traffic'), ('cedencia', 'Cedência de passagem')),
    **dict.fromkeys(('no_entry', 'eu_dfg_regulatory_no_entry'), ('sentido-proibido', 'Sentido proibido')),
    **dict.fromkeys(('parking', 'eu_dfg_information_parking'), ('estacionamento', 'Estacionamento')),
    'eu_dfg_regulatory_no_parking': ('estacionamento-proibido', 'Estacionamento proibido'),
    **dict.fromkeys(('roundabout_mandatory', 'eu_dfg_regulatory_roundabout'),
                    ('rotunda', 'Rotunda')),
    **dict.fromkeys(('ahead_only', 'go_straight', 'eu_dfg_regulatory_go_straight',
                     'ileri_mecburi_yon'), ('sentido-obrigatorio', 'Sentido obrigatório')),
    **dict.fromkeys(('turn_left_ahead', 'eu_dfg_regulatory_turn_left'),
                    ('virar-esquerda', 'Virar à esquerda')),
    **dict.fromkeys(('turn_right_ahead', 'eu_dfg_regulatory_turn_right'),
                    ('virar-direita', 'Virar à direita')),
    **dict.fromkeys(('go_straight_or_left', 'eu_dfg_regulatory_go_straight_or_turn_left'),
                    ('seguir-esquerda', 'Em frente ou à esquerda')),
    **dict.fromkeys(('go_straight_or_right', 'eu_dfg_regulatory_go_straight_or_turn_right'),
                    ('seguir-direita', 'Em frente ou à direita')),
    **dict.fromkeys(('keep_left', 'eu_dfg_regulatory_keep_left'), ('manter-esquerda', 'Manter à esquerda')),
    **dict.fromkeys(('keep_right', 'eu_dfg_regulatory_keep_right'), ('manter-direita', 'Manter à direita')),
    **dict.fromkeys(('no_passing', 'eu_dfg_regulatory_no_overtaking'),
                    ('proibido-ultrapassar', 'Proibido ultrapassar')),
    'no_passing_trucks': ('proibido-ultrapassar-pesados', 'Proibido ultrapassar a pesados'),
    **dict.fromkeys(('no_trucks', 'no_heavy_goods_vehicles', 'eu_dfg_regulatory_no_goods_vehicles',
                     'eu_dfg_regulatory_no_goods_vehicles_exceeding_limit',
                     'eu_dfg_regulatory_no_heavy_goods_vehicles'),
                    ('proibido-pesados', 'Proibido a veículos pesados')),
    **dict.fromkeys(('no_vehicles', 'eu_dfg_regulatory_no_motor_vehicles'),
                    ('proibido-veiculos', 'Proibido a veículos motorizados')),
    'eu_dfg_regulatory_no_buses': ('proibido-autocarros', 'Proibido a autocarros'),
    **dict.fromkeys(('no_bicycles', 'eu_dfg_regulatory_no_bicycles'),
                    ('proibido-bicicletas', 'Proibido a bicicletas')),
    **dict.fromkeys(('no_pedestrians', 'eu_dfg_regulatory_no_pedestrians'),
                    ('proibido-peoes', 'Proibido a peões')),
    **dict.fromkeys(('bicycles_only', 'eu_dfg_regulatory_bicycles_only'),
                    ('pista-ciclista', 'Pista para bicicletas')),
    **dict.fromkeys(('pedestrians', 'eu_dfg_regulatory_pedestrians_only'),
                    ('zona-peoes', 'Zona de peões')),
    **dict.fromkeys(('shared_path', 'eu_dfg_regulatory_shared_path_pedestrians_and_bicycles'),
                    ('via-partilhada', 'Via partilhada com bicicletas')),
    **dict.fromkeys(('no_u_turn', 'eu_dfg_regulatory_no_u_turn'),
                    ('proibido-inverter', 'Proibida a inversão de marcha')),
    **dict.fromkeys(('no_left_turn', 'eu_dfg_regulatory_no_left_turn'),
                    ('proibido-virar-esquerda', 'Proibido virar à esquerda')),
    **dict.fromkeys(('no_right_turn', 'eu_dfg_regulatory_no_right_turn'),
                    ('proibido-virar-direita', 'Proibido virar à direita')),
    'eu_dfg_regulatory_height_limit': ('limite-altura', 'Limite de altura'),
    'eu_dfg_regulatory_weight_limit': ('limite-peso', 'Limite de peso'),
    'eu_dfg_regulatory_axel_mass_limit': ('limite-peso-eixo', 'Limite de peso por eixo'),
    'end_all_restrictions': ('fim-restricoes', 'Fim de todas as restrições'),
    'end_no_passing': ('fim-proibicao-ultrapassar', 'Fim da proibição de ultrapassar'),
    'end_no_passing_trucks': ('fim-proibicao-ultrapassar-pesados',
                              'Fim da proibição de ultrapassar a pesados'),
    'end_speed_limit_80': ('fim-velocidade-80', 'Fim do limite de 80 km/h'),
    # Warning signs
    **dict.fromkeys(('crosswalk', 'eu_dfg_warning_pedestrians_crossing'),
                    ('passadeira', 'Passagem para peões')),
    **dict.fromkeys(('road_work', 'eu_dfg_warning_roadworks'), ('obras', 'Trabalhos na via')),
    **dict.fromkeys(('traffic_signals', 'traffic_signals_ahead', 'eu_dfg_warning_traffic_signals'),
                    ('semaforos', 'Sinalização luminosa')),
    **dict.fromkeys(('children_crossing', 'eu_dfg_warning_children'),
                    ('criancas', 'Passagem de crianças')),
    **dict.fromkeys(('bicycles_crossing', 'eu_dfg_warning_bicycles_crossing'),
                    ('passagem-ciclistas', 'Passagem de ciclistas')),
    **dict.fromkeys(('slippery_road', 'eu_dfg_warning_slippery_road_surface'),
                    ('piso-escorregadio', 'Piso escorregadio')),
    **dict.fromkeys(('road_narrows_right', 'eu_dfg_warning_road_narrows_right'),
                    ('estreitamento-direita', 'Estreitamento à direita')),
    **dict.fromkeys(('road_narrows_left', 'eu_dfg_warning_road_narrows_left'),
                    ('estreitamento-esquerda', 'Estreitamento à esquerda')),
    'eu_dfg_warning_road_narrows': ('estreitamento', 'Estreitamento da via'),
    **dict.fromkeys(('priority_road', 'priority'), ('prioridade', 'Estrada com prioridade')),
    **dict.fromkeys(('priority_next_intersection', 'eu_dfg_warning_crossroads'),
                    ('cruzamento', 'Cruzamento')),
    **dict.fromkeys(('general_caution', 'eu_dfg_warning_other_danger'),
                    ('perigo', 'Outro perigo')),
    **dict.fromkeys(('wild_animals', 'eu_dfg_warning_wild_animals'),
                    ('animais-selvagens', 'Animais selvagens')),
    **dict.fromkeys(('domestic_animals', 'eu_dfg_warning_domestic_animals'),
                    ('animais', 'Animais domésticos')),
    **dict.fromkeys(('eu_dfg_warning_falling_rocks_or_debris_left',
                     'eu_dfg_warning_falling_rocks_or_debris_right'),
                    ('pedras', 'Pedras na via')),
    **dict.fromkeys(('road_bump', 'eu_dfg_warning_road_bump'), ('lomba', 'Lomba')),
    **dict.fromkeys(('road_dip', 'eu_dfg_warning_road_dip'), ('depressao', 'Depressão na via')),
    **dict.fromkeys(('uneven_road', 'eu_dfg_warning_uneven_road'),
                    ('piso-irregular', 'Piso irregular')),
    'ice_snow': ('gelo', 'Gelo ou neve'),
    **dict.fromkeys(('eu_dfg_warning_road_slope_left', 'eu_dfg_warning_road_slope_right'),
                    ('inclinacao', 'Inclinação da via')),
    **dict.fromkeys(('dangerous_curve_left', 'eu_dfg_warning_curve_left'),
                    ('curva-esquerda', 'Curva perigosa à esquerda')),
    **dict.fromkeys(('dangerous_curve_right', 'eu_dfg_warning_curve_right'),
                    ('curva-direita', 'Curva perigosa à direita')),
    **dict.fromkeys(('double_curve', 'eu_dfg_warning_double_curve_first_left',
                     'eu_dfg_warning_double_curve_first_right'),
                    ('curva-dupla', 'Curva dupla')),
    **dict.fromkeys(('eu_dfg_warning_traffic_merges_left', 'eu_dfg_warning_traffic_merges_right'),
                    ('convergencia', 'Convergência de trânsito')),
    **dict.fromkeys(('eu_dfg_warning_railroad_crossing_with_barriers',
                     'eu_dfg_warning_railroad_crossing_without_barriers'),
                    ('passagem-nivel', 'Passagem de nível')),
    # Information signs
    'eu_dfg_information_hospital': ('hospital', 'Hospital'),
    'eu_dfg_information_gas_station': ('posto-combustivel', 'Posto de combustível'),
    'eu_dfg_information_motorway': ('autoestrada', 'Autoestrada'),
    'eu_dfg_information_tram_bus_stop': ('paragem-transporte', 'Paragem de transporte'),
    'eu_dfg_information_disabled_persons': ('mobilidade-reduzida', 'Mobilidade reduzida'),
    # Speed limits
    'hiz_siniri_50': ('velocidade-50', 'Limite de 50 km/h'),
    'eu_dfg_regulatory_maximum_speed_limit': ('limite-velocidade', 'Limite de velocidade'),
    **{f'speed_limit_{speed}': (f'velocidade-{speed}', f'Limite de {speed} km/h')
       for speed in (20, 30, 50, 60, 70, 80, 100, 120)},
}
WASTE_SUBTYPES = {
    'ilha_de_reciclagem': RECYCLING_ISLAND[1:],
    'indiferenciado': ('indiferenciado', 'Contentor de indiferenciados'),
    'subterraneo': ('subterraneo', 'Contentor subterrâneo'),
}
# Generic detection class -> (classifier weights, input size, minimum confidence, subtype map).
CLASSIFIERS = {
    'sinal-transito': ('classifier_sinais.pt', 128, 0.70, SIGN_SUBTYPES),
    'contentor-lixo': ('classifier_lixos.pt', 224, 0.70, WASTE_SUBTYPES),
}
CLASSIFIER_PADDING = 0.10
CLASSIFIER_BATCH = 16
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


def _classifier_crop(image: Image.Image, bbox):
    """Crop a detection with a 10% margin so the classifier sees the whole object."""
    x, y, width, height = bbox
    left = max(0, round((x - width * CLASSIFIER_PADDING) * image.width))
    top = max(0, round((y - height * CLASSIFIER_PADDING) * image.height))
    right = min(image.width, round((x + width * (1 + CLASSIFIER_PADDING)) * image.width))
    bottom = min(image.height, round((y + height * (1 + CLASSIFIER_PADDING)) * image.height))
    if right <= left or bottom <= top:
        return None
    return image.crop((left, top, right, bottom))


def _best_subtype(result, subtypes, threshold):
    """Pick the most confident supported subtype, skipping unrelated classifier classes."""
    for class_id, confidence in zip(result.probs.top5, result.probs.top5conf.tolist(), strict=True):
        subtype = subtypes.get(result.names[int(class_id)])
        if subtype and confidence >= threshold:
            return subtype
    return None


def classify_detections(image: Image.Image, detections: list[Detection]) -> list[Detection]:
    classified = detections.copy()
    for generic, (filename, input_size, threshold, subtypes) in CLASSIFIERS.items():
        indexes = []
        crops = []
        for index, detection in enumerate(detections):
            if detection.class_name != generic:
                continue
            crop = _classifier_crop(image, detection.bbox)
            if crop is not None:
                indexes.append(index)
                crops.append(crop)

        if not crops:
            continue
        try:
            with _detector_lock:
                model = _load_classifier(filename)
                results = []
                for start in range(0, len(crops), CLASSIFIER_BATCH):
                    results.extend(model.predict(crops[start:start + CLASSIFIER_BATCH], imgsz=input_size,
                                                 device='cpu', verbose=False, save=False))
        except Exception:
            logger.exception('Falhou a classificação com %s', filename)
            continue

        for index, result in zip(indexes, results, strict=True):
            subtype = _best_subtype(result, subtypes, threshold)
            if subtype:
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
    return camera, prepare_frame(photo, destination, models_dir)


def prepare_frame(photo: Image.Image, destination: Path, models_dir: Path):
    photo.thumbnail((1920, 1920))
    detections = [asdict(detection) for detection in classify_detections(photo, detect(photo, models_dir))]
    redacted = anonymize(photo, models_dir)
    # An explicit re-encode leaves out the source EXIF, ICC and embedded thumbnails.
    redacted.info.clear()
    with destination.open('xb') as output:
        redacted.save(output, format='JPEG', quality=88)
    return detections


def projection(heading, bbox):
    x, _, width, height = bbox
    bearing = (heading + (x + width / 2 - 0.5) * 65) % 360
    distance = max(4, min(60, 5 / max(height, 0.01)))
    return distance, bearing
