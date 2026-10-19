import dicomParser from 'dicom-parser';
import {extractJpeg,validateJpeg,decodeJpeg} from './jpeg.js';

const SUPPORTED = new Set(['1.2.840.10008.1.2', '1.2.840.10008.1.2.1','1.2.840.10008.1.2.4.70']);
const near = (a, b, t = 1e-4) => Math.abs(a - b) <= t;
const numbers = (s, count) => {
  const v = (s || '').split('\\').map(v => v.trim() === '' ? NaN : Number(v));
  if (v.length !== count || v.some(n => !Number.isFinite(n))) throw new Error('Metadados geométricos ausentes ou inválidos.');
  return v;
};
const numberOr = (s, fallback) => s === undefined || s.trim() === '' ? fallback : Number(s.split('\\')[0]);

export function parseSlice(bytes) {
  const ds = dicomParser.parseDicom(bytes, { untilTag: 'x7fe00010' });
  const str = tag => ds.string(tag)?.trim();
  const uid = str('x0020000e');
  if (!uid) throw new Error('Arquivo sem identificação de série DICOM.');
  const slice = { uid, bytes, description: str('x0008103e') || 'Série de tomografia', modality: str('x00080060'), error: null };
  try {
    slice.transfer=str('x00020010');
    if (!SUPPORTED.has(slice.transfer)) throw new Error('Compressão ou codificação ainda não suportada. Exporte DICOM sem compressão, Little Endian.');
    if (slice.modality !== 'CT') throw new Error('Esta versão aceita séries de tomografia com modalidade CT.');
    if (numberOr(str('x00280008'), 1) !== 1) throw new Error('DICOM multiframe ainda não suportado. Exporte uma imagem por arquivo.');
    if (str('x00102210') && str('x00102210') !== 'BIPED') throw new Error('Orientação anatômica não suportada.');
    if (str('x00282110') === '01') throw new Error('Imagens com histórico de compressão com perdas não são aceitas.');
    if (str('x00280004') !== 'MONOCHROME2' || ds.uint16('x00280002') !== 1) throw new Error('A série deve ser monocromática MONOCHROME2.');
    slice.rows = ds.uint16('x00280010'); slice.cols = ds.uint16('x00280011');
    slice.bits = ds.uint16('x00280100'); slice.stored = ds.uint16('x00280101');
    slice.high = ds.uint16('x00280102'); slice.signed = ds.uint16('x00280103');
    if (![8,16].includes(slice.bits) || ![0,1].includes(slice.signed) || !(slice.stored >= 1 && slice.stored <= slice.bits) || slice.high !== slice.stored - 1) throw new Error('Formato dos valores de pixel não suportado.');
    if (!(slice.rows > 0 && slice.cols > 0) || slice.rows*slice.cols>16*1024*1024) throw new Error('Dimensões da imagem inválidas.');
    slice.position = numbers(str('x00200032'), 3); slice.orientation = numbers(str('x00200037'), 6);
    slice.spacing = numbers(str('x00280030'), 2);
    if (slice.spacing.some(n => n <= 0)) throw new Error('Espaçamento de pixel inválido.');
    const o = slice.orientation;
    if (!near(Math.abs(o[0]),1,1e-5) || !near(Math.abs(o[4]),1,1e-5) || [o[1],o[2],o[3],o[5]].some(n=>!near(n,0,1e-5))) throw new Error('Série oblíqua ou não axial. Esta versão exige cortes axiais alinhados aos eixos do paciente.');
    slice.study = str('x0020000d'); slice.frame = str('x00200052'); slice.sop = str('x00080018');
    if (!slice.study || !slice.frame || !slice.sop) throw new Error('Identificadores de estudo, referencial ou imagem ausentes.');
    slice.slope = numberOr(str('x00281053'), 1); slice.intercept = numberOr(str('x00281052'), 0);
    if (!Number.isFinite(slice.slope) || slice.slope === 0 || !Number.isFinite(slice.intercept)) throw new Error('Transformação de intensidade inválida.');
    if (ds.elements.x00283000) throw new Error('Modality LUT ainda não suportada.');
    const pixel = ds.elements.x7fe00010;
    const expected = slice.rows * slice.cols * slice.bits / 8;
    if(slice.transfer==='1.2.840.10008.1.2.4.70'){
      slice.jpeg=extractJpeg(bytes,pixel);validateJpeg(slice.jpeg,slice);slice.bytes=null;
    }else{
      if (!pixel || pixel.hadUndefinedLength || pixel.length < expected || pixel.dataOffset + expected > bytes.length) throw new Error('Dados de pixel ausentes ou incompletos.');
      slice.offset = pixel.dataOffset;
    }
    slice.window = numberOr(str('x00281051'), NaN); slice.level = numberOr(str('x00281050'), NaN);
  } catch (error) { slice.error = error.message; }
  return slice;
}

export async function scanFiles(files, progress = () => {}) {
  if (files.length > 3000) throw new Error('Selecione até 3.000 arquivos por vez.');
  if (files.reduce((sum,f)=>sum+f.size,0) > 1024**3) throw new Error('Limite desta versão: 1 GB de arquivos por importação.');
  const groups = new Map(); let skipped = 0;
  for (let i=0;i<files.length;i++) {
    const file=files[i];
    if (file.name.toUpperCase() === 'DICOMDIR') { skipped++; continue; }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const signature = bytes.length >= 132 && String.fromCharCode(...bytes.subarray(128,132)) === 'DICM';
    if (!signature) {
      if (/\.dcm$/i.test(file.name)) throw new Error('Há um arquivo .dcm sem cabeçalho Part 10 válido. Importação interrompida.');
      skipped++; continue;
    }
    let slice;
    try { slice = parseSlice(bytes); } catch { throw new Error('Um arquivo DICOM não pôde ser lido. Importação interrompida para evitar uma série incompleta.'); }
    if (!groups.has(slice.uid)) groups.set(slice.uid, { uid:slice.uid, description:slice.description, slices:[] });
    groups.get(slice.uid).slices.push(slice);
    progress(i+1, files.length);
    if (i % 5 === 0) await new Promise(r=>setTimeout(r,0));
  }
  if (!groups.size) throw new Error('Nenhuma série DICOM Part 10 encontrada. Selecione a pasta original do exame, não fotos ou PDF.');
  return { groups:[...groups.values()], skipped };
}

function* volumeSteps(slices) {
  if (slices.length < 2) throw new Error('São necessários pelo menos dois cortes para reconstruir o volume.');
  const bad=slices.find(s=>s.error); if (bad) throw new Error(bad.error);
  const sorted=[...slices].sort((a,b)=>a.position[2]-b.position[2]);
  const first=sorted[0], {cols:nx, rows:ny}=first, nz=sorted.length;
  const uniform=slices.every(s=>s.slope===first.slope && s.intercept===first.intercept && s.signed===first.signed);
  const maxVoxels=(uniform?128:64)*1024*1024;
  if (nx*ny*nz > maxVoxels) throw new Error('Volume excede o limite de memória desta versão.');
  const sopIds=new Set();
  for (const s of sorted) {
    if (s.uid!==first.uid || s.study!==first.study || s.frame!==first.frame || s.rows!==ny || s.cols!==nx || s.orientation.some((n,i)=>!near(n,first.orientation[i],1e-5)) || s.spacing.some((n,i)=>!near(n,first.spacing[i],1e-5))) throw new Error('A série contém geometria ou identificadores inconsistentes.');
    if (!near(s.position[0], first.position[0],1e-3) || !near(s.position[1],first.position[1],1e-3)) throw new Error('Cortes deslocados entre si. Reamostragem ainda não suportada.');
    if (sopIds.has(s.sop)) throw new Error('Há imagens duplicadas na seleção.');
    sopIds.add(s.sop);
  }
  const dz=(sorted[nz-1].position[2]-first.position[2])/(nz-1);
  if (!(dz>0)) throw new Error('Cortes sobrepostos ou posição de corte inválida.');
  for (let i=1;i<nz;i++) if (!near(sorted[i].position[2]-sorted[i-1].position[2],dz,Math.max(.001,dz*.001))) throw new Error('Espaçamento irregular: pode haver cortes ausentes ou repetidos.');
  const flipX=first.orientation[0]<0, flipY=first.orientation[4]<0;
  const DataType=uniform?(first.signed?Int16Array:Uint16Array):Float32Array;
  const data=new DataType(nx*ny*nz); let min=Infinity,max=-Infinity;
  for(let z=0;z<nz;z++){
    const s=sorted[z],pixels=s.jpeg?decodeJpeg(s):null;
    const view=pixels?null:new DataView(s.bytes.buffer,s.bytes.byteOffset+s.offset,nx*ny*s.bits/8);
    const mask=2**s.stored-1, sign=2**(s.stored-1), range=2**s.stored;
    for(let y=0;y<ny;y++) for(let x=0;x<nx;x++) {
      const i=y*nx+x; let raw=(pixels?pixels[i]:(s.bits===16?view.getUint16(i*2,true):view.getUint8(i))) & mask;
      if(s.signed && raw>=sign)raw-=range;
      const value=raw*s.slope+s.intercept;
      if(!Number.isFinite(Math.fround(value)))throw new Error('Intensidades fora do intervalo suportado.');
      const xx=flipX?nx-1-x:x,yy=flipY?ny-1-y:y;
      data[(z*ny+yy)*nx+xx]=uniform?raw:value;min=Math.min(min,value);max=Math.max(max,value);
    }
    yield z+1;
  }
  if(!(max>min))throw new Error('O volume não contém contraste de intensidade.');
  return {data,dimensions:[nx,ny,nz],spacing:[first.spacing[1],first.spacing[0],dz],origin:[first.position[0]-(flipX?(nx-1)*first.spacing[1]:0),first.position[1]-(flipY?(ny-1)*first.spacing[0]:0),first.position[2]],min,max,window:first.window,level:first.level,scalarSlope:uniform?first.slope:1,scalarIntercept:uniform?first.intercept:0,demo:false};
}

export const voxelValue=(volume,index)=>volume.data[index]*(volume.scalarSlope??1)+(volume.scalarIntercept??0);
export function buildVolume(slices){const steps=volumeSteps(slices);let step;do{step=steps.next();}while(!step.done);return step.value;}
export async function buildVolumeAsync(slices,progress=()=>{}){
  const steps=volumeSteps(slices);let step;
  while(!(step=steps.next()).done){progress(step.value,slices.length);if(step.value%3===0)await new Promise(r=>setTimeout(r,0));}
  return step.value;
}
