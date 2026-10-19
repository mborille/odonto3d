import {inflateSync} from 'fflate';
const MiB=1024*1024,MAX_BYTES=1024*MiB;
const table=Uint32Array.from({length:256},(_,n)=>{for(let i=0;i<8;i++)n=(n&1)?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
export function crc32(bytes){let crc=0xffffffff;for(const byte of bytes)crc=table[(crc^byte)&255]^(crc>>>8);return (crc^0xffffffff)>>>0;}

// Validate the complete central directory before allocating decompressed buffers.
export function zipDirectory(bytes){
  const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),u16=p=>v.getUint16(p,true),u32=p=>v.getUint32(p,true);
  if(bytes.length<22||bytes.length>MAX_BYTES)throw new Error('ZIP inválido ou acima de 1 GB.');
  let end=bytes.length-22;
  while(end>=Math.max(0,bytes.length-65557)&&(u32(end)!==0x06054b50||end+22+u16(end+20)!==bytes.length))end--;
  if(end<Math.max(0,bytes.length-65557))throw new Error('ZIP incompleto ou inválido.');
  const count=u16(end+10),size=u32(end+12),start=u32(end+16);
  if(u16(end+4)||u16(end+6)||u16(end+8)!==count||count===65535||start===0xffffffff||size===0xffffffff)throw new Error('ZIP64 ou ZIP dividido em partes ainda não é suportado.');
  if(count>5000||start+size>end)throw new Error('Diretório ZIP inválido ou com arquivos demais.');
  let p=start,total=0;const entries=[],names=new Set();
  for(let i=0;i<count;i++){
    if(p+46>start+size||u32(p)!==0x02014b50)throw new Error('Diretório ZIP corrompido.');
    const flags=u16(p+8),method=u16(p+10),crc=u32(p+16),compressed=u32(p+20),original=u32(p+24),nameLength=u16(p+28),extra=u16(p+30),comment=u16(p+32),offset=u32(p+42);
    if(p+46+nameLength+extra+comment>start+size||u16(p+34))throw new Error('Entrada ZIP inválida.');
    const nameBytes=bytes.subarray(p+46,p+46+nameLength),name=new TextDecoder(flags&2048?'utf-8':'windows-1252').decode(nameBytes),parts=name.replaceAll('\\','/').split('/');
    if(name.includes('\0')||/^[\\/]|^[A-Za-z]:/.test(name)||parts.includes('..')||names.has(name))throw new Error('ZIP com caminho inválido ou entradas duplicadas.');names.add(name);
    if(flags&1)throw new Error('ZIP protegido por senha não é suportado.');
    const base=parts.at(-1),candidate=base&&!parts.includes('__MACOSX')&&!base.startsWith('.')&&base.toUpperCase()!=='DICOMDIR'&&(/\.dcm$/i.test(base)||!base.includes('.'));
    if(candidate){
      if(![0,8].includes(method)||original>64*MiB||original===0xffffffff||compressed===0xffffffff)throw new Error('Compressão ou tamanho de entrada ZIP não suportado.');
      total+=original;if(total>MAX_BYTES||entries.length>=3000)throw new Error('ZIP excede 1 GB descompactado ou 3.000 arquivos DICOM.');
      if(offset+30>start||u32(offset)!==0x04034b50||u16(offset+6)!==flags||u16(offset+8)!==method)throw new Error('Cabeçalho de arquivo ZIP inconsistente.');
      const localNameLength=u16(offset+26),dataOffset=offset+30+localNameLength+u16(offset+28);
      if(localNameLength!==nameLength||dataOffset+compressed>start||nameBytes.some((n,j)=>n!==bytes[offset+30+j]))throw new Error('Arquivo ZIP truncado ou com nomes inconsistentes.');
      entries.push({name:base,offset:dataOffset,compressed,original,method,crc});
    }
    p+=46+nameLength+extra+comment;
  }
  if(p!==start+size)throw new Error('Tamanho do diretório ZIP inconsistente.');
  if(!entries.length)throw new Error('Nenhum arquivo DICOM encontrado no ZIP.');return entries;
}

export async function unpackDicomZip(file,progress=()=>{}){
  if(file.size>MAX_BYTES)throw new Error('Limite de ZIP: 1 GB.');
  const bytes=new Uint8Array(await file.arrayBuffer()),entries=zipDirectory(bytes),files=[];
  for(let i=0;i<entries.length;i++){
    const e=entries[i],compressed=bytes.subarray(e.offset,e.offset+e.compressed);let data;
    try{data=e.method===0?compressed.slice():inflateSync(compressed,{out:new Uint8Array(e.original)});}catch{throw new Error('Falha ao descompactar um arquivo DICOM do ZIP.');}
    if(data.length!==e.original||crc32(data)!==e.crc)throw new Error('ZIP corrompido: a integridade de um arquivo DICOM não confere.');
    const name=`imagem-${i+1}${/\.dcm$/i.test(e.name)?'.dcm':''}`;
    files.push({name,size:data.length,arrayBuffer:async()=>data.buffer});
    progress(i+1,entries.length);if(i%4===0)await new Promise(r=>setTimeout(r,0));
  }
  return files;
}
