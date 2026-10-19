import test from 'node:test';
import assert from 'node:assert/strict';
import {gzipSync} from 'fflate';
import {crc32} from '../src/archive.js';
import {fingerprint,volumeSource,volumePacket,parseSegmentation,segmentationBlob,LAYERS} from '../src/segmentation.js';
const volume={dimensions:[4,4,4],spacing:[.2,.3,.4],origin:[-3,5,9],scalarSlope:1,scalarIntercept:-1000,data:new Uint16Array(64)};
function fixture(digest,mutate=()=>{}){
 const labels=new Uint8Array(64);labels.fill(1,0,12);labels.fill(5,12,18);const compressed=gzipSync(labels);
 const m={format:'odonto-seg',version:1,source:volumeSource(volume,digest),model:{id:'Dataset112_DentalSegmentator_v100'},reviewed:false,labelsGzipBytes:compressed.length,labelsCrc32:crc32(labels),layers:LAYERS.map(a=>({...a,voxels:labels.filter(n=>n===a.id).length})),meshes:[]};mutate(m,compressed);
 const h=new TextEncoder().encode(JSON.stringify(m)),bytes=new Uint8Array(12+h.length+compressed.length);bytes.set(new TextEncoder().encode('ODSEG001'));new DataView(bytes.buffer).setUint32(8,h.length,true);bytes.set(h,12);bytes.set(compressed,12+h.length);return bytes;
}
test('segmentation preserves full labels and roundtrips presentation preferences',async()=>{
 const hash=await fingerprint(volume),seg=parseSegmentation(fixture(hash),volume,hash);
 assert.equal(seg.labels.length,64);assert.equal(seg.layers[4].voxels,6);assert.equal(seg.layers[1].visible,false);
 seg.layers[0].color='#123456';seg.layers[0].visible=false;seg.overlayOpacity=.7;
 const restored=parseSegmentation(new Uint8Array(await segmentationBlob(seg).arrayBuffer()),volume,hash);
 assert.equal(restored.layers[0].color,'#123456');assert.equal(restored.layers[0].visible,false);assert.equal(restored.overlayOpacity,.7);assert.deepEqual(restored.labels,seg.labels);
});
test('segmentation rejects wrong volume, spatial origin and affine',async()=>{
 const hash=await fingerprint(volume),bytes=fixture(hash);
 for(const changed of [{...volume,origin:[0,0,0]},{...volume,scalarIntercept:0},{...volume,spacing:[.4,.3,.2]}])assert.throws(()=>parseSegmentation(bytes,changed,hash),/não pertence/);
 assert.throws(()=>parseSegmentation(bytes,volume,'a'.repeat(64)),/não pertence/);
});
test('segmentation rejects corrupted label maps, counts, preferences and trailing bytes',async()=>{
 const hash=await fingerprint(volume);
 for(const mutate of [m=>m.labelsCrc32=0,m=>m.layers[0].voxels=999,m=>m.preferences={},m=>m.model.id='unknown',m=>m.labelsGzipBytes=9999])assert.throws(()=>parseSegmentation(fixture(hash,mutate),volume,hash));
 const original=fixture(hash),extended=new Uint8Array(original.length+1);extended.set(original);assert.throws(()=>parseSegmentation(extended,volume,hash),/inconsistente/);
});
test('volume upload contains exact typed pixels and geometry only',async()=>{
 const hash=await fingerprint(volume),bytes=new Uint8Array(await volumePacket({...volume,PatientName:'SYNTHETIC'},hash).arrayBuffer()),size=new DataView(bytes.buffer).getUint32(8,true);
 const meta=JSON.parse(new TextDecoder().decode(bytes.subarray(12,12+size)));
 assert.equal(meta.PatientName,undefined);assert.deepEqual(meta.dimensions,volume.dimensions);assert.equal(meta.digest,hash);assert.deepEqual(bytes.subarray(12+size),new Uint8Array(volume.data.buffer));
});
