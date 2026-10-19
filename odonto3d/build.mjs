import {build} from 'esbuild';
import {readFile,writeFile,readdir} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {dirname,join} from 'node:path';
import {icon} from './src/icons.js';
const require=createRequire(import.meta.url),pdfRoot=dirname(require.resolve('pdfjs-dist/package.json'));
const workerBundle=await build({entryPoints:[join(pdfRoot,'build/pdf.worker.min.mjs')],bundle:true,write:false,format:'iife',target:'es2022',minify:true,legalComments:'inline'});
const assets={};
for(const [kind,dir] of [['cMapUrl','cmaps'],['standardFontDataUrl','standard_fonts'],['wasmUrl','wasm']]){
  for(const name of await readdir(join(pdfRoot,dir))){if(!/\.(bcmap|pfb|ttf|wasm)$/.test(name)||name.startsWith('quickjs'))continue;assets[kind+'/'+name]=(await readFile(join(pdfRoot,dir,name))).toString('base64');}
}
const result=await build({entryPoints:['src/main.js'],bundle:true,write:false,format:'iife',target:'es2022',minify:true,legalComments:'inline',plugins:[{name:'embedded-pdf',setup(b){b.onResolve({filter:/^embedded-pdf-/},a=>({path:a.path,namespace:'embedded'}));b.onLoad({filter:/.*/,namespace:'embedded'},async a=>a.path==='embedded-pdf-worker'?{contents:workerBundle.outputFiles[0].text,loader:'text'}:{contents:JSON.stringify(assets),loader:'json'});}}]});
const panels=Object.entries({axial:['Axial','Superior / Inferior','#6ddcc9'],coronal:['Coronal','Anterior / Posterior','#ecbb78'],sagittal:['Sagital','Direita / Esquerda','#a6a6ef']}).map(([key,[name,desc,color]])=>`<article class="view" style="--plane:${color}"><div class="view-head"><h2><span class="view-dot"></span> <span id="view-title-${key}">${name}</span></h2><small id="view-desc-${key}">${desc}</small></div><div class="slice-stage"><canvas class="slice" id="canvas-${key}" aria-label="Corte ${name}; clique para posicionar a mira"></canvas></div><div class="slice-controls"><label for="slider-${key}">Corte</label><input id="slider-${key}" type="range" min="0" max="100" value="50"><output id="count-${key}"></output></div></article>`).join('');
let html=await readFile('src/template.html','utf8');html=html.replace("'unsafe-inline' blob:; worker", "'unsafe-inline' 'wasm-unsafe-eval' blob:; worker").replace('__STYLE__',await readFile('src/style.css','utf8')).replace('__SLICE_PANELS__',panels).replace('__SCRIPT__',()=>result.outputFiles[0].text.replace(/<\/script/gi,'<\\/script'));
const notices=await readFile('THIRD-PARTY-LICENSES.txt','utf8');
html=html.replace(/\{\{icon:([a-z]+)\}\}/g,(_,name)=>icon(name));
html=html.replace('</body>',()=>`<script type="text/plain" id="third-party-notices">${notices.replace(/<\/script/gi,'<\\/script')}</script>\n</body>`);
await writeFile('../Odonto3D.html',html);
console.log(`Aplicativo offline gerado: Odonto3D.html (${(Buffer.byteLength(html)/1024/1024).toFixed(1)} MB)`);
