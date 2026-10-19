"""Local DentalSegmentator inference. No remote service or patient identifiers."""
import argparse
import gc
import hashlib
import json
import math
import os
from pathlib import Path
import time


def run(job, model_root, threads=4):
    started = time.monotonic()
    os.environ["nnUNet_def_n_proc"] = str(threads)
    os.environ["nnUNet_compile"] = "false"
    os.environ["OMP_NUM_THREADS"] = str(threads)
    cache = job.parent.parent / "cache" / "mpl"
    cache.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.environ["MPLCONFIGDIR"] = str(cache)
    for key in ("nnUNet_raw", "nnUNet_preprocessed", "nnUNet_results"):
        os.environ[key] = str(job / key)

    def report(stage, detail, **fields):
        state = {"stage": stage, "detail": detail, "elapsedSeconds": round(time.monotonic() - started), **fields}
        temp = job / "progress.tmp"
        temp.write_text(json.dumps(state, ensure_ascii=False))
        temp.replace(job / "progress.json")
        print(json.dumps(state, ensure_ascii=False), flush=True)

    report("loading", "Carregando o modelo odontológico na CPU…")
    import numpy as np
    import torch
    from nnunetv2.inference.predict_from_raw_data import nnUNetPredictor
    from protocol import validate_source
    from export import export_result, restore_labels_streaming
    from onnx_engine import configure
    torch.set_num_threads(threads)
    torch.set_num_interop_threads(1)

    class ProgressPredictor(nnUNetPredictor):
        def _internal_get_sliding_window_slicers(self, image_size):
            slicers = super()._internal_get_sliding_window_slicers(image_size)
            self.tile_total = len(slicers); self.tile_done = 0
            report("predicting", "Identificando estruturas…", tilesDone=0, tilesTotal=self.tile_total)
            return slicers

        def _internal_maybe_mirror_and_predict(self, x):
            result = super()._internal_maybe_mirror_and_predict(x)
            self.tile_done += 1
            report("predicting", "Identificando estruturas…", tilesDone=self.tile_done, tilesTotal=self.tile_total)
            return result

    # Only models downloaded by the installer and verified against the pinned manifest are accepted.
    hashes = json.loads((model_root / "verified-files.json").read_text())
    for rel, expected in hashes.items():
        file = (model_root / rel).resolve()
        if not file.is_relative_to(model_root.resolve()) or hashlib.file_digest(file.open("rb"), "sha256").hexdigest() != expected:
            raise ValueError("A integridade dos arquivos do modelo não confere. Execute a instalação novamente.")
    candidates = [p.parent for p in model_root.rglob("plans.json") if list(p.parent.glob("fold_*/checkpoint_final.pth"))]
    if len(candidates) != 1:
        raise ValueError("Modelo odontológico ausente ou ambíguo.")
    folder = candidates[0]
    folds = [p.name.removeprefix("fold_") for p in folder.glob("fold_*") if (p / "checkpoint_final.pth").is_file()]
    predictor = ProgressPredictor(tile_step_size=.5, use_gaussian=True, use_mirroring=True,
                                  perform_everything_on_device=False, device=torch.device("cpu"),
                                  verbose=False, verbose_preprocessing=False, allow_tqdm=False)
    predictor.initialize_from_trained_model_folder(str(folder), folds)
    if predictor.label_manager.has_regions or predictor.label_manager.foreground_labels != [1, 2, 3, 4, 5]:
        raise ValueError("Classes do modelo incompatíveis.")
    runtime_info = configure(predictor, model_root, threads, report)
    source = validate_source(json.loads((job / "source.json").read_text()))
    native_spacing = predictor.configuration_manager.spacing
    order = predictor.plans_manager.transpose_forward
    original_shape = source["dimensions"][::-1]
    original_spacing = source["spacing"][::-1]
    model_shape = [max(1, round(original_shape[a] * original_spacing[a] / native_spacing[i])) for i, a in enumerate(order)]
    if math.prod(model_shape) > 32_000_000:
        raise ValueError("O volume reamostrado excede o limite de memória desta versão local (32 milhões de voxels).")
    dtype = {"uint16": "<u2", "int16": "<i2", "float32": "<f4"}[source["dtype"]]
    data = np.fromfile(job / "volume.raw", dtype=dtype).reshape(source["dimensions"][::-1]).astype(np.float32)
    data *= source["scalarSlope"]; data += source["scalarIntercept"]
    if not np.isfinite(data).all():
        raise ValueError("O exame contém intensidades inválidas.")
    report("preprocessing", "Preparando o volume para o modelo…")
    properties = {"spacing": source["spacing"][::-1]}
    preprocessor = predictor.configuration_manager.preprocessor_class(verbose=False)
    prepared, crop_mask = preprocessor.run_case_npy(data[None], None, properties,
                                                        predictor.plans_manager, predictor.configuration_manager,
                                                        predictor.dataset_json)
    del data, crop_mask; gc.collect()
    prediction = predictor.predict_logits_from_preprocessed_data(torch.from_numpy(prepared)).cpu()
    del prepared; gc.collect()
    report("restoring", "Recolocando as marcações na matriz original do exame…")
    labels = restore_labels_streaming(prediction, predictor.plans_manager, predictor.configuration_manager, properties)
    inference = {"engine": "nnUNetv2-2.5.1", **runtime_info, "device": "cpu", "mirroring": True, "tileStep": .5,
                 "modelSpacing": predictor.configuration_manager.spacing,
                 "folds": folds, "seconds": round(time.monotonic() - started, 1)}
    del prediction, predictor; gc.collect()
    labels = np.ascontiguousarray(labels, dtype=np.uint8)
    manifest = export_result(labels, source, job / "result.odseg", inference, report)
    report("complete", "Sugestões da IA prontas para revisão.", counts=[a["voxels"] for a in manifest["layers"]])
    (job / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--job", type=Path, required=True)
    parser.add_argument("--model", type=Path, required=True)
    parser.add_argument("--threads", type=int, default=4)
    args = parser.parse_args()
    try:
        run(args.job.resolve(), args.model.resolve(), max(1, min(8, args.threads)))
    except Exception as error:
        print("Falha na segmentação local: " + str(error), flush=True)
        raise
