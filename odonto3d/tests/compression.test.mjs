import test from 'node:test';import assert from 'node:assert/strict';import {zipSync} from 'fflate';
import {parseSlice,buildVolume,voxelValue,scanFiles} from '../src/dicom.js';import {unpackDicomZip,zipDirectory} from '../src/archive.js';
import {compressedDicomFixture,losslessFixture,dicomFixture} from './fixtures.mjs';
test('JPEG Lossless SV1 reconstructs known synthetic values and fragments',()=>{
 const slices=[parseSlice(compressedDicomFixture({z:0})),parseSlice(compressedDicomFixture({z:1,fragmented:true}))];assert.equal(slices[0].error,null);assert.equal(slices[1].error,null);
 const v=buildVolume(slices);assert.deepEqual([...v.data],[32768,32769,32767,32770,32768,32769,32767,32770]);assert.equal(voxelValue(v,2),-1);
});
test('JPEG truncated payload and conflicting dimensions are rejected',()=>{assert.match(parseSlice(compressedDicomFixture({jpeg:losslessFixture().subarray(0,25)})).error,/incompleto/);assert.match(parseSlice(compressedDicomFixture({cols:3})).error,/incompatível/);});
test('ZIP selects DICOM only, verifies CRC and preserves full series',async()=>{
 const bytes=zipSync({'folder/a.dcm':dicomFixture({z:0}),'folder/b.dcm':dicomFixture({z:1}),'folder/readme.xml':new Uint8Array([65]),'__MACOSX/._a.dcm':new Uint8Array([1])});
 const files=await unpackDicomZip(new File([bytes],'test.zip'));assert.equal(files.length,2);const result=await scanFiles(files);assert.equal(result.groups[0].slices.length,2);assert.equal(buildVolume(result.groups[0].slices).dimensions[2],2);
});
test('ZIP traversal and corrupt directory are rejected before decoding',()=>{assert.throws(()=>zipDirectory(zipSync({'../a.dcm':dicomFixture()})),/caminho/);assert.throws(()=>zipDirectory(new Uint8Array(40)),/ZIP/);});
test('ZIP CRC mismatch is rejected',async()=>{const bytes=zipSync({'a.dcm':dicomFixture()});const v=new DataView(bytes.buffer);for(let p=0;p<bytes.length-4;p++){if(v.getUint32(p,true)===0x02014b50){v.setUint32(p+16,0,true);break;}}await assert.rejects(()=>unpackDicomZip(new File([bytes],'bad.zip')),/integridade/);});
test('ZIP declared expansion is bounded before allocation',()=>{const bytes=zipSync({'a.dcm':dicomFixture()});const v=new DataView(bytes.buffer);for(let p=0;p<bytes.length-4;p++){if(v.getUint32(p,true)===0x02014b50){v.setUint32(p+24,0x7fffffff,true);break;}}assert.throws(()=>zipDirectory(bytes),/tamanho/);});
