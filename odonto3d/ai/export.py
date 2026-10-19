"""Export full-grid labels and bounded, approximate 3D preview surfaces."""
import gzip
import json
import math
import struct
import zlib
from pathlib import Path
import numpy as np
from skimage.measure import marching_cubes
from protocol import LABELS, MODEL_ID, MODEL_URL, validate_source


def preview_mesh(labels, label_id, source):
    # Preserve narrow canals; other surfaces use a grid bounded to ~256 per axis.
    stride = 1 if label_id == 5 else max(1, math.ceil(max(labels.shape) / 256))
    for _ in range(5):
        sampled = labels[::stride, ::stride, ::stride]
        mask = sampled == label_id
        if not mask.any():
            return None
        axes = [np.flatnonzero(mask.any(axis=tuple(j for j in range(3) if j != i))) for i in range(3)]
        low = np.array([a[0] for a in axes]); high = np.array([a[-1] + 1 for a in axes])
        box = tuple(slice(int(a), int(b)) for a, b in zip(low, high))
        cropped = np.pad(mask[box], 1)
        del mask
        spacing_zyx = np.array(source["spacing"][::-1]) * stride
        vertices, faces, normals, _ = marching_cubes(cropped, level=.5, spacing=spacing_zyx, allow_degenerate=False)
        if len(vertices) <= 500_000 and len(faces) <= 1_000_000:
            vertices += (low - 1) * spacing_zyx
            vertices = np.ascontiguousarray(vertices[:, ::-1] + np.array(source["origin"]), dtype="<f4")
            normals = normals / spacing_zyx
            normals /= np.maximum(np.linalg.norm(normals, axis=1, keepdims=True), 1e-12)
            normals = np.ascontiguousarray(normals[:, ::-1], dtype="<f4")
            # skimage's default descent faces oppose its normals in ZYX.
            # Reordering vertices to XYZ reverses handedness, aligning them.
            faces = np.ascontiguousarray(faces, dtype="<u4")
            return {"id": label_id, "vertexCount": len(vertices), "triangleCount": len(faces),
                    "previewSpacing": (spacing_zyx[::-1]).tolist()}, [vertices.tobytes(), normals.tobytes(), faces.tobytes()]
        stride *= 2
    raise ValueError("A superfície 3D excedeu o limite de visualização.")


def export_result(labels, source, output, inference, progress=lambda *args: None):
    source = validate_source(source)
    if list(labels.shape) != source["dimensions"][::-1] or labels.dtype != np.uint8 or labels.max() > 5:
        raise ValueError("A segmentação não corresponde à geometria do exame.")
    counts = np.bincount(labels.ravel(), minlength=6)
    raw = labels.tobytes(order="C")
    compressed = gzip.compress(raw, compresslevel=2, mtime=0)
    crc = zlib.crc32(raw)
    del raw
    meshes, buffers = [], []
    for label in LABELS:
        progress("surfaces", "Preparando superfície: " + label["name"])
        if not counts[label["id"]]:
            continue
        mesh = preview_mesh(labels, label["id"], source)
        if mesh:
            meshes.append(mesh[0]); buffers.extend(mesh[1])
    manifest = {"format": "odonto-seg", "version": 1, "source": source,
                "model": {"id": MODEL_ID, "url": MODEL_URL, "license": "CC-BY-4.0", **inference},
                "reviewed": False, "labelsGzipBytes": len(compressed), "labelsCrc32": crc,
                "layers": [{**label, "voxels": int(counts[label["id"]])} for label in LABELS], "meshes": meshes}
    header = json.dumps(manifest, separators=(",", ":"), ensure_ascii=False).encode()
    with Path(output).open("wb") as f:
        f.write(b"ODSEG001" + struct.pack("<I", len(header)) + header + compressed)
        for buf in buffers:
            f.write(buf)
    return manifest


def restore_labels_streaming(prediction, plans, configuration, properties):
    """Same nnU-Net interpolation and categorical argmax, one class at a time.

    Avoids materializing six full-resolution probabilities. Softmax is monotone
    within a voxel; the first maximum wins, exactly as in categorical argmax.
    """
    import torch
    shape=properties['shape_after_cropping_and_before_resampling']
    spacing=[properties['spacing'][i] for i in plans.transpose_forward]
    current=configuration.spacing
    if len(current)!=len(shape): current=[spacing[0],*current]
    best=np.full(shape,-np.inf,dtype=np.float32)
    labels=np.zeros(shape,dtype=np.uint8)
    for channel in range(prediction.shape[0]):
        restored=configuration.resampling_fn_probabilities(prediction[channel:channel+1],shape,current,spacing)
        if isinstance(restored,torch.Tensor): restored=restored.cpu().numpy()
        values=restored[0]
        if not np.isfinite(values).all(): raise ValueError('A IA produziu intensidades não finitas.')
        mask=values>best
        best[mask]=values[mask];labels[mask]=channel
        del restored,values,mask
    del best
    full=np.zeros(properties['shape_before_cropping'],dtype=np.uint8)
    full[tuple(slice(a,b) for a,b in properties['bbox_used_for_cropping'])]=labels
    return full.transpose(plans.transpose_backward)
