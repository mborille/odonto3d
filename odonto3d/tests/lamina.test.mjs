import test from 'node:test';
import assert from 'node:assert/strict';
import {buildLaminaVolume,findConsecutiveRun,selectRepeatedImageGroup,TARGET_HEIGHT,TARGET_WIDTH} from '../src/lamina-core.js';

test('identifica a maior sequência numérica entre textos do relatório',()=>{
  assert.deepEqual(findConsecutiveRun(['04','02','2026','20','25','18','19','20','21','22','23','24']),[18,19,20,21,22,23,24,25]);
  assert.deepEqual(findConsecutiveRun(['1','3','5']),[]);
});

test('seleciona o grupo repetido de imagens transversais',()=>{
  const images=[...Array(28)].map((_,order)=>({width:661,height:931,order}));
  images.push({width:1561,height:1561},{width:3172,height:2182},{width:1329,height:630});
  const group=selectRepeatedImageGroup(images);
  assert.equal(group.key,'661x931');assert.equal(group.items.length,28);
});

test('remonta a sequência e preserva a ordem das lâminas',()=>{
  const frames=[10,80,200].map(value=>new Uint8Array(TARGET_WIDTH*TARGET_HEIGHT).fill(value));
  const volume=buildLaminaVolume(frames,[18,19,20],{widthMM:28,heightMM:40,sliceSpacing:1});
  assert.deepEqual(volume.dimensions,[128,3,180]);assert.deepEqual(volume.sliceLabels,[18,19,20]);assert.equal(volume.lamina,true);assert.equal(volume.estimated,true);
  assert.equal(volume.data[0],10);assert.equal(volume.data[128],80);assert.equal(volume.data[256],200);
  assert.ok(volume.renderVolume.data.some(value=>value===200));assert.equal(volume.renderVolume.dimensions[2],180);
});
