export function dicomFixture(opts={}) {
  const o={rows:3,cols:3,z:0,bits:16,stored:16,signed:1,spacing:[.3,.2],orientation:[1,0,0,0,1,0],slope:2,intercept:-1000,uid:'1.2.3.4',study:'1.2.3',frame:'1.2.3.5',transfer:'1.2.840.10008.1.2.1',...opts};
  const implicit=o.transfer==='1.2.840.10008.1.2';
  function element(tag,vr,value,forceExplicit=false){
    let data;
    if(vr==='US'){data=Buffer.alloc(2);data.writeUInt16LE(value);}else if(Buffer.isBuffer(value))data=value;else data=Buffer.from(String(value)+(String(value).length%2?(vr==='UI'?'\0':' '):''));
    const wide=['OW','OB','UN','SQ','UT'].includes(vr), imp=implicit&&!forceExplicit;
    const head=Buffer.alloc(imp?8:wide?12:8);head.writeUInt16LE(parseInt(tag.slice(0,4),16));head.writeUInt16LE(parseInt(tag.slice(4),16),2);
    if(imp)head.writeUInt32LE(data.length,4);else{head.write(vr,4);if(wide)head.writeUInt32LE(data.length,8);else head.writeUInt16LE(data.length,6);}
    return Buffer.concat([head,data]);
  }
  const header=Buffer.alloc(132);header.write('DICM',128);
  const pixel=Buffer.alloc(o.rows*o.cols*o.bits/8);const values=o.values||Array.from({length:o.rows*o.cols},(_,i)=>i);
  values.forEach((v,i)=>{if(o.bits===16)pixel.writeUInt16LE(v&65535,i*2);else pixel.writeUInt8(v&255,i);});
  const entries=[['00080016','UI','1.2.840.10008.5.1.4.1.1.2'],['00080018','UI',o.sop||'1.2.3.6.'+(Math.round(o.z*10)+100)],['00080060','CS',o.modality||'CT'],['0008103e','LO','SYNTHETIC TEST'],['0020000d','UI',o.study],['0020000e','UI',o.uid],['00200032','DS',(o.position||[0,0,o.z]).join('\\')],['00200037','DS',o.orientation.join('\\')],['00200052','UI',o.frame],['00280002','US',1],['00280004','CS','MONOCHROME2'],['00280008','IS',o.frames||1],['00280010','US',o.rows],['00280011','US',o.cols],['00280030','DS',o.spacing.join('\\')],['00280100','US',o.bits],['00280101','US',o.stored],['00280102','US',o.stored-1],['00280103','US',o.signed],['00281052','DS',o.intercept],['00281053','DS',o.slope],['7fe00010','OW',pixel]];
  return new Uint8Array(Buffer.concat([header,element('00020010','UI',o.transfer,true),...entries.filter(([tag])=>tag!==o.omit).map(e=>element(...e))]));
}
export function pdfFixture(){
  const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 520] /Resources << /Font << /F1 7 0 R >> >> /Contents 4 0 R >>',null,'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 520] /Resources << /Font << /F1 7 0 R >> >> /Contents 6 0 R >>',null,'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  for(const [index,text] of [[3,'PDF SINTETICO - PAGINA 1'],[5,'SEM DADOS DE PACIENTES - PAGINA 2']]){const s=`BT /F1 16 Tf 40 450 Td (${text}) Tj ET\n0.3 0.7 0.6 rg 40 290 320 100 re f\n`;objects[index]=`<< /Length ${Buffer.byteLength(s)} >>\nstream\n${s}endstream`;}
  let pdf='%PDF-1.4\n',offsets=[0];objects.forEach((o,i)=>{offsets.push(Buffer.byteLength(pdf));pdf+=`${i+1} 0 obj\n${o}\nendobj\n`;});const start=Buffer.byteLength(pdf);pdf+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`;offsets.slice(1).forEach(n=>{pdf+=String(n).padStart(10,'0')+' 00000 n \n';});pdf+=`trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`;return Buffer.from(pdf);
}

// Small synthetic JPEG Lossless SV1 encoder for deterministic regression fixtures.
export function losslessFixture(values=[32768,32769,32767,32770],cols=2,rows=2){
  const marker=(code,data)=>Buffer.concat([Buffer.from([255,code,(data.length+2)>>8,(data.length+2)&255]),Buffer.from(data)]);
  const counts=Array(16).fill(0);counts[4]=16;
  const parts=[Buffer.from([255,216]),marker(196,[0,...counts,...Array.from({length:16},(_,i)=>i)]),marker(195,[16,rows>>8,rows&255,cols>>8,cols&255,1,1,17,0]),marker(218,[1,1,0,1,0,0])];
  let bits='';values.forEach((value,i)=>{const pred=i===0?32768:i%cols?values[i-1]:values[i-cols],diff=value-pred,n=diff===0?0:Math.floor(Math.log2(Math.abs(diff)))+1;if(n>15)throw new Error('Fixture difference too large');bits+=n.toString(2).padStart(5,'0');if(n)bits+=(diff<0?diff+(2**n-1):diff).toString(2).padStart(n,'0');});
  bits=bits.padEnd(Math.ceil(bits.length/8)*8,'1');const encoded=[];for(let i=0;i<bits.length;i+=8){const b=parseInt(bits.slice(i,i+8),2);encoded.push(b);if(b===255)encoded.push(0);}
  return Buffer.concat([...parts,Buffer.from(encoded),Buffer.from([255,217])]);
}

export function compressedDicomFixture(opts={}){
  const jpeg=opts.jpeg||losslessFixture(),raw=Buffer.from(dicomFixture({rows:2,cols:2,signed:0,slope:1,intercept:-32768,...opts,transfer:'1.2.840.10008.1.2.4.70'}));
  const tag=Buffer.from([224,127,16,0,79,87,0,0]),offset=raw.indexOf(tag);if(offset<0)throw new Error('Missing pixel element');
  const header=Buffer.alloc(12);tag.copy(header);header.writeUInt32LE(0xffffffff,8);
  const item=data=>{const b=Buffer.alloc(8);b.writeUInt16LE(0xfffe);b.writeUInt16LE(0xe000,2);b.writeUInt32LE(data.length,4);return Buffer.concat([b,data]);};
  const even=jpeg.length%2?Buffer.concat([jpeg,Buffer.from([0])]):jpeg;
  const fragments=opts.fragmented?[even.subarray(0,20),even.subarray(20)]:[even];
  const end=Buffer.from([254,255,221,224,0,0,0,0]);return new Uint8Array(Buffer.concat([raw.subarray(0,offset),header,item(Buffer.alloc(0)),...fragments.map(item),end]));
}
