export const PLANES={axial:{axis:2,u:0,v:1,reverse:false,labels:['A','P','D','E'],color:'#6ddcc9'},coronal:{axis:1,u:0,v:2,reverse:true,labels:['S','I','D','E'],color:'#ecbb78'},sagittal:{axis:0,u:1,v:2,reverse:true,labels:['S','I','A','P'],color:'#a6a6ef'}};
export const distanceMM=(a,b,spacing)=>Math.hypot(...a.map((n,i)=>(n-b[i])*spacing[i]));
export function makeSlice(canvas,key,change,measure) {
  const p=PLANES[key],ctx=canvas.getContext('2d',{alpha:false,willReadFrequently:true}),scratch=document.createElement('canvas');
  let rect,volume,position,windowWidth,level,showCross=true,points=[],measuring=false,segmentation=null;
  function render(v,pos,ww,wl,cross,tool,seg=null) {
    if(position && position[p.axis]!==pos[p.axis])points=[];
    volume=v;position=[...pos];windowWidth=ww;level=wl;showCross=cross;measuring=tool;segmentation=seg;
    const palette=seg?.showOverlay?Object.fromEntries(seg.layers.filter(a=>a.visible).map(a=>[a.id,a.rgb])):{};
    const alpha=seg?.overlayOpacity??0;
    const w=v.dimensions[p.u],h=v.dimensions[p.v];scratch.width=w;scratch.height=h;
    const sc=scratch.getContext('2d'),im=sc.createImageData(w,h),coords=[...pos],low=wl-ww/2;
    for(let b=0;b<h;b++)for(let a=0;a<w;a++) {
      coords[p.u]=a;coords[p.v]=p.reverse?h-1-b:b;
      const index=(coords[2]*v.dimensions[1]+coords[1])*v.dimensions[0]+coords[0];
      const value=v.data[index]*(v.scalarSlope??1)+(v.scalarIntercept??0);
      const gray=Math.max(0,Math.min(255,((value-low)/ww)*255)),i=(b*w+a)*4;
      im.data[i]=gray;im.data[i+1]=gray;im.data[i+2]=gray;im.data[i+3]=255;
      const color=seg?.showOverlay&&palette[seg.labels[index]];
      if(color)for(let channel=0;channel<3;channel++)im.data[i+channel]=gray*(1-alpha)+color[channel]*alpha;
    }
    sc.putImageData(im,0,0);
    const dpr=Math.min(window.devicePixelRatio||1,2),cw=canvas.clientWidth,ch=canvas.clientHeight;
    canvas.width=Math.max(1,cw*dpr);canvas.height=Math.max(1,ch*dpr);ctx.setTransform(dpr,0,0,dpr,0,0);
    ctx.fillStyle='#080d14';ctx.fillRect(0,0,cw,ch);
    const scale=Math.min((cw-55)/(w*v.spacing[p.u]),(ch-50)/(h*v.spacing[p.v]));
    const rw=w*v.spacing[p.u]*scale,rh=h*v.spacing[p.v]*scale;
    rect={x:(cw-rw)/2,y:(ch-rh)/2,w:rw,h:rh,cols:w,rows:h};
    ctx.imageSmoothingEnabled=false;ctx.drawImage(scratch,rect.x,rect.y,rw,rh);
    function screen(pt){return [rect.x+(pt[p.u]+.5)/w*rw,rect.y+((p.reverse?h-1-pt[p.v]:pt[p.v])+.5)/h*rh];}
    if(cross){const [x,y]=screen(pos);ctx.strokeStyle=p.color+'99';ctx.lineWidth=.8;ctx.beginPath();ctx.moveTo(rect.x,y);ctx.lineTo(rect.x+rw,y);ctx.moveTo(x,rect.y);ctx.lineTo(x,rect.y+rh);ctx.stroke();ctx.strokeStyle=p.color;ctx.strokeRect(x-4,y-4,8,8);}
    ctx.fillStyle='#8999ab';ctx.font='11px system-ui';ctx.textAlign='center';ctx.fillText(p.labels[0],cw/2,15);ctx.fillText(p.labels[1],cw/2,ch-10);ctx.fillText(p.labels[2],14,ch/2);ctx.fillText(p.labels[3],cw-14,ch/2);
    if(points.length){ctx.strokeStyle='#ffe0a6';ctx.fillStyle='#ffe0a6';ctx.lineWidth=2;ctx.beginPath();points.forEach((point,i)=>{const [x,y]=screen(point);if(i)ctx.lineTo(x,y);else ctx.moveTo(x,y);});ctx.stroke();for(const point of points){const [x,y]=screen(point);ctx.beginPath();ctx.arc(x,y,3,0,Math.PI*2);ctx.fill();}
      if(points.length===2){const [x,y]=screen(points[1]),text=distanceMM(...points,v.spacing).toFixed(2)+' mm*';ctx.font='12px system-ui';ctx.textAlign='left';const tw=ctx.measureText(text).width;const tx=Math.max(5,Math.min(cw-tw-8,x+8)),ty=Math.max(20,y-10);ctx.fillStyle='#080d14';ctx.fillRect(tx-4,ty-15,tw+8,21);ctx.fillStyle='#ffe0a6';ctx.fillText(text,tx,ty);}}
    if(v.demo||v.lamina){ctx.font='10px system-ui';ctx.textAlign='left';ctx.fillStyle=v.lamina?'#d2a85d':'#8795a6';ctx.fillText(v.lamina?'LÂMINAS · GEOMETRIA ESTIMADA':'MODELO SINTÉTICO',12,ch-10);}
  }
  canvas.addEventListener('click',e=>{
    if(!rect||!volume)return;
    const b=canvas.getBoundingClientRect(),x=e.clientX-b.left,y=e.clientY-b.top;
    if(x<rect.x||x>rect.x+rect.w||y<rect.y||y>rect.y+rect.h)return;
    const pt=[...position];pt[p.u]=Math.min(rect.cols-1,Math.floor((x-rect.x)/rect.w*rect.cols));const row=Math.min(rect.rows-1,Math.floor((y-rect.y)/rect.h*rect.rows));pt[p.v]=p.reverse?rect.rows-1-row:row;
    if(measuring){if(points.length===2)points=[];points.push(pt);render(volume,position,windowWidth,level,showCross,measuring,segmentation);measure(points.length===2?distanceMM(...points,volume.spacing):null);}else change(pt);
  });
  canvas.addEventListener('wheel',e=>{e.preventDefault();if(!volume)return;const pt=[...position];pt[p.axis]=Math.max(0,Math.min(volume.dimensions[p.axis]-1,pt[p.axis]+Math.sign(e.deltaY)));change(pt);},{passive:false});
  return {render,clear(){points=[];}};
}
