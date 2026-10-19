import {createDemo} from './demo.js';
import {scanFiles,buildVolumeAsync} from './dicom.js';
import {unpackDicomZip} from './archive.js';
import {createVolumeRenderer} from './volume.js';
import {makeSlice,PLANES} from './slices.js';
import {importLaminaFiles} from './lamina.js';
import {createAiClient,fingerprint,parseSegmentation,rgb,segmentationBlob} from './segmentation.js';

const $=id=>document.getElementById(id),keys=Object.keys(PLANES);
let volume,position=[72,45,54],vr=null,measuring=false,busy=false,groups=[],currentTab='viewer',demoCache=null,laminaCache=null;
const ai=createAiClient();let segmentation=null,aiRunning=false,aiReady=false,previousJob=false;
const message=(text,error=false)=>{$('status').textContent=text;$('status').classList.toggle('error',error);};
const fmt=n=>Number(n).toLocaleString('pt-BR',{maximumFractionDigits:2});
const paintRanges=()=>document.querySelectorAll('input[type="range"]').forEach(el=>{const min=Number(el.min),max=Number(el.max);el.style.setProperty('--progress',`${100*(Number(el.value)-min)/(max-min||1)}%`);});
const slices=Object.fromEntries(keys.map(key=>[key,makeSlice($('canvas-'+key),key,pt=>{position=pt;draw();},d=>{$('measure-status').textContent=d===null?'Selecione o segundo ponto no mesmo corte.':`Medida experimental: ${fmt(d)} mm. Confira em um visualizador validado.`;})]));
function draw(){
  if(!volume)return;
  const ww=Number($('window').value),wl=Number($('level').value);
  $('window-value').textContent=fmt(ww);$('level-value').textContent=fmt(wl);
  if(currentTab==='viewer')keys.forEach(key=>{slices[key].render(volume,position,ww,wl,$('cross').checked,measuring,segmentation);const axis=PLANES[key].axis,index=position[axis];$('slider-'+key).value=index;$('count-'+key).textContent=volume.lamina&&axis===1?`Lâmina ${volume.sliceLabels[index]} · ${index+1} / ${volume.dimensions[axis]}`:`${index+1} / ${volume.dimensions[axis]}`;});
  $('coordinates').textContent=volume.lamina?`Grade reformatada · ${volume.dimensions[1]} lâminas · escala aproximada`:'Posição LPS (mm) · '+position.map((n,i)=>fmt(volume.origin[i]+n*volume.spacing[i])).join(' / ');
  if(vr&&currentTab==='viewer')vr.clip($('clip').checked,position[2]);
  paintRanges();
}
function appearance(){if(!volume)return;const threshold=Number($('threshold').value);$('threshold-value').textContent=fmt(threshold);$('opacity-value').textContent=$('opacity').value+'%';paintRanges();vr?.appearance(threshold,Number($('opacity').value)/100);}
function tab(name){currentTab=name;if(matchMedia('(max-width:699px)').matches)sidebar(false);$('viewer-section').hidden=name!=='viewer';$('lamina-section').hidden=name!=='lamina';$('tab-viewer').classList.toggle('active',name==='viewer');$('tab-lamina').classList.toggle('active',name==='lamina');$('tab-viewer').setAttribute('aria-pressed',String(name==='viewer'));$('tab-lamina').setAttribute('aria-pressed',String(name==='lamina'));$('page-title').textContent=name==='viewer'?'Explorar exame':'Reconstruir lâminas';$('section-name').textContent=name==='viewer'?'Visualizador':'Lâminas';if(name==='viewer'){draw();vr?.resize();}}
function applyVolume(v,title){
  segmentation=null;$('ai-results').hidden=true;$('ai-layers').replaceChildren();
  volume=v;position=v.dimensions.map(n=>Math.floor(n/2));if(v.demo)position=[72,45,54];
  keys.forEach(key=>{slices[key].clear();$('slider-'+key).max=v.dimensions[PLANES[key].axis]-1;});
  $('study-title').textContent=title;$('study-description').textContent=v.demo?'Arcada simplificada, gerada por computador.':v.lamina?'Volume derivado de imagens reformatadas; geometria aproximada.':'Série importada localmente. Intensidades sem calibração de densidade óssea.';
  $('source-badge').textContent=v.demo?'MODELO SINTÉTICO':v.lamina?'LÂMINAS REFORMATADAS':'DICOM IMPORTADO';$('source-badge').classList.toggle('real',!v.demo&&!v.lamina);$('source-badge').classList.toggle('estimated',Boolean(v.lamina));$('volume-kind').textContent=v.demo?'SINTÉTICO':v.lamina?'LÂMINAS · ESTIMADO':'DICOM';
  $('source').textContent=v.demo?'Demonstração':v.lamina?v.sourceType:'Arquivo local';$('matrix').textContent=v.dimensions.join(' × ');$('spacing').textContent=(v.lamina?'≈ ':'')+v.spacing.map(fmt).join(' × ');
  const span=v.max-v.min;$('window').max=Math.max(1,Math.ceil(span*2));$('window').step=1;$('window').value=Number.isFinite(v.window)&&v.window>0?v.window:span*.8;
  $('level').min=v.min;$('level').max=v.max;$('level').step=1;$('level').value=Number.isFinite(v.level)?v.level:(v.min+v.max)/2;
  $('clip').checked=false;$('clip').disabled=Boolean(v.lamina);const wl=Number($('level').value),ww=Number($('window').value);
  $('threshold').min=v.min;$('threshold').max=Math.max(v.min+1,Math.min(v.max,wl+ww/2));$('threshold').step=1;$('threshold').value=v.demo?410:Math.max(v.min+1,wl-ww*.15);$('opacity').value=70;
  tab('viewer');
  try{if(!vr)vr=createVolumeRenderer($('volume-stage'));vr.load(v);$('volume-error').hidden=true;appearance();}catch(e){try{vr?.destroy();}catch{}vr=null;$('volume-error').hidden=false;$('volume-error').textContent=e.message;appearance();}
  setTool(false);$('tool-measure').disabled=Boolean(v.lamina);
  const names=v.lamina?{axial:['Mapa axial reformatado','Lâminas empilhadas'],coronal:['Lâmina transversal','Vestibular / Lingual'],sagittal:['Sequência da arcada','Volume desenrolado']}:{axial:['Axial','Superior / Inferior'],coronal:['Coronal','Anterior / Posterior'],sagittal:['Sagital','Direita / Esquerda']};
  for(const key of keys){$('view-title-'+key).textContent=names[key][0];$('view-desc-'+key).textContent=names[key][1];}
  updateAiState();
  requestAnimationFrame(()=>requestAnimationFrame(draw));
}
async function withBusy(fn){if(busy)return;busy=true;document.body.classList.add('busy');try{await fn();}catch(e){message(e.message||'Não foi possível concluir a operação.',true);}finally{busy=false;document.body.classList.remove('busy');}}
function showDemo(){if(!demoCache)demoCache=createDemo();applyVolume(demoCache,'Demonstração odontológica');message('Demonstração sintética · importe um DICOM para explorar um exame real.');}
function loadSeries(group){return withBusy(async()=>{message('Montando o volume e verificando a geometria…');await new Promise(r=>setTimeout(r,40));const v=await buildVolumeAsync(group.slices,(i,n)=>message(`Descomprimindo e montando corte ${i} de ${n}…`));applyVolume(v,'Tomografia importada');groups=[];$('series-list').replaceChildren();$('series-dialog').close();message(`DICOM carregado · ${v.dimensions[2]} cortes.`);});}
async function importFiles(files){await withBusy(async()=>{message('Lendo DICOM no computador…');let input=[...files];if(input.some(f=>/\.zip$/i.test(f.name))){if(input.length!==1)throw new Error('Selecione um ZIP por vez, sem misturar com outros arquivos.');input=await unpackDicomZip(input[0],(i,n)=>message(`Extraindo DICOM ${i} de ${n} do ZIP…`));}const result=await scanFiles(input,(i,n)=>message(`Lendo arquivo ${i} de ${n}…`));groups=result.groups;$('series-list').replaceChildren();groups.forEach((g,i)=>{const b=document.createElement('button');b.className='series-option';const strong=document.createElement('strong');strong.textContent=`Série ${i+1} · ${g.slices.length} cortes`;const detail=document.createElement('small');const sample=g.slices[0];detail.textContent=`CT · ${sample.cols||'?'} × ${sample.rows||'?'} · ${sample.transfer?.endsWith('.4.70')?'JPEG sem perda':'sem compressão'}`;const err=g.slices.find(s=>s.error);if(err){detail.textContent=err.error;b.disabled=true;}b.append(strong,detail);b.onclick=()=>loadSeries(g);$('series-list').append(b);});message(`${groups.length} série(s) encontrada(s). ${result.skipped?result.skipped+' arquivo(s) auxiliar(es) ignorado(s).':''}`);$('series-dialog').showModal();});}
function chooseLamina(){$('lamina-file').click();}
$('import-dicom').onclick=()=>$('import-dialog').showModal();$('help').onclick=()=>$('help-dialog').showModal();
$('choose-zip').onclick=()=>{$('import-dialog').close();$('dicom-zip').click();};
$('choose-files').onclick=()=>{$('import-dialog').close();$('dicom-files').click();};$('choose-folder').onclick=()=>{$('import-dialog').close();$('dicom-folder').click();};
for(const id of ['dicom-files','dicom-folder','dicom-zip'])$(id).onchange=async e=>{const files=e.target.files;if(files.length)await importFiles(files);e.target.value='';};
for(const id of ['import-lamina','lamina-empty-import','lamina-new'])$(id).onclick=chooseLamina;
$('lamina-file').onchange=async e=>{const files=e.target.files;if(files.length)await withBusy(async()=>{message('Procurando e ordenando as lâminas…');const reconstructed=await importLaminaFiles(files,text=>message(text));laminaCache=reconstructed;$('lamina-empty').hidden=true;$('lamina-loaded').hidden=false;$('lamina-name').textContent=reconstructed.sourceName;$('lamina-count').textContent=reconstructed.dimensions[1];$('lamina-range').textContent=`${reconstructed.sliceLabels[0]}–${reconstructed.sliceLabels.at(-1)}`;$('lamina-type').textContent=reconstructed.sourceType;$('lamina-dot').hidden=false;applyVolume(reconstructed,'Reconstrução por lâminas');message(`Reconstrução aproximada concluída · ${reconstructed.dimensions[1]} lâminas. Medidas e geometria não são equivalentes ao DICOM.`);});e.target.value='';};
$('lamina-view').onclick=()=>{if(laminaCache)applyVolume(laminaCache,'Reconstrução por lâminas');};
function clearLamina(){laminaCache=null;$('lamina-empty').hidden=false;$('lamina-loaded').hidden=true;$('lamina-name').textContent='';$('lamina-dot').hidden=true;}
$('lamina-remove').onclick=()=>withBusy(async()=>{const active=volume?.lamina;clearLamina();if(active)showDemo();else tab('viewer');message('Lâminas removidas da sessão.');});
$('tab-viewer').onclick=()=>tab('viewer');$('tab-lamina').onclick=()=>tab('lamina');
$('demo').onclick=()=>withBusy(async()=>{groups=[];$('series-list').replaceChildren();showDemo();});
$('clear').onclick=()=>withBusy(async()=>{clearLamina();groups=[];$('series-list').replaceChildren();showDemo();message('Sessão limpa. Apenas a demonstração sintética está carregada.');});
$('series-dialog').addEventListener('close',()=>{groups=[];$('series-list').replaceChildren();});
document.querySelectorAll('.dialog-close').forEach(b=>b.onclick=()=>b.closest('dialog').close());
function setTool(value){measuring=Boolean(value&&!volume?.lamina);$('tool-navigate').classList.toggle('selected',!measuring);$('tool-measure').classList.toggle('selected',measuring);$('tool-navigate').setAttribute('aria-pressed',String(!measuring));$('tool-measure').setAttribute('aria-pressed',String(measuring));keys.forEach(k=>slices[k].clear());$('measure-status').textContent=volume?.lamina?'Medidas desativadas: escala e geometria estimadas a partir das lâminas.':measuring?'* Experimental. Clique em dois pontos no mesmo corte.':'Clique em um corte para sincronizar as miras.';draw();}
$('tool-navigate').onclick=()=>setTool(false);$('tool-measure').onclick=()=>setTool(true);
for(const key of keys)$('slider-'+key).oninput=e=>{position[PLANES[key].axis]=Number(e.target.value);draw();};
for(const id of ['window','level','cross','clip'])$(id).oninput=draw;
for(const id of ['threshold','opacity'])$(id).oninput=appearance;
$('camera-reset').onclick=()=>vr?.reset();$('reset').onclick=()=>{position=volume.dimensions.map(n=>Math.floor(n/2));keys.forEach(k=>slices[k].clear());vr?.reset();draw();};

function updateAiState(){
  $('ai-run').disabled=!aiReady||!volume||volume.demo||volume.lamina||aiRunning;
  $('ai-import').disabled=!volume||volume.demo||volume.lamina||aiRunning;
  $('ai-run').hidden=aiRunning;$('ai-cancel').hidden=!aiRunning;$('ai-progress').hidden=!aiRunning;
  $('ai-launch-help').hidden=ai.available;
  $('ai-service').textContent=volume?.lamina?'A IA volumétrica atual exige o DICOM original.':!ai.available?'Para executar a IA, abra o aplicativo com o serviço local.':!aiReady?'Serviço local conectado · modelo indisponível.':volume?.demo?'IA pronta · importe um DICOM para identificar as estruturas.':'IA pronta neste computador · processamento pela CPU.';
}
function updateLayers(){
  if(!segmentation)return;
  for(const layer of segmentation.layers){$('layer-'+layer.id).classList.toggle('off',!layer.visible);$('layer-show-'+layer.id).checked=layer.visible;}
  vr?.segmentAppearance(segmentation);draw();
}
function installSegmentation(result){
  segmentation=result;
  $('ai-layers').replaceChildren();
  for(const layer of result.layers){
    const row=document.createElement('div');row.className='ai-layer';row.id='layer-'+layer.id;
    const head=document.createElement('div');head.className='ai-layer-header';
    const color=document.createElement('input');color.type='color';color.value=layer.color;color.setAttribute('aria-label','Cor de '+layer.name);color.disabled=!layer.voxels;
    const visible=document.createElement('input');visible.type='checkbox';visible.checked=layer.visible;visible.id='layer-show-'+layer.id;visible.setAttribute('aria-label','Mostrar '+layer.name);visible.disabled=!layer.voxels;
    const label=document.createElement('label');label.htmlFor=visible.id;label.textContent=layer.name;
    const detail=document.createElement('small');detail.textContent=layer.voxels?'Sugestão da IA':'Não identificado';
    color.oninput=()=>{layer.color=color.value;layer.rgb=rgb(color.value);updateLayers();};
    visible.onchange=()=>{layer.visible=visible.checked;updateLayers();};
    head.append(color,visible);row.append(head,label,detail);$('ai-layers').append(row);
  }
  $('ai-results').hidden=false;$('ai-overlay').checked=result.showOverlay;$('ai-surfaces').checked=result.showSurfaces;$('ai-original').checked=result.showOriginal;$('ai-alpha').value=Math.round(result.overlayOpacity*100);
  $('volume-kind').textContent='IA · NÃO REVISADA';
  let warning='';try{vr?.setSegments(result);}catch(e){warning=' Cores disponíveis nos cortes; superfícies 3D indisponíveis: '+e.message;result.showOriginal=true;$('ai-original').checked=true;}
  updateLayers();return warning;
}
function removeSegmentation(){segmentation=null;vr?.clearSegments();$('ai-results').hidden=true;$('ai-layers').replaceChildren();$('volume-kind').textContent=volume.demo?'SINTÉTICO':volume.lamina?'LÂMINAS · ESTIMADO':'DICOM';draw();}
$('ai-run').onclick=()=>withBusy(async()=>{
  if(!aiReady||volume.demo||volume.lamina)return;
  aiRunning=true;updateAiState();$('ai-cancel').disabled=false;
  try{
    const result=await ai.run(volume,state=>{const tiles=Number.isInteger(state.tilesTotal)?` · bloco ${state.tilesDone} de ${state.tilesTotal}`:'';const elapsed=state.elapsedSeconds?` · ${Math.floor(state.elapsedSeconds/60)}min ${state.elapsedSeconds%60}s`:'';$('ai-progress-text').textContent=(state.detail||'Processando…')+tiles+elapsed;});
    const warning=installSegmentation(result);message('Segmentação automática concluída. As cores são sugestões da IA e precisam de revisão.'+warning,Boolean(warning));
  }catch(e){message(e.message,!/cancelada/i.test(e.message));}finally{aiRunning=false;updateAiState();}
});
$('ai-cancel').onclick=async()=>{$('ai-cancel').disabled=true;$('ai-progress-text').textContent='Cancelando o processamento local…';await ai.cancel();if(previousJob){previousJob=false;aiRunning=false;updateAiState();message('Cancelamento solicitado. Aguarde alguns segundos antes de iniciar outra segmentação.');}};
$('ai-import').onclick=()=>$('ai-file').click();
$('ai-file').onchange=async e=>{const file=e.target.files[0];if(file)await withBusy(async()=>{if(volume.demo||volume.lamina)throw new Error('Abra o DICOM correspondente antes da segmentação.');if(file.size>192*1024**2)throw new Error('Limite do arquivo de segmentação: 192 MB.');message('Conferindo a segmentação com o exame aberto…');const digest=await fingerprint(volume);const warning=installSegmentation(parseSegmentation(new Uint8Array(await file.arrayBuffer()),volume,digest));message('Segmentação carregada e vinculada ao exame. Sugestões da IA ainda não revisadas.'+warning,Boolean(warning));});e.target.value='';};
$('ai-save').onclick=()=>{if(!segmentation)return;const url=URL.createObjectURL(segmentationBlob(segmentation)),a=document.createElement('a');a.href=url;a.download='segmentacao.odseg';a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);};
$('ai-clear').onclick=()=>{removeSegmentation();message('Cores removidas. O volume DICOM permanece aberto.');};
$('ai-teeth').onclick=()=>{if(segmentation){segmentation.layers.forEach(a=>a.visible=a.voxels>0&&[3,4].includes(a.id));updateLayers();}};
$('ai-all').onclick=()=>{if(segmentation){segmentation.layers.forEach(a=>a.visible=a.voxels>0);updateLayers();}};
for(const [id,key] of [['ai-overlay','showOverlay'],['ai-surfaces','showSurfaces'],['ai-original','showOriginal']])$(id).onchange=()=>{if(segmentation){segmentation[key]=$(id).checked;updateLayers();}};
$('ai-alpha').oninput=()=>{if(segmentation){segmentation.overlayOpacity=Number($('ai-alpha').value)/100;draw();}};
ai.health().then(state=>{aiReady=state.ready;if(state.activeJob){previousJob=true;aiRunning=true;$('ai-progress-text').textContent='Há um processamento anterior em andamento. Cancele-o para começar novamente.';}updateAiState();}).catch(()=>{aiReady=false;updateAiState();});
const observer=new ResizeObserver(()=>{if(volume&&currentTab==='viewer')draw();});observer.observe($('viewer-section'));
setTimeout(()=>{try{showDemo();document.body.dataset.ready='true';}catch(e){message(e.message,true);}},30);

function inspector(name){$('image-inspector').hidden=name!=='image';$('ai-inspector').hidden=name!=='ai';for(const key of ['image','ai']){$('inspector-'+key).classList.toggle('selected',key===name);$('inspector-'+key).setAttribute('aria-pressed',String(key===name));}}
$('inspector-image').onclick=()=>inspector('image');$('inspector-ai').onclick=()=>inspector('ai');
function sidebar(open){const small=matchMedia('(max-width:699px)').matches;$('sidebar').inert=small&&!open;document.querySelector('main').inert=small&&open;document.body.classList.toggle('sidebar-open',open);$('sidebar-toggle').setAttribute('aria-expanded',String(open));$('sidebar-scrim').hidden=!open;if(open&&small)$('import-dicom').focus();if(!open&&matchMedia('(max-width:699px)').matches)$('sidebar-toggle').focus();}
$('sidebar-toggle').onclick=()=>sidebar(!document.body.classList.contains('sidebar-open'));$('sidebar-close').onclick=() => sidebar(false);$('sidebar-scrim').onclick=()=>sidebar(false);
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&document.body.classList.contains('sidebar-open'))sidebar(false);});

matchMedia('(max-width:699px)').addEventListener('change',()=>sidebar(false));
