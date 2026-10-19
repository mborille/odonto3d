import {getDocument,GlobalWorkerOptions,ImageKind,OPS,Util} from 'pdfjs-dist/build/pdf.mjs';
import workerSource from 'embedded-pdf-worker';
import assets from 'embedded-pdf-assets';
import {buildLaminaVolume,findConsecutiveRun,selectRepeatedImageGroup,TARGET_HEIGHT,TARGET_WIDTH} from './lamina-core.js';

const MAX_PDF_BYTES=100*1024**2,MAX_IMAGES=240;

class LocalBinaryDataFactory {
  async fetch({kind,filename}) {
    const value=assets[kind+'/'+filename];
    if(!value)throw new Error('Recurso PDF não disponível nesta versão: '+filename);
    const raw=atob(value),bytes=new Uint8Array(raw.length);
    for(let i=0;i<raw.length;i++)bytes[i]=raw.charCodeAt(i);
    return bytes;
  }
}

const natural=(a,b)=>a.localeCompare(b,'pt-BR',{numeric:true,sensitivity:'base'});
const median=values=>{const sorted=values.filter(Number.isFinite).sort((a,b)=>a-b);return sorted.length?sorted[Math.floor(sorted.length/2)]:NaN;};
const timed=async(promise,ms,message)=>{let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(message)),ms);})]);}finally{clearTimeout(timer);}};

function grayFromCanvas(source,sx=0,sy=0,sw=source.width,sh=source.height) {
  const canvas=document.createElement('canvas');canvas.width=TARGET_WIDTH;canvas.height=TARGET_HEIGHT;
  const ctx=canvas.getContext('2d',{alpha:false,willReadFrequently:true});ctx.fillStyle='#000';ctx.fillRect(0,0,TARGET_WIDTH,TARGET_HEIGHT);ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';ctx.drawImage(source,sx,sy,sw,sh,0,0,TARGET_WIDTH,TARGET_HEIGHT);
  const rgba=ctx.getImageData(0,0,TARGET_WIDTH,TARGET_HEIGHT).data,gray=new Uint8Array(TARGET_WIDTH*TARGET_HEIGHT);let nonDark=0;
  for(let i=0,j=0;i<rgba.length;i+=4,j++){const value=Math.round(rgba[i]*.299+rgba[i+1]*.587+rgba[i+2]*.114);gray[j]=value;if(value>12)nonDark++;}
  return {gray,nonDark};
}

function canvasFromPdfImage(image) {
  const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;const ctx=canvas.getContext('2d',{alpha:false});
  if(image.bitmap){ctx.drawImage(image.bitmap,0,0);return canvas;}
  if(!image.data)throw new Error('Imagem incorporada sem pixels acessíveis.');
  const rgba=new Uint8ClampedArray(image.width*image.height*4),data=image.data;
  if(image.kind===ImageKind.RGBA_32BPP||data.length===rgba.length)rgba.set(data);
  else if(image.kind===ImageKind.RGB_24BPP||data.length===image.width*image.height*3){for(let s=0,d=0;s<data.length;s+=3,d+=4){rgba[d]=data[s];rgba[d+1]=data[s+1];rgba[d+2]=data[s+2];rgba[d+3]=255;}}
  else if(image.kind===ImageKind.GRAYSCALE_1BPP){for(let p=0;p<image.width*image.height;p++){const value=data[p>>3]&(128>>(p&7))?255:0,at=p*4;rgba[at]=rgba[at+1]=rgba[at+2]=value;rgba[at+3]=255;}}
  else throw new Error('Formato de imagem incorporada não suportado.');
  ctx.putImageData(new ImageData(rgba,image.width,image.height),0,0);return canvas;
}

function objectFor(page,id) {
  const store=String(id).startsWith('g_')?page.commonObjs:page.objs;
  if(store.has(id))return Promise.resolve(store.get(id));
  return timed(new Promise(resolve=>store.get(id,resolve)),10000,'Tempo excedido ao extrair uma lâmina do PDF.');
}

async function inspectPage(page,pageIndex) {
  const [operators,text]=await Promise.all([page.getOperatorList(),page.getTextContent()]);
  const labels=findConsecutiveRun(text.items.map(item=>item.str));
  const images=[],stack=[];let matrix=[1,0,0,1,0,0],order=0;
  for(let i=0;i<operators.fnArray.length;i++){
    const fn=operators.fnArray[i],args=operators.argsArray[i];
    if(fn===OPS.save){stack.push([...matrix]);continue;}
    if(fn===OPS.restore){matrix=stack.pop()||[1,0,0,1,0,0];continue;}
    if(fn===OPS.transform){matrix=Util.transform(matrix,args);continue;}
    let image=null,id=null;
    if(fn===OPS.paintImageXObject){id=args[0];image=await objectFor(page,id);}
    else if(fn===OPS.paintInlineImageXObject)image=args[0];
    if(!image?.width||!image?.height)continue;
    images.push({pageIndex,order:order++,id,image,width:image.width,height:image.height,matrix:[...matrix],displayWidthPt:Math.hypot(matrix[0],matrix[1]),displayHeightPt:Math.hypot(matrix[2],matrix[3])});
  }
  return {images,labels};
}

function orderOnPage(a,b) {
  const ay=a.matrix[5],by=b.matrix[5];
  return Math.abs(ay-by)>2?by-ay:a.matrix[4]-b.matrix[4];
}

async function openPdf(file,progress) {
  if(file.size>MAX_PDF_BYTES)throw new Error('Limite do PDF: 100 MB.');
  const workerUrl=URL.createObjectURL(new Blob([workerSource],{type:'text/javascript'})),worker=new Worker(workerUrl);let task=null;
  try{
    await timed(new Promise((resolve,reject)=>{worker.addEventListener('message',event=>{if(event.data?.action==='ready')resolve();});worker.addEventListener('error',()=>reject(new Error('O navegador não conseguiu iniciar o leitor PDF.')),{once:true});}),10000,'Tempo excedido ao iniciar o leitor PDF.');
    GlobalWorkerOptions.workerPort=worker;
    const data=new Uint8Array(await file.arrayBuffer());task=getDocument({data,useWorkerFetch:false,BinaryDataFactory:LocalBinaryDataFactory,useWasm:true,isEvalSupported:false,stopAtErrors:true,enableXfa:false,maxImageSize:64e6,canvasMaxAreaInBytes:128e6});
    const passwordFailure=new Promise((_,reject)=>{task.onPassword=()=>reject(new Error('PDF protegido por senha.'));});
    const document=await timed(Promise.race([task.promise,passwordFailure]),30000,'Tempo excedido ao abrir o PDF.');
    const records=[],pageLabels=new Map();
    for(let number=1;number<=document.numPages;number++){
      progress?.(`Analisando página ${number} de ${document.numPages}…`);const page=await document.getPage(number),result=await inspectPage(page,number-1);records.push(...result.images.map(({image,...rest})=>rest));pageLabels.set(number-1,result.labels);page.cleanup();
    }
    const group=selectRepeatedImageGroup(records);
    if(!group)throw new Error('Não encontrei uma sequência repetida de lâminas transversais neste PDF.');
    if(group.items.length>MAX_IMAGES)throw new Error(`Foram encontradas ${group.items.length} imagens; o limite desta versão é ${MAX_IMAGES}.`);
    const selectedKey=group.key,frames=[],labels=[],displayWidths=[],displayHeights=[];
    for(let number=1;number<=document.numPages;number++){
      const wanted=records.filter(item=>item.pageIndex===number-1&&item.width+'x'+item.height===selectedKey).sort(orderOnPage);if(!wanted.length)continue;
      progress?.(`Extraindo lâminas da página ${number} de ${document.numPages}…`);const page=await document.getPage(number),fresh=await inspectPage(page,number-1),available=fresh.images.filter(item=>item.width+'x'+item.height===selectedKey).sort(orderOnPage),run=pageLabels.get(number-1)||[];
      for(let i=0;i<available.length;i++){
        const item=available[i],canvas=canvasFromPdfImage(item.image),result=grayFromCanvas(canvas);frames.push(result.gray);labels.push(run[i]??labels.length+1);displayWidths.push(item.displayWidthPt);displayHeights.push(item.displayHeightPt);
      }
      page.cleanup();
    }
    if(frames.length<8)throw new Error('As imagens foram encontradas, mas não puderam ser extraídas em sequência.');
    const widthMM=median(displayWidths)*25.4/72,heightMM=median(displayHeights)*25.4/72;
    return {frames,labels,widthMM:widthMM>=8&&widthMM<=80?widthMM:28,heightMM:heightMM>=12&&heightMM<=100?heightMM:40,sourceType:'PDF',pageCount:document.numPages};
  } finally {
    try{await task?.destroy();}catch{}GlobalWorkerOptions.workerPort=null;worker.terminate();URL.revokeObjectURL(workerUrl);
  }
}

async function bitmapFor(file){return timed(createImageBitmap(file),15000,'Não foi possível ler a imagem '+file.name+'.');}

function cropMontage(bitmap) {
  const frames=[];const x0=.018*bitmap.width,y0=.424*bitmap.height,totalW=.962*bitmap.width,cellW=totalW/7,cellH=.1365*bitmap.height;
  for(let row=0;row<4;row++)for(let col=0;col<7;col++){
    const result=grayFromCanvas(bitmap,x0+col*cellW,y0+row*cellH,cellW,cellH);
    if(result.nonDark>TARGET_WIDTH*TARGET_HEIGHT*.055)frames.push(result.gray);
  }
  return frames;
}

async function openImages(files,progress) {
  const sorted=[...files].sort((a,b)=>natural(a.name,b.name));if(sorted.length>MAX_IMAGES)throw new Error(`O limite desta versão é ${MAX_IMAGES} imagens.`);
  const frames=[],labels=[];let montage=false;
  for(let i=0;i<sorted.length;i++){
    progress?.(`Lendo imagem ${i+1} de ${sorted.length}…`);const bitmap=await bitmapFor(sorted[i]);
    try{
      const pageLike=bitmap.width>=900&&bitmap.height/bitmap.width>1.25&&bitmap.height/bitmap.width<1.65;
      if(pageLike){const found=cropMontage(bitmap);if(found.length>=6){montage=true;frames.push(...found);continue;}}
      frames.push(grayFromCanvas(bitmap).gray);
    } finally {bitmap.close();}
  }
  for(let i=0;i<frames.length;i++)labels.push(i+1);
  if(frames.length<3)throw new Error('Selecione ao menos três lâminas JPG ou uma prancha compatível.');
  return {frames,labels,widthMM:28,heightMM:40,sourceType:montage?'JPG em pranchas':'JPG individuais',pageCount:sorted.length};
}

export async function importLaminaFiles(files,progress) {
  const chosen=[...files];if(!chosen.length)throw new Error('Selecione um PDF ou imagens JPG.');
  const pdfs=chosen.filter(file=>file.type==='application/pdf'||/\.pdf$/i.test(file.name));
  if(pdfs.length){if(chosen.length!==1)throw new Error('Selecione um PDF por vez, sem misturar com imagens JPG.');const result=await openPdf(pdfs[0],progress);return buildLaminaVolume(result.frames,result.labels,{...result,sourceName:pdfs[0].name});}
  if(chosen.some(file=>!/^image\/jpe?g$/i.test(file.type)&&!/\.jpe?g$/i.test(file.name)))throw new Error('Esta opção aceita PDF, JPG e JPEG.');
  const result=await openImages(chosen,progress);return buildLaminaVolume(result.frames,result.labels,{...result,sourceName:chosen.length===1?chosen[0].name:`${chosen.length} imagens`});
}
