import '@kitware/vtk.js/Rendering/Profiles/Volume';
import '@kitware/vtk.js/Rendering/Profiles/Geometry';
import vtkActor from '@kitware/vtk.js/Rendering/Core/Actor';
import vtkMapper from '@kitware/vtk.js/Rendering/Core/Mapper';
import vtkPolyData from '@kitware/vtk.js/Common/DataModel/PolyData';
import vtkGenericRenderWindow from '@kitware/vtk.js/Rendering/Misc/GenericRenderWindow';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import vtkVolume from '@kitware/vtk.js/Rendering/Core/Volume';
import vtkVolumeMapper from '@kitware/vtk.js/Rendering/Core/VolumeMapper';
import vtkColorTransferFunction from '@kitware/vtk.js/Rendering/Core/ColorTransferFunction';
import vtkPiecewiseFunction from '@kitware/vtk.js/Common/DataModel/PiecewiseFunction';
import vtkPlane from '@kitware/vtk.js/Common/DataModel/Plane';

export function createVolumeRenderer(container) {
  const probe=document.createElement('canvas').getContext('webgl2');
  if(!probe) throw new Error('A visualização 3D precisa de WebGL 2. Os cortes 2D continuam disponíveis.');
  probe.getExtension('WEBGL_lose_context')?.loseContext();
  const view=vtkGenericRenderWindow.newInstance({background:[.035,.049,.069],listenWindowResize:false});
  view.setContainer(container);
  const renderer=view.getRenderer(), mapper=vtkVolumeMapper.newInstance(),actor=vtkVolume.newInstance();
  const colors=vtkColorTransferFunction.newInstance(), opacity=vtkPiecewiseFunction.newInstance(),plane=vtkPlane.newInstance();
  actor.setMapper(mapper);renderer.addVolume(actor);
  const property=actor.getProperty();
  property.setRGBTransferFunction(0,colors);property.setScalarOpacity(0,opacity);
  property.setInterpolationTypeToLinear();property.setShade(true);property.setAmbient(.3);property.setDiffuse(.7);property.setSpecular(.2);property.setSpecularPower(15);
  let volume,image;const surfaces=[];
  function clearSegments(){for(const s of surfaces){renderer.removeActor(s.actor);s.actor.delete();s.mapper.delete();s.data.delete();}surfaces.length=0;actor.setVisibility(true);}
  const resize=()=>{if(container.clientWidth && container.clientHeight) view.resize();};
  const observer=new ResizeObserver(resize);observer.observe(container);
  function reset() {
    if(!volume)return;
    const c=volume.origin.map((n,i)=>n+(volume.dimensions[i]-1)*volume.spacing[i]/2);
    const size=Math.max(...volume.dimensions.map((n,i)=>n*volume.spacing[i]));
    const camera=renderer.getActiveCamera();camera.setFocalPoint(...c);camera.setPosition(c[0]+size*.65,c[1]-size*2,c[2]+size*.65);camera.setViewUp(0,0,1);renderer.resetCamera();camera.zoom(1.6);renderer.resetCameraClippingRange();view.getRenderWindow().render();
  }
  return {
    load(v){
      clearSegments();
      volume=v.renderVolume||v;const old=image;image=vtkImageData.newInstance();image.setDimensions(...volume.dimensions);image.setSpacing(...volume.spacing);image.setOrigin(...volume.origin);
      image.getPointData().setScalars(vtkDataArray.newInstance({name:'Intensidade',numberOfComponents:1,values:volume.data}));
      mapper.setInputData(image);old?.delete();mapper.setSampleDistance(Math.max(Math.min(...volume.spacing)*1.2,Math.max(...volume.dimensions.map((n,i)=>n*volume.spacing[i]))/500));mapper.setMaximumSamplesPerRay(2200);
      property.setScalarOpacityUnitDistance(0,Math.min(...volume.spacing)*2);resize();reset();
    },
    appearance(threshold,alpha){
      if(!volume)return;
      const {min,max}=volume;
      const displayMax=Number.isFinite(volume.window)&&Number.isFinite(volume.level)?Math.min(max,volume.level+volume.window/2):max;
      const high=Math.max(min+1,displayMax,threshold+1),span=high-min;
      const scalar=n=>(n-(volume.scalarIntercept??0))/(volume.scalarSlope??1);
      colors.removeAllPoints();colors.addRGBPoint(scalar(min),.25,.2,.16);colors.addRGBPoint(scalar(min+span*.42),.75,.57,.39);colors.addRGBPoint(scalar(min+span*.7),.95,.88,.71);colors.addRGBPoint(scalar(high),1,1,.97);
      opacity.removeAllPoints();opacity.addPoint(scalar(min),0);opacity.addPoint(scalar(threshold),0);opacity.addPoint(scalar(Math.min(high,threshold+span*.12)),alpha*.45);opacity.addPoint(scalar(high),alpha);
      view.getRenderWindow().render();
    },
    setSegments(seg){
      clearSegments();
      try{for(const mesh of seg.meshes){
        const data=vtkPolyData.newInstance(),surfaceMapper=vtkMapper.newInstance(),surfaceActor=vtkActor.newInstance();
        data.getPoints().setData(mesh.points,3);
        const polys=new Uint32Array(mesh.triangles.length/3*4);for(let t=0;t<mesh.triangles.length/3;t++){polys[t*4]=3;polys.set(mesh.triangles.subarray(t*3,t*3+3),t*4+1);}
        data.getPolys().setData(polys);data.getPointData().setNormals(vtkDataArray.newInstance({name:'Normals',numberOfComponents:3,values:mesh.normals}));
        surfaceMapper.setInputData(data);surfaceMapper.setScalarVisibility(false);surfaceActor.setMapper(surfaceMapper);
        surfaceActor.getProperty().setAmbient(.25);surfaceActor.getProperty().setDiffuse(.75);surfaceActor.getProperty().setSpecular(.15);surfaceActor.getProperty().setSpecularPower(18);
        renderer.addActor(surfaceActor);surfaces.push({id:mesh.id,actor:surfaceActor,mapper:surfaceMapper,data});
      }}catch(e){clearSegments();throw e;}
    },
    segmentAppearance(seg){for(const s of surfaces){const layer=seg.layers.find(a=>a.id===s.id);s.actor.setVisibility(seg.showSurfaces&&layer.visible);s.actor.getProperty().setColor(...layer.rgb.map(n=>n/255));}actor.setVisibility(seg.showOriginal||!seg.meshes.length);view.getRenderWindow().render();},
    clearSegments(){clearSegments();view.getRenderWindow().render();},
    clip(enabled,z){const all=[mapper,...surfaces.map(s=>s.mapper)];for(const m of all)m.removeAllClippingPlanes();if(enabled&&volume){plane.setNormal(0,0,-1);plane.setOrigin(volume.origin[0],volume.origin[1],volume.origin[2]+z*volume.spacing[2]);for(const m of all)m.addClippingPlane(plane);}view.getRenderWindow().render();},
    resize,reset,
    destroy(){clearSegments();observer.disconnect();view.delete();image?.delete();actor.delete();mapper.delete();colors.delete();opacity.delete();plane.delete();}
  };
}
