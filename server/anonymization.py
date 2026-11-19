from functools import lru_cache
from itertools import chain
from math import ceil, floor
from pathlib import Path
from threading import Lock

import cv2
import numpy as np
from PIL import Image, ImageFilter

FACE_MODEL = 'retinaface_r34.onnx'
PLATE_MODEL = 'yolo-v9-s-608-license-plates-end2end.onnx'
FACE_CONFIDENCE = 0.30
PLATE_CONFIDENCE = 0.25
FACE_INPUT_SIZE = 1280
PLATE_INPUT_SIZE = 608
BOX_PADDING = 0.20
_model_lock = Lock()


class AnonymizationError(RuntimeError):
    """The image could not be anonymized."""


@lru_cache(maxsize=2)
def _load_model(path: Path):
    if not path.is_file():
        raise FileNotFoundError(f'Falta o modelo de anonimização: {path}')

    import onnxruntime as ort

    options = ort.SessionOptions()
    options.intra_op_num_threads = 4
    return ort.InferenceSession(str(path), sess_options=options, providers=['CPUExecutionProvider'])


@lru_cache(maxsize=8)
def _face_anchors(width: int, height: int) -> np.ndarray:
    # RetinaFace uses two square anchors per cell of its three feature maps.
    anchors = []
    for stride, sizes in ((8, (16, 32)), (16, (64, 128)), (32, (256, 512))):
        rows, columns = np.indices((ceil(height / stride), ceil(width / stride)))
        centers = (np.column_stack((columns.ravel(), rows.ravel())) + 0.5) * stride
        anchors.append(np.column_stack((np.repeat(centers, len(sizes), axis=0), np.tile(sizes, len(centers)))))
    return np.concatenate(anchors).astype(np.float32)


def _face_boxes(image: Image.Image, model) -> np.ndarray:
    resized = image.copy()
    resized.thumbnail((FACE_INPUT_SIZE, FACE_INPUT_SIZE), Image.Resampling.BILINEAR)
    bgr = np.asarray(resized, dtype=np.float32)[..., ::-1] - np.array([104, 117, 123], dtype=np.float32)
    offsets, scores, _ = model.run(None, {model.get_inputs()[0].name: bgr.transpose(2, 0, 1)[None]})
    scores = scores[0, :, 1]
    selected = scores > FACE_CONFIDENCE
    offsets = offsets[0, selected]
    anchors = _face_anchors(*resized.size)[selected]
    centers = anchors[:, :2] + 0.1 * offsets[:, :2] * anchors[:, 2:]
    sizes = np.exp(0.2 * offsets[:, 2:]) * anchors[:, 2:]
    top_left = centers - sizes / 2

    kept = cv2.dnn.NMSBoxes(np.column_stack((top_left, sizes)).tolist(), scores[selected].tolist(),
                            FACE_CONFIDENCE, 0.4)
    boxes = np.column_stack((top_left, top_left + sizes))[np.asarray(kept, dtype=np.intp).reshape(-1)]
    return boxes * np.tile([image.width / resized.width, image.height / resized.height], 2)


def _plate_boxes(image: Image.Image, model) -> np.ndarray:
    # The exported YOLOv9 model expects a square RGB letterbox and includes NMS.
    scale = PLATE_INPUT_SIZE / max(image.size)
    resized_width, resized_height = (max(1, round(side * scale)) for side in image.size)
    left = (PLATE_INPUT_SIZE - resized_width) // 2
    top = (PLATE_INPUT_SIZE - resized_height) // 2
    canvas = Image.new('RGB', (PLATE_INPUT_SIZE, PLATE_INPUT_SIZE), (114, 114, 114))
    canvas.paste(image.resize((resized_width, resized_height), Image.Resampling.BILINEAR), (left, top))
    tensor = np.asarray(canvas, dtype=np.float32).transpose(2, 0, 1)[None] / 255
    predictions, = model.run(None, {model.get_inputs()[0].name: tensor})
    # Each row is [batch, left, top, right, bottom, class, score].
    boxes = predictions[predictions[:, 6] >= PLATE_CONFIDENCE, 1:5]
    return (boxes - np.tile([left, top], 2)) * np.tile([image.width / resized_width, image.height / resized_height], 2)


def anonymize(image: Image.Image, models_dir: Path) -> Image.Image:
    try:
        with _model_lock:
            face_model = _load_model(models_dir / FACE_MODEL)
            plate_model = _load_model(models_dir / PLATE_MODEL)
        boxes = chain(_face_boxes(image, face_model), _plate_boxes(image, plate_model))
        output = image.copy()
        for left, top, right, bottom in boxes:
            x_margin = (right - left) * BOX_PADDING
            y_margin = (bottom - top) * BOX_PADDING
            region = (
                max(0, floor(left - x_margin)),
                max(0, floor(top - y_margin)),
                min(image.width, ceil(right + x_margin)),
                min(image.height, ceil(bottom + y_margin)),
            )
            if region[2] <= region[0] or region[3] <= region[1]:
                continue
            crop = output.crop(region)
            blurred = crop.filter(ImageFilter.GaussianBlur(max(8, max(crop.size) / 6)))
            blocks = tuple(max(1, side // 24) for side in crop.size)
            pixelated = blurred.resize(blocks, Image.Resampling.BOX).resize(crop.size, Image.Resampling.NEAREST)
            output.paste(pixelated, region)
        return output
    except Exception as exc:
        raise AnonymizationError('Falhou a anonimização de rostos ou matrículas.') from exc
