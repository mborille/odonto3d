import hashlib
import io
import json
from pathlib import Path
import struct
import subprocess
import sys
import tempfile
import threading
import unittest
import urllib.request
import urllib.error
import numpy as np
from protocol import receive_volume, validate_source
from export import preview_mesh, export_result
from server import Runtime, make_handler, ThreadingHTTPServer


def source(raw=b'\x00' * 128):
    return dict(dimensions=[4,4,4],spacing=[.2,.3,.4],origin=[-3,5,9],dtype='uint16',scalarSlope=1,scalarIntercept=-1000,digest=hashlib.sha256(raw).hexdigest())

def packet(meta, raw):
    header=json.dumps(meta).encode()
    return b'ODVOX001'+struct.pack('<I',len(header))+header+raw

class ProtocolTests(unittest.TestCase):
    def test_verified_upload_strips_identifiers(self):
        raw=bytes(range(128)); meta=source(raw); meta['PatientName']='SYNTHETIC'; data=packet(meta,raw)
        with tempfile.TemporaryDirectory() as directory:
            result=receive_volume(io.BytesIO(data),len(data),directory)
            self.assertNotIn('PatientName',result)
            self.assertEqual((Path(directory)/'volume.raw').read_bytes(),raw)
            self.assertEqual((Path(directory)/'volume.raw').stat().st_mode & 0o777,0o600)
    def test_mismatch_and_truncation_rejected(self):
        for data in [packet(source(),b'x'*128),packet(source(),b'\0'*127)]:
            with tempfile.TemporaryDirectory() as directory, self.assertRaises(ValueError): receive_volume(io.BytesIO(data),len(data),directory)
    def test_bounds_and_invalid_geometry(self):
        for key,value in [('dimensions',[2048,2048,2048]),('dimensions',[True,4,4]),('spacing',[0,.1,.1]),('origin',[float('nan'),0,0]),('scalarSlope',0)]:
            with self.subTest(key=key), self.assertRaises(ValueError): validate_source({**source(),key:value})
    def test_surface_axis_order_and_physical_bounds(self):
        labels=np.zeros((4,4,4),np.uint8); labels[1:3,1:3,1:3]=1
        descriptor,parts=preview_mesh(labels,1,source())
        vertices=np.frombuffer(parts[0],'<f4').reshape(-1,3)
        normals=np.frombuffer(parts[1],'<f4').reshape(-1,3)
        np.testing.assert_allclose(vertices.min(0),np.array([-3,5,9])+np.array([.2,.3,.4])*.5,atol=1e-6)
        np.testing.assert_allclose(vertices.max(0),np.array([-3,5,9])+np.array([.2,.3,.4])*2.5,atol=1e-6)
        np.testing.assert_allclose(np.linalg.norm(normals,axis=1),1,atol=1e-6)
        faces=np.frombuffer(parts[2],'<u4').reshape(-1,3)
        triangle=vertices[faces]
        winding=np.cross(triangle[:,1]-triangle[:,0],triangle[:,2]-triangle[:,0])
        self.assertTrue(np.all(np.sum(winding*normals[faces].mean(axis=1),axis=1)>0))
        self.assertTrue(np.all(np.sum((vertices-vertices.mean(axis=0))*normals,axis=1)>0))
        self.assertGreater(descriptor['triangleCount'],0)
        self.assertIsNone(preview_mesh(labels,5,source()))
    def test_streaming_restoration_matches_official_pipeline(self):
        import functools
        import torch
        from types import SimpleNamespace
        from nnunetv2.preprocessing.resampling.default_resampling import resample_data_or_seg_to_shape
        from nnunetv2.inference.export_prediction import convert_predicted_logits_to_segmentation_with_correct_shape
        from nnunetv2.utilities.label_handling.label_handling import LabelManager
        from export import restore_labels_streaming
        plans=SimpleNamespace(transpose_forward=[1,0,2],transpose_backward=[1,0,2])
        config=SimpleNamespace(spacing=[.7,.8,.9],resampling_fn_probabilities=functools.partial(resample_data_or_seg_to_shape,is_seg=False,order=1,order_z=0,force_separate_z=None))
        properties={'spacing':[.2,.3,.5],'shape_before_cropping':[12,14,16],
                    'shape_after_cropping_and_before_resampling':[10,12,14],
                    'bbox_used_for_cropping':[[1,11],[2,14],[1,15]]}
        manager=LabelManager({'background':0,**{str(i):i for i in range(1,6)}},None)
        for tied in [False,True]:
            data=torch.from_numpy(np.random.default_rng(7).normal(size=(6,5,7,4)).astype(np.float32))
            if tied:data[:]=0
            official=convert_predicted_logits_to_segmentation_with_correct_shape(data,plans,config,manager,properties,num_threads_torch=2)
            streamed=restore_labels_streaming(data,plans,config,properties)
            np.testing.assert_array_equal(streamed,official)
            self.assertEqual(streamed.shape,(14,12,16))
    def test_export_keeps_label_grid_and_source(self):
        import gzip,zlib
        labels=np.zeros((4,4,4),np.uint8);labels[1:3,1:3,1:3]=5
        with tempfile.TemporaryDirectory() as d:
            output=Path(d)/'result.odseg';m=export_result(labels,source(),output,{})
            data=output.read_bytes();size=struct.unpack('<I',data[8:12])[0]
            self.assertEqual(data[:8],b'ODSEG001');self.assertEqual(m['layers'][4]['voxels'],8)
            raw=gzip.decompress(data[12+size:12+size+m['labelsGzipBytes']])
            self.assertEqual(raw,labels.tobytes());self.assertEqual(zlib.crc32(raw),m['labelsCrc32'])

class ServerTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name)
        self.html=self.root/'app.html';self.html.write_text('<meta name="odonto-ai-token" content="">')
        self.runtime=Runtime(self.root,self.root/'runtime',self.html)
        self.server=ThreadingHTTPServer(('127.0.0.1',0),lambda *a:None)
        self.port=self.server.server_address[1];self.server.RequestHandlerClass=make_handler(self.runtime,self.port)
        self.thread=threading.Thread(target=self.server.serve_forever,daemon=True);self.thread.start()
    def tearDown(self):
        self.server.shutdown();self.server.server_close();self.runtime.close();self.temp.cleanup()
    def request(self,path,headers=None,method='GET'):
        return urllib.request.urlopen(urllib.request.Request(f'http://127.0.0.1:{self.port}'+path,headers=headers or {},method=method))
    def test_loopback_token_and_origin(self):
        with self.request('/') as response:self.assertIn(self.runtime.token,response.read().decode())
        for headers in [{},{'X-Odonto-Token':self.runtime.token,'Origin':'https://example.com'},{'Host':'attacker.test','X-Odonto-Token':self.runtime.token}]:
            with self.assertRaises(urllib.error.HTTPError) as e:self.request('/api/health',headers)
            self.assertEqual(e.exception.code,403)
        with self.request('/api/health',{'X-Odonto-Token':self.runtime.token}) as r:self.assertFalse(json.load(r)['ready'])
    def test_running_worker_cancels_and_removes_temporary_case(self):
        job=self.runtime.reserve();log=(job['directory']/'engine.log').open('wb')
        proc=subprocess.Popen([sys.executable,'-c','import time;time.sleep(30)'],stdout=log,stderr=log)
        job.update(state='running',process=proc)
        monitor=threading.Thread(target=self.runtime.monitor,args=(job,log));monitor.start()
        self.runtime.cancel(job);monitor.join(timeout=10)
        self.assertFalse(monitor.is_alive());self.assertEqual(job['state'],'cancelled')
        self.assertIsNotNone(proc.poll());self.assertFalse(job['directory'].exists())
    def test_single_job_and_cancel(self):
        job=self.runtime.reserve()
        with self.assertRaises(RuntimeError): self.runtime.reserve()
        self.runtime.cancel(job);self.assertEqual(job['state'],'cancelling')
        self.runtime.close();self.assertFalse(job['directory'].exists())

if __name__=='__main__': unittest.main()
