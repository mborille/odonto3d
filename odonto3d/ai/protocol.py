"""Small, bounded local interchange format. Geometry is normalized DICOM LPS."""
import hashlib
import json
import math
import re
import struct
from pathlib import Path

MAX_VOXELS = 134_217_728
MAX_RAW_BYTES = 268_435_456
MAX_HEADER = 16_384
TYPES = {"uint16": 2, "int16": 2, "float32": 4}
MODEL_ID = "Dataset112_DentalSegmentator_v100"
MODEL_URL = "https://zenodo.org/records/10829675"
LABELS = [
    {"id": 1, "name": "Maxila / crânio superior", "color": "#e8bc83"},
    {"id": 2, "name": "Mandíbula", "color": "#78aaff"},
    {"id": 3, "name": "Dentes superiores", "color": "#76e0cc"},
    {"id": 4, "name": "Dentes inferiores", "color": "#d3a3f2"},
    {"id": 5, "name": "Canal mandibular", "color": "#ff8076"},
]


def validate_source(meta):
    if not isinstance(meta, dict):
        raise ValueError("Metadados do volume inválidos.")
    dims = meta.get("dimensions")
    if not isinstance(dims, list) or len(dims) != 3 or any(type(n) is not int or not 2 <= n <= 2048 for n in dims):
        raise ValueError("Dimensões inválidas.")
    count = math.prod(dims)
    dtype = meta.get("dtype")
    if count > MAX_VOXELS or dtype not in TYPES or count * TYPES[dtype] > MAX_RAW_BYTES:
        raise ValueError("Volume excede o limite de memória da IA local.")
    for key in ("spacing", "origin"):
        a = meta.get(key)
        if not isinstance(a, list) or len(a) != 3 or any(type(n) not in (int, float) or not math.isfinite(n) for n in a):
            raise ValueError("Geometria inválida.")
    if any(not .01 <= n <= 10 for n in meta["spacing"]) or any(abs(n) > 1e5 for n in meta["origin"]):
        raise ValueError("Geometria fora dos limites suportados.")
    for key in ("scalarSlope", "scalarIntercept"):
        n = meta.get(key)
        if type(n) not in (int, float) or not math.isfinite(n) or abs(n) > 1e9:
            raise ValueError("Transformação de intensidade inválida.")
    if meta["scalarSlope"] == 0 or not re.fullmatch(r"[0-9a-f]{64}", meta.get("digest", "")):
        raise ValueError("Identificação do volume inválida.")
    return {key: meta[key] for key in ("dimensions", "spacing", "origin", "dtype", "scalarSlope", "scalarIntercept", "digest")}


def read_exact(stream, size):
    data = bytearray()
    while len(data) < size:
        part = stream.read(min(size - len(data), 1024 * 1024))
        if not part:
            raise ValueError("Transferência local incompleta.")
        data.extend(part)
    return bytes(data)


def receive_volume(stream, length, directory):
    """Read a bounded packet to an owner-only temporary directory; reject mismatched hashes."""
    if not 12 < length <= MAX_RAW_BYTES + MAX_HEADER + 12:
        raise ValueError("Tamanho de volume inválido.")
    prefix = read_exact(stream, 12)
    if prefix[:8] != b"ODVOX001":
        raise ValueError("Formato de volume inválido.")
    size = struct.unpack("<I", prefix[8:])[0]
    if not 0 < size <= MAX_HEADER:
        raise ValueError("Cabeçalho de volume inválido.")
    source = validate_source(json.loads(read_exact(stream, size)))
    expected = math.prod(source["dimensions"]) * TYPES[source["dtype"]]
    if length != 12 + size + expected:
        raise ValueError("Tamanho e geometria do volume não correspondem.")
    target = Path(directory) / "volume.raw"
    digest = hashlib.sha256()
    with target.open("wb") as out:
        target.chmod(0o600)
        remaining = expected
        while remaining:
            chunk = read_exact(stream, min(remaining, 1024 * 1024))
            digest.update(chunk)
            out.write(chunk)
            remaining -= len(chunk)
    if digest.hexdigest() != source["digest"]:
        target.unlink(missing_ok=True)
        raise ValueError("A integridade do volume não confere.")
    (Path(directory) / "source.json").write_text(json.dumps(source))
    return source
