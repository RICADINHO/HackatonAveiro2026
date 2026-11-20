from math import ceil, isfinite
from pathlib import Path
from shutil import copyfileobj
from tempfile import TemporaryDirectory
from typing import BinaryIO

import cv2
from PIL import Image

VIDEO_EXTENSIONS = frozenset({'.mp4', '.mov', '.webm'})
MAX_VIDEO_BYTES = 50 * 1024 * 1024
MAX_VIDEO_SECONDS = 20
MAX_VIDEO_SAMPLES = 4
MAX_VIDEO_PIXELS = 3840 * 2160


class VideoInputError(ValueError):
    """The uploaded video cannot be sampled."""


def _sample_video(path: Path) -> list[tuple[int, Image.Image]]:
    capture = cv2.VideoCapture()
    try:
        if not capture.open(str(path), cv2.CAP_FFMPEG):
            raise VideoInputError('Não foi possível ler o vídeo. Experimenta gravá-lo em MP4 com H.264.')
        fps = capture.get(cv2.CAP_PROP_FPS)
        frames = capture.get(cv2.CAP_PROP_FRAME_COUNT)
        if not isfinite(fps) or not isfinite(frames) or fps <= 0 or frames < 1:
            raise VideoInputError('Não foi possível determinar a duração do vídeo.')
        duration = frames / fps
        if duration > MAX_VIDEO_SECONDS:
            raise VideoInputError(f'O vídeo pode ter até {MAX_VIDEO_SECONDS} segundos.')
        width = capture.get(cv2.CAP_PROP_FRAME_WIDTH)
        height = capture.get(cv2.CAP_PROP_FRAME_HEIGHT)
        if not (0 < width <= 3840 and 0 < height <= 3840 and width * height <= MAX_VIDEO_PIXELS):
            raise VideoInputError('O vídeo pode ter até 3840 × 2160 píxeis ou o equivalente na vertical.')

        count = min(MAX_VIDEO_SAMPLES, int(frames), max(1, ceil(duration / 2)))
        samples = []
        for slot in range(count):
            index = int(slot * frames / count)
            if index and not capture.set(cv2.CAP_PROP_POS_FRAMES, index):
                raise VideoInputError('Não foi possível avançar para o fotograma no vídeo.')
            ok, frame = capture.read()
            if not ok:
                raise VideoInputError('Não foi possível ler todos os fotogramas selecionados.')
            if frame.shape[0] * frame.shape[1] > MAX_VIDEO_PIXELS:
                raise VideoInputError('A resolução de um dos fotogramas é demasiado alta.')
            timestamp = capture.get(cv2.CAP_PROP_POS_MSEC)
            if not (0 < timestamp < duration * 1000) or index == 0:
                timestamp = index / fps * 1000
            image = Image.fromarray(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
            image.thumbnail((1920, 1920))
            samples.append((round(timestamp), image))
        return samples
    except cv2.error as exc:
        raise VideoInputError('Não foi possível descodificar os fotogramas do vídeo.') from exc
    finally:
        capture.release()


def read_video_samples(file: BinaryIO, suffix: str) -> list[tuple[int, Image.Image]]:
    if suffix not in VIDEO_EXTENSIONS:
        raise VideoInputError('Escolhe um vídeo MP4, MOV ou WebM.')
    header = file.read(12)
    if suffix == '.webm':
        valid_container = header.startswith(b'\x1a\x45\xdf\xa3')
    else:
        valid_container = header[4:8] == b'ftyp'
    if not valid_container:
        raise VideoInputError('Seleciona um ficheiro de vídeo MP4, MOV ou WebM válido.')
    file.seek(0)
    with TemporaryDirectory(prefix='aveiro-video-') as directory:
        path = Path(directory) / f'upload{suffix}'
        with path.open('wb') as output:
            copyfileobj(file, output)
        return _sample_video(path)
