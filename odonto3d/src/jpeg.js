import {Decoder} from 'jpeg-lossless-decoder-js';

// A single-frame encapsulated Pixel Data element: offset table, fragments, delimiter.
export function extractJpeg(bytes, pixel) {
  if(!pixel?.hadUndefinedLength) throw new Error('JPEG DICOM sem encapsulamento válido.');
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  let p=pixel.dataOffset,total=0;const parts=[];
  const item=()=>{if(p+8>bytes.length)throw new Error('Fragmentos JPEG incompletos.');const tag=view.getUint32(p,true),length=view.getUint32(p+4,true);p+=8;return {tag,length};};
  const table=item();if(table.tag!==0xe000fffe || ![0,4].includes(table.length) || p+table.length>bytes.length)throw new Error('Tabela de quadros JPEG inválida.');
  if(table.length===4 && view.getUint32(p,true)!==0)throw new Error('Deslocamento do primeiro quadro JPEG inválido.');p+=table.length;
  while(true){const {tag,length}=item();if(tag===0xe0ddfffe){if(length!==0)throw new Error('Delimitador JPEG inválido.');break;}
    if(tag!==0xe000fffe || length===0xffffffff || p+length>bytes.length)throw new Error('Fragmento JPEG inválido ou truncado.');
    total+=length;if(total>64*1024*1024)throw new Error('Quadro JPEG excede o limite de memória.');parts.push(bytes.subarray(p,p+length));p+=length;
  }
  if(!parts.length)throw new Error('Quadro JPEG vazio.');
  const data=new Uint8Array(total);let offset=0;for(const part of parts){data.set(part,offset);offset+=part.length;}return data;
}

export function validateJpeg(data, slice) {
  if(data[0]!==255||data[1]!==216)throw new Error('Assinatura JPEG inválida.');
  let tail=data.length-1;while(data[tail]===0)tail--;
  if(data[tail]!==217||data[tail-1]!==255)throw new Error('Quadro JPEG incompleto.');
  let p=2,found=false;
  while(p+4<data.length){
    if(data[p++]!==255)throw new Error('Marcador JPEG inválido.');while(data[p]===255)p++;
    const marker=data[p++],length=(data[p]<<8)|data[p+1];
    if(length<2||p+length>data.length)throw new Error('Cabeçalho JPEG truncado.');
    if(marker===195){
      if(length<11)throw new Error('Cabeçalho JPEG Lossless inválido.');
      const precision=data[p+2],rows=(data[p+3]<<8)|data[p+4],cols=(data[p+5]<<8)|data[p+6],components=data[p+7];
      if(rows!==slice.rows||cols!==slice.cols||components!==1||precision<2||precision>slice.stored)throw new Error('Geometria ou precisão JPEG incompatível com o DICOM.');found=true;
    }else if(marker>=192&&marker<=207&&![196,200,204].includes(marker))throw new Error('O quadro não usa JPEG Lossless suportado.');
    if(marker===218){if(!found||length<8||data[p+2]!==1||data[p+5]!==1)throw new Error('JPEG Lossless com predição não suportada.');return;}
    p+=length;
  }
  throw new Error('Cabeçalho JPEG Lossless ausente.');
}

export function decodeJpeg(slice) {
  validateJpeg(slice.jpeg,slice);
  const decoder=new Decoder();let pixels;
  try{pixels=decoder.decode(slice.jpeg.buffer,slice.jpeg.byteOffset,slice.jpeg.byteLength,slice.bits/8);}catch{throw new Error('Falha na descompressão JPEG sem perda.');}
  if(decoder.xDim!==slice.cols||decoder.yDim!==slice.rows||decoder.numComp!==1||pixels.length!==slice.cols*slice.rows)throw new Error('Dimensões do quadro JPEG decodificado são inconsistentes.');
  return pixels;
}
