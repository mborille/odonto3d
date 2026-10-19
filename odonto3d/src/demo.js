// Phantom procedural para demonstrar o visualizador. Não é anatomia de um paciente.
export function createDemo() {
  const dimensions=[144,144,112], spacing=[.7,.7,.7], origin=[-50.05,-50.05,-39.2];
  const [nx,ny,nz]=dimensions, data=new Float32Array(nx*ny*nz);
  const teeth=[];
  for(let i=0;i<14;i++) {const a=(-76+i*152/13)*Math.PI/180;teeth.push([30*Math.sin(a),10-32*Math.cos(a),a]);}
  let min=Infinity,max=-Infinity;
  for(let z=0;z<nz;z++) for(let y=0;y<ny;y++) for(let x=0;x<nx;x++) {
    const X=origin[0]+x*.7,Y=origin[1]+y*.7,Z=origin[2]+z*.7;
    const r=Math.hypot(X/30,(Y-10)/32),front=Y<14;
    let v=-950;
    if(front && Math.abs(r-1)<.23 && Z>-23 && Z<23) v=-150;
    if(front && Math.abs(r-1)<.18 && ((Z>-23 && Z<-9)||(Z>11 && Z<23))) {
      const shell=Math.abs(r-1)>.135 || Z<-21 || Z>21 || Math.abs(Z)<12;
      v=shell?1200:390+120*Math.sin(X*1.4)*Math.sin(Y*1.1)*Math.cos(Z*1.3);
    }
    // Stylized bilateral posterior rami.
    for(const side of [-1,1]) {const e=((X-side*31)/5)**2+((Y-15)/10)**2;
      if(e<1 && Z>-21 && Z<27) v=Math.max(v,e>.55?1250:420);
    }
    if(Z>-15 && Z<19) for(const [tx,ty,a] of teeth) {
      const dx=X-tx,dy=Y-ty,u=dx*Math.cos(a)+dy*Math.sin(a),w=-dx*Math.sin(a)+dy*Math.cos(a);
      for(const upper of [false,true]) {
        const zz=upper ? 5-Z : Z+5;
        if(zz<-11||zz>3) continue;
        const size=zz<0?Math.max(.8,3+zz*.17):3.4;
        const e=(u/size)**2+(w/(size*.82))**2;
        if(e<1){let t=zz>0&&e>.5?2450:1800;if(zz<0&&e<.08)t=100;v=Math.max(v,t);}
      }
    }
    data[(z*ny+y)*nx+x]=v;min=Math.min(min,v);max=Math.max(max,v);
  }
  return {data,dimensions,spacing,origin,min,max,window:3000,level:600,demo:true};
}
