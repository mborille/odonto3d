import {gunzipSync} from 'fflate';
import {crc32} from './archive.js';

export const LAYERS=[
  {id:1,name:'Maxila / crânio superior',color:'#e8bc83'},
  {id:2,name:'Mandíbula',color:'#78aaff'},
  {id:3,name:'Dentes superiores',color:'#76e0cc'},
  {id:4,name:'Dentes inferiores',color:'#d3a3f2'},
  {id:5,name:'Canal mandibular',color:'#ff8076'},
];
const MODEL='Dataset112_DentalSegmentator_v100',fingerprints=new WeakMap();
export function volumeSource(v,digest){return {dimensions:v.dimensions,spacing:v.spacing,origin:v.origin,dtype:v.data instanceof Uint16Array?'uint16':v.data instanceof Int16Array?'int16':'float32',scalarSlope:v.scalarSlope??1,scalarIntercept:v.scalarIntercept??0,digest};}
export async function fingerprint(v){
  if(!fingerprints.has(v))fingerprints.set(v,crypto.subtle.digest('SHA-256',new Uint8Array(v.data.buffer,v.data.byteOffset,v.data.byteLength)).then(b=>[...new Uint8Array(b)].map(n=>n.toString(16).padStart(2,'0')).join('')));
  return fingerprints.get(v);
}
export function volumePacket(v,digest){
  const header=new TextEncoder().encode(JSON.stringify(volumeSource(v,digest))),prefix=new Uint8Array(12);
  prefix.set(new TextEncoder().encode('ODVOX001'));new DataView(prefix.buffer).setUint32(8,header.length,true);
  return new Blob([prefix,header,new Uint8Array(v.data.buffer,v.data.byteOffset,v.data.byteLength)],{type:'application/octet-stream'});
}
export function sourceMatches(source,v,digest){
  const expected=volumeSource(v,digest);
  return source&&source.digest===digest&&source.dtype===expected.dtype&&source.scalarSlope===expected.scalarSlope&&source.scalarIntercept===expected.scalarIntercept&&['dimensions','spacing','origin'].every(key=>Array.isArray(source[key])&&source[key].length===3&&source[key].every((n,i)=>Number.isFinite(n)&&Math.abs(n-expected[key][i])<1e-6));
}
export function rgb(color){if(!/^#[0-9a-f]{6}$/i.test(color))throw new Error('Cor inválida.');return [1,3,5].map(i=>parseInt(color.slice(i,i+2),16));}
export function parseSegmentation(bytes,v,digest){
  if(!(bytes instanceof Uint8Array)||bytes.length<16||bytes.length>192*1024**2)throw new Error('Arquivo de segmentação inválido ou muito grande.');
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),decoder=new TextDecoder();
  if(decoder.decode(bytes.subarray(0,8))!=='ODSEG001')throw new Error('Formato de segmentação não reconhecido.');
  const size=view.getUint32(8,true);if(size<1||size>16384||12+size>=bytes.length)throw new Error('Cabeçalho de segmentação inválido.');
  let m;try{m=JSON.parse(decoder.decode(bytes.subarray(12,12+size)));}catch{throw new Error('Cabeçalho de segmentação corrompido.');}
  if(m.format!=='odonto-seg'||m.version!==1||m.model?.id!==MODEL||m.reviewed!==false)throw new Error('Versão ou modelo de segmentação incompatível.');
  if(!sourceMatches(m.source,v,digest))throw new Error('Esta segmentação não pertence ao volume aberto. Importe o DICOM correspondente.');
  const count=v.data.length,gzSize=m.labelsGzipBytes;let offset=12+size;
  if(!Number.isSafeInteger(gzSize)||gzSize<18||offset+gzSize>bytes.length||count>134217728||view.getUint32(offset+gzSize-4,true)!==count)throw new Error('Mapa de estruturas incompleto ou incompatível.');
  const labels=gunzipSync(bytes.subarray(offset,offset+gzSize),{out:new Uint8Array(count)});offset+=gzSize;
  if(labels.length!==count||crc32(labels)!==m.labelsCrc32)throw new Error('A integridade da segmentação não confere.');
  const counts=[0,0,0,0,0,0];for(const n of labels){if(n>5)throw new Error('A segmentação contém classes desconhecidas.');counts[n]++;}
  if(!Array.isArray(m.layers)||m.layers.length!==5||m.layers.some((a,i)=>a.id!==i+1||a.voxels!==counts[i+1]))throw new Error('Contagem de estruturas inconsistente.');
  const prefs=m.preferences;
  if(prefs&&(!Array.isArray(prefs.layers)||prefs.layers.length!==5||prefs.layers.some((a,i)=>a.id!==i+1||!/^#[0-9a-f]{6}$/i.test(a.color)||typeof a.visible!=='boolean')||!Number.isFinite(prefs.overlayOpacity)||prefs.overlayOpacity<.1||prefs.overlayOpacity>.8||['showOverlay','showSurfaces','showOriginal'].some(k=>typeof prefs[k]!=='boolean')))throw new Error('Ajustes de cor inválidos.');
  const layers=LAYERS.map((a,i)=>{const p=prefs?.layers[i]||a;return {...a,voxels:counts[a.id],color:p.color,visible:counts[a.id]>0&&(p.visible??true),rgb:rgb(p.color)};});
  if(!Array.isArray(m.meshes)||m.meshes.length>5)throw new Error('Superfícies de segmentação inválidas.');
  const ids=new Set();let verticesTotal=0,trianglesTotal=0;
  const meshes=m.meshes.map(mesh=>{
    const {id,vertexCount:n,triangleCount:t}=mesh;
    if(!Number.isSafeInteger(id)||id<1||id>5||ids.has(id)||!Number.isSafeInteger(n)||n<1||n>500000||!Number.isSafeInteger(t)||t<1||t>1000000||!counts[id])throw new Error('Dimensões de superfície inválidas.');
    ids.add(id);verticesTotal+=n;trianglesTotal+=t;
    if(verticesTotal>2500000||trianglesTotal>5000000)throw new Error('As superfícies excedem o limite de memória.');
    const take=(Type,length)=>{const end=offset+length*4;if(end>bytes.length)throw new Error('Superfície truncada.');const array=new Type(bytes.slice(offset,end).buffer);offset=end;return array;};
    const points=take(Float32Array,n*3),normals=take(Float32Array,n*3),triangles=take(Uint32Array,t*3);
    for(let i=0;i<points.length;i++){
      const axis=i%3,lo=v.origin[axis]-v.spacing[axis]*16,hi=v.origin[axis]+(v.dimensions[axis]+16)*v.spacing[axis];
      if(!Number.isFinite(points[i])||points[i]<lo||points[i]>hi||!Number.isFinite(normals[i])||Math.abs(normals[i])>1.01)throw new Error('Coordenadas de superfície inválidas.');
    }
    if(triangles.some(i=>i>=n))throw new Error('Índices de superfície inválidos.');
    return {id,points,normals,triangles};
  });
  if(offset!==bytes.length)throw new Error('Tamanho do arquivo de segmentação inconsistente.');
  return {labels,layers,meshes,manifest:m,bytes,overlayOpacity:prefs?.overlayOpacity??.4,showOverlay:prefs?.showOverlay??true,showSurfaces:prefs?.showSurfaces??true,showOriginal:prefs?.showOriginal??!meshes.length};
}

export function segmentationBlob(seg){
  const m={...seg.manifest,preferences:{layers:seg.layers.map(({id,color,visible})=>({id,color,visible})),overlayOpacity:seg.overlayOpacity,showOverlay:seg.showOverlay,showSurfaces:seg.showSurfaces,showOriginal:seg.showOriginal}};
  const header=new TextEncoder().encode(JSON.stringify(m)),prefix=new Uint8Array(12);prefix.set(new TextEncoder().encode('ODSEG001'));new DataView(prefix.buffer).setUint32(8,header.length,true);
  const size=new DataView(seg.bytes.buffer,seg.bytes.byteOffset,seg.bytes.byteLength).getUint32(8,true);
  return new Blob([prefix,header,seg.bytes.subarray(12+size)],{type:'application/octet-stream'});
}

export function createAiClient(){
  const token=document.querySelector('meta[name="odonto-ai-token"]')?.content;
  let jobId=null,abort=null,cancelled=false;
  const available=Boolean(token)&&location.hostname==='127.0.0.1';
  async function request(path,options={}){
    const response=await fetch(path,{...options,headers:{'X-Odonto-Token':token,...options.headers}});
    if(!response.ok){let message='Falha no serviço de IA local.';try{message=(await response.json()).error||message;}catch{}throw new Error(message);}return response;
  }
  return {
    available,
    async health(){if(!available)return {ready:false};const state=await (await request('/api/health')).json();if(state.activeJob)jobId=state.activeJob.id;return state;},
    async run(v,progress){
      if(!available)throw new Error('Abra o aplicativo pelo arquivo “Abrir Odonto3D com IA.command”.');
      cancelled=false;abort=new AbortController();
      const digest=await fingerprint(v);if(cancelled)throw new Error('Segmentação cancelada.');
      jobId=[...crypto.getRandomValues(new Uint8Array(16))].map(n=>n.toString(16).padStart(2,'0')).join('');
      const id=jobId;
      try{
        progress({detail:'Enviando o volume ao serviço neste computador…'});
        await request('/api/jobs',{method:'POST',headers:{'Content-Type':'application/octet-stream','X-Odonto-Request':id},body:volumePacket(v,digest),signal:abort.signal});
        while(!cancelled){
          const state=await (await request('/api/jobs/'+id,{signal:abort.signal})).json();progress(state);
          if(state.state==='complete'){
            const bytes=new Uint8Array(await (await request('/api/jobs/'+id+'/result',{signal:abort.signal})).arrayBuffer());
            if(cancelled)throw new Error('Segmentação cancelada.');
            progress({detail:'Conferindo o resultado e preparando as cores…'});
            await new Promise(r=>setTimeout(r,30));return parseSegmentation(bytes,v,digest);
          }
          if(['error','cancelled','expired'].includes(state.state))throw new Error(state.error||'Segmentação cancelada ou expirada.');
          await new Promise(r=>setTimeout(r,1500));
        }
        throw new Error('Segmentação cancelada.');
      }catch(e){if(cancelled||e.name==='AbortError')throw new Error('Segmentação cancelada.');throw e;}
      finally{if(jobId===id)jobId=null;abort=null;}
    },
    async cancel(){cancelled=true;abort?.abort();if(jobId)try{await request('/api/jobs/'+jobId+'/cancel',{method:'POST'});}catch{}},
  };
}
