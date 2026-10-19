export const TARGET_WIDTH=128,TARGET_HEIGHT=180;

export function findConsecutiveRun(strings,minimum=6) {
  const values=new Set();
  for(const value of strings){const text=String(value).trim();if(/^\d{1,3}$/.test(text))values.add(Number(text));}
  const sorted=[...values].sort((a,b)=>a-b);let best=[],run=[];
  for(const value of sorted){if(!run.length||value===run.at(-1)+1)run.push(value);else run=[value];if(run.length>best.length)best=[...run];}
  return best.length>=minimum?best:[];
}

export function selectRepeatedImageGroup(images,minimum=8) {
  const groups=new Map();
  for(const image of images){
    if(image.width<256||image.height<256)continue;
    const ratio=image.width/image.height;if(ratio<.42||ratio>.95)continue;
    const key=image.width+'x'+image.height;
    const group=groups.get(key)||{key,width:image.width,height:image.height,items:[]};group.items.push(image);groups.set(key,group);
  }
  return [...groups.values()].filter(group=>group.items.length>=minimum).sort((a,b)=>b.items.length-a.items.length||b.width*b.height-a.width*a.height)[0]||null;
}

export function buildLaminaVolume(frames,labels,{widthMM=28,heightMM=40,sliceSpacing=1,sourceName='',sourceType='Lâminas'}={}) {
  const width=TARGET_WIDTH,height=TARGET_HEIGHT,count=frames.length;
  if(count<3||frames.some(frame=>frame.length!==width*height))throw new Error('Sequência de lâminas inválida.');
  const data=new Uint8Array(width*count*height);let min=255,max=0;
  for(let slice=0;slice<count;slice++)for(let row=0;row<height;row++){
    const z=height-1-row,source=frames[slice],target=(z*count+slice)*width;
    for(let x=0;x<width;x++){const value=source[row*width+x];data[target+x]=value;if(value<min)min=value;if(value>max)max=value;}
  }
  const spacing=[widthMM/width,sliceSpacing,heightMM/height],renderVolume=curveVolume(data,[width,count,height],spacing,min,max);
  return {data,dimensions:[width,count,height],spacing,origin:[0,0,0],min,max,window:Math.max(1,max-min),level:(min+max)/2,scalarSlope:1,scalarIntercept:0,lamina:true,estimated:true,sliceLabels:labels,sourceName,sourceType,renderVolume};
}

function curveVolume(source,dimensions,spacing,min,max) {
  const [width,count,height]=dimensions,[pixelWidth,sliceSpacing,pixelHeight]=spacing,arcLength=Math.max(30,(count-1)*sliceSpacing),radiusX=arcLength*.36,radiusY=arcLength*.25,halfWidth=width*pixelWidth/2;
  const gridX=.65,gridY=.65,extentX=radiusX+halfWidth+3,origin=[-extentX,-halfWidth-3,0],outWidth=Math.ceil(extentX*2/gridX)+1,outDepth=Math.ceil((radiusY+halfWidth*2+6)/gridY)+1,out=new Uint8Array(outWidth*outDepth*height);
  for(let slice=0;slice<count;slice++){
    const t=-Math.PI/2+(count===1?0:slice/(count-1))*Math.PI,cx=radiusX*Math.sin(t),cy=radiusY*Math.cos(t),tx=radiusX*Math.cos(t),ty=-radiusY*Math.sin(t),length=Math.hypot(tx,ty),nx=-ty/length,ny=tx/length;
    for(let z=0;z<height;z++)for(let x=0;x<width;x++){
      const value=source[(z*count+slice)*width+x];if(value<=min+1)continue;
      const offset=(x-(width-1)/2)*pixelWidth,gx=Math.round((cx+offset*nx-origin[0])/gridX),gy=Math.round((cy+offset*ny-origin[1])/gridY),base=(z*outDepth+gy)*outWidth+gx;
      for(let dy=0;dy<=1;dy++)for(let dx=0;dx<=1;dx++){const index=base+dy*outWidth+dx;if(gx+dx<outWidth&&gy+dy<outDepth&&value>out[index])out[index]=value;}
    }
  }
  return {data:out,dimensions:[outWidth,outDepth,height],spacing:[gridX,gridY,pixelHeight],origin,min,max,window:Math.max(1,max-min),level:(min+max)/2,scalarSlope:1,scalarIntercept:0,estimated:true,lamina:true};
}
