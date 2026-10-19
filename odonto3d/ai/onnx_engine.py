"""Execute the unchanged convolutional network with ONNX Runtime on CPU."""
import hashlib
import json
from pathlib import Path
import numpy as np
import torch


def configure(predictor, model_root, threads, report):
    import onnxruntime as ort
    if len(predictor.list_of_parameters) != 1:
        raise ValueError('Esta integração exige o único fold publicado pelo DentalSegmentator v100.')
    network=predictor.network
    network.load_state_dict(predictor.list_of_parameters[0]);network.eval()
    directory=model_root/'derived-onnx';directory.mkdir(exist_ok=True)
    path=directory/'network.onnx';receipt=directory/'verified.json'
    source=hashlib.sha256((model_root/'verified-files.json').read_bytes()).hexdigest()
    cached=False
    if path.is_file() and receipt.is_file():
        meta=json.loads(receipt.read_text())
        with path.open('rb') as stream: digest=hashlib.file_digest(stream,'sha256').hexdigest()
        cached=meta.get('source')==source and meta.get('sha256')==digest and meta.get('version')==1
    if not cached:
        report('optimizing','Preparando o motor de IA para a memória deste computador…')
        rng=np.random.default_rng(12345)
        sample=torch.from_numpy(rng.normal(size=(1,1,32,32,32)).astype(np.float32))
        with torch.inference_mode():
            torch.onnx.export(network,sample,str(path),input_names=['image'],output_names=['logits'],
                              opset_version=17,do_constant_folding=True,
                              dynamic_axes={'image':{2:'z',3:'y',4:'x'},'logits':{2:'z',3:'y',4:'x'}})
    options=ort.SessionOptions();options.intra_op_num_threads=threads;options.inter_op_num_threads=1
    options.enable_cpu_mem_arena=False;options.enable_mem_pattern=False
    session=ort.InferenceSession(str(path),sess_options=options,providers=['CPUExecutionProvider'])
    if not cached:
        checks=[]
        for shape in [(32,32,32),(64,32,32)]:
            data=np.random.default_rng(1701).normal(size=(1,1,*shape)).astype(np.float32)
            with torch.inference_mode(): reference=network(torch.from_numpy(data)).numpy()
            actual=session.run(['logits'],{'image':data})[0]
            delta=float(np.max(np.abs(actual-reference)))
            agreement=float(np.mean(np.argmax(actual,axis=1)==np.argmax(reference,axis=1)))
            if not np.allclose(actual,reference,rtol=2e-3,atol=2e-3) or agreement<.9999:
                raise ValueError('A conversão do motor não reproduziu os resultados do modelo original.')
            checks.append({'shape':shape,'maxAbsoluteDifference':delta,'labelAgreement':agreement})
        with path.open('rb') as stream: digest=hashlib.file_digest(stream,'sha256').hexdigest()
        receipt.write_text(json.dumps({'version':1,'source':source,'sha256':digest,'checks':checks},indent=2))
    def forward(tensor):
        data=np.ascontiguousarray(tensor.detach().cpu().numpy(),dtype=np.float32)
        return torch.from_numpy(session.run(['logits'],{'image':data})[0])
    network.forward=forward
    return {'runtime':'onnxruntime-'+ort.__version__,'networkConversionChecks':json.loads(receipt.read_text())['checks']}
