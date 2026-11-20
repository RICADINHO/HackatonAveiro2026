import json
import logging
import subprocess
from bisect import bisect_left
from contextlib import contextmanager
from math import isfinite
from pathlib import Path
from shutil import copyfileobj
from tempfile import TemporaryDirectory
from typing import BinaryIO, TypedDict

import cv2
from PIL import Image

VIDEO_EXTENSIONS = frozenset({'.mp4', '.mov', '.webm'})
MAX_VIDEO_BYTES = 50 * 1024 * 1024
MAX_VIDEO_SECONDS = 20
VIDEO_SAMPLE_INTERVAL_SECONDS = 4
MAX_VIDEO_PIXELS = 3840 * 2160
VIDEO_SAMPLE_SECONDS = range(0, MAX_VIDEO_SECONDS, VIDEO_SAMPLE_INTERVAL_SECONDS)
logger = logging.getLogger(__name__)


class VideoCamera(TypedDict):
    latitude: float | None
    longitude: float | None
    heading: float | None


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

        samples = []
        for second in VIDEO_SAMPLE_SECONDS:
            if second >= duration:
                break
            index = int(second * fps)
            if index and not capture.set(cv2.CAP_PROP_POS_FRAMES, index):
                raise VideoInputError('Não foi possível avançar para o fotograma no vídeo.')
            ok, frame = capture.read()
            if not ok:
                raise VideoInputError('Não foi possível ler todos os fotogramas selecionados.')
            if frame.shape[0] * frame.shape[1] > MAX_VIDEO_PIXELS:
                raise VideoInputError('A resolução de um dos fotogramas é demasiado alta.')
            image = Image.fromarray(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
            image.thumbnail((1920, 1920))
            samples.append((second * 1000, image))
        return samples
    except cv2.error as exc:
        raise VideoInputError('Não foi possível descodificar os fotogramas do vídeo.') from exc
    finally:
        capture.release()


@contextmanager
def _video_file(file: BinaryIO, suffix: str):
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
        yield path


def read_video_samples(file: BinaryIO, suffix: str) -> list[tuple[int, Image.Image]]:
    with _video_file(file, suffix) as path:
        return _sample_video(path)


def _number(value, minimum, maximum):
    if isinstance(value, (int, float)) and not isinstance(value, bool) and minimum <= value <= maximum:
        return float(value)
    return None


def _camera(tags: dict) -> VideoCamera:
    latitude = _number(tags.get('GPSLatitude'), -90, 90)
    longitude = _number(tags.get('GPSLongitude'), -180, 180)
    if latitude is None or longitude is None:
        coordinates = str(tags.get('GPSCoordinates', '')).split()
        if len(coordinates) >= 2:
            try:
                latitude = _number(float(coordinates[0]), -90, 90)
                longitude = _number(float(coordinates[1]), -180, 180)
            except ValueError:
                pass
    if latitude is None or longitude is None:
        latitude = longitude = None
    else:
        if tags.get('GPSLatitudeRef') == 'S':
            latitude = -abs(latitude)
        if tags.get('GPSLongitudeRef') == 'W':
            longitude = -abs(longitude)

    heading = None
    if tags.get('GPSImgDirectionRef') in (None, 'T'):
        heading = _number(tags.get('GPSImgDirection'), 0, 360)
    if heading is None:
        heading = _number(tags.get('CameraDirection'), 0, 360)
    return {'latitude': latitude, 'longitude': longitude, 'heading': None if heading is None else heading % 360}


def _interpolate(values: dict[float, float], second: int, *, circular: bool = False) -> float | None:
    if not values:
        return None
    times = sorted(values)
    index = bisect_left(times, second)
    if index == 0:
        return values[times[0]]
    if index == len(times):
        return values[times[-1]]
    before, after = times[index - 1:index + 1]
    start = values[before]
    difference = values[after] - start
    if circular:
        difference = (difference + 180) % 360 - 180
    return start + difference * (second - before) / (after - before)


def _camera_samples(metadata: dict) -> dict[int, VideoCamera]:
    # ExifTool gives each embedded sample a separate document group.
    documents: dict[str, dict] = {}
    for key, value in metadata.items():
        document, _, name = key.rpartition(':')
        documents.setdefault(document, {})[name] = value

    initial: VideoCamera = dict(latitude=None, longitude=None, heading=None)
    latitudes: dict[float, float] = {}
    longitudes: dict[float, float] = {}
    headings: dict[float, float] = {}
    for tags in documents.values():
        camera = _camera(tags)
        second = _number(tags.get('SampleTime'), 0, MAX_VIDEO_SECONDS)
        latitude, longitude, heading = camera['latitude'], camera['longitude'], camera['heading']
        if second is None:
            if 'SampleTime' in tags:
                continue
            for name, value in camera.items():
                if initial[name] is None:
                    initial[name] = value
        else:
            if latitude is not None and longitude is not None:
                latitudes[second], longitudes[second] = latitude, longitude
            if heading is not None:
                headings[second] = heading

    # A lone position or heading is only a starting point, not a track.
    frames = {}
    for second in VIDEO_SAMPLE_SECONDS:
        latitude = _interpolate(latitudes, second) if len(latitudes) > 1 or second == 0 else None
        longitude = _interpolate(longitudes, second, circular=True) if latitude is not None else None
        heading = _interpolate(headings, second, circular=True) if len(headings) > 1 or second == 0 else None
        camera = {
            'latitude': initial['latitude'] if latitude is None and second == 0 else latitude,
            'longitude': initial['longitude'] if longitude is None and second == 0 else (
                (longitude + 180) % 360 - 180 if longitude is not None and abs(longitude) > 180 else longitude),
            'heading': initial['heading'] if heading is None and second == 0 else (
                heading % 360 if heading is not None else None),
        }
        if any(value is not None for value in camera.values()):
            frames[second * 1000] = camera
    return frames


def read_video_locations(file: BinaryIO, suffix: str) -> dict[int, VideoCamera]:
    with _video_file(file, suffix) as path:
        try:
            result = subprocess.run(
                ['exiftool', '-j', '-n', '-ee3', '-G3', '-SampleTime', '-GPSCoordinates',
                 '-GPSLatitude', '-GPSLongitude', '-GPSLatitudeRef', '-GPSLongitudeRef',
                 '-GPSImgDirection', '-GPSImgDirectionRef', '-CameraDirection', str(path)],
                check=True, capture_output=True, timeout=15,
            )
            return _camera_samples(json.loads(result.stdout)[0])
        except (OSError, subprocess.SubprocessError, ValueError, IndexError):
            logger.warning('Não foi possível ler os metadados GPS do vídeo com ExifTool.')
            return {}
