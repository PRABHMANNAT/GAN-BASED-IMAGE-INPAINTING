const $ = id => document.getElementById(id);
const source = $('source'), overlay = $('overlay');
const maskCanvas = document.createElement('canvas');
const mc = maskCanvas.getContext('2d', {willReadFrequently:true});
const oc = overlay.getContext('2d');
let imageUrl = null, history = [], drawing = false, erasing = false, previous = null, busy = false, metadataUrl = null;

function status(message, error=false) { $('status').textContent=message; $('status').classList.toggle('error',error); }
function viewResult(show) {
  $('editor').hidden=show; $('result-panel').hidden=!show;
  $('edit-tab').classList.toggle('active',!show); $('result-tab').classList.toggle('active',show);
  $('edit-tab').setAttribute('aria-pressed',!show); $('result-tab').setAttribute('aria-pressed',show);
}
function invalidate() { $('result-tab').disabled=true; viewResult(false); }
function remember() { history.push(mc.getImageData(0,0,maskCanvas.width,maskCanvas.height)); if(history.length>20) history.shift(); }
function updateMask() {
  const pixels=mc.getImageData(0,0,maskCanvas.width,maskCanvas.height);
  const tint=oc.createImageData(pixels.width,pixels.height); let count=0;
  for(let i=0;i<pixels.data.length;i+=4) {
    const marked=pixels.data[i]>=128;
    if(marked) count++;
    tint.data[i]=223; tint.data[i+1]=103; tint.data[i+2]=77; tint.data[i+3]=marked?170:0;
  }
  oc.putImageData(tint,0,0);
  $('coverage').textContent=`${(100*count/(pixels.width*pixels.height)).toFixed(1)}% masked`;
  invalidate();
}
function clearMask() { mc.fillStyle='black'; mc.fillRect(0,0,maskCanvas.width,maskCanvas.height); updateMask(); }
async function jsonResponse(response) {
  const body=await response.json(); if(!response.ok) throw new Error(body.error || 'Request failed.'); return body;
}
async function loadImage(blob, clean=false) {
  if(busy) return; setBusy(true);
  try {
    const data=new FormData();data.append('image',blob,'input.png');
    const prepared=await jsonResponse(await fetch('/api/prepare',{method:'POST',body:data}));
    const image=new Image();image.src=prepared.image;await image.decode();
    for(const c of [source,overlay,maskCanvas]) {c.width=prepared.width;c.height=prepared.height;}
    source.getContext('2d').drawImage(image,0,0);imageUrl=prepared.image;
    history=[];clearMask();$('reference').checked=clean;
    $('dimensions').textContent=`${prepared.width} × ${prepared.height}`;
    status('Paint over damage, or add a scratch preset.');
  } catch(error) {status(error.message,true);} finally {setBusy(false);}
}
function setBusy(value) {
  busy=value;
  document.querySelectorAll('aside button, aside input').forEach(el => el.disabled=value);
  if(!value && $('gan').dataset.unavailable==='true') $('gan').disabled=true;
  overlay.style.pointerEvents=value?'none':'auto';
  $('restore').textContent=value?'Processing…':'Generate restoration ↗';
}
function position(event) {
  const r=overlay.getBoundingClientRect();
  return [(event.clientX-r.left)*overlay.width/r.width,(event.clientY-r.top)*overlay.height/r.height];
}
function stroke(from,to) {
  mc.strokeStyle=erasing?'black':'white';mc.fillStyle=mc.strokeStyle;
  mc.lineWidth=Number($('brush').value);mc.lineCap='round';mc.lineJoin='round';
  mc.beginPath();mc.moveTo(...from);mc.lineTo(...to);mc.stroke();
  mc.beginPath();mc.arc(to[0],to[1],mc.lineWidth/2,0,Math.PI*2);mc.fill();updateMask();
}
overlay.addEventListener('pointerdown',e=>{if(busy||!imageUrl)return;remember();drawing=true;previous=position(e);overlay.setPointerCapture(e.pointerId);stroke(previous,previous);});
overlay.addEventListener('pointermove',e=>{if(!drawing)return;const p=position(e);stroke(previous,p);previous=p;});
for(const event of ['pointerup','pointercancel','lostpointercapture']) overlay.addEventListener(event,()=>drawing=false);
$('brush').addEventListener('input',()=>{$('brush-value').textContent=`${$('brush').value} px`;});
function setTool(erase) {erasing=erase;$('draw').classList.toggle('active',!erase);$('erase').classList.toggle('active',erase);$('draw').setAttribute('aria-pressed',!erase);$('erase').setAttribute('aria-pressed',erase);}
$('draw').onclick=()=>setTool(false);$('erase').onclick=()=>setTool(true);
$('clear').onclick=()=>{if(!imageUrl)return;remember();clearMask();};
$('undo').onclick=()=>{if(history.length){mc.putImageData(history.pop(),0,0);updateMask();}};
$('hole').onclick=()=>{if(!imageUrl)return;remember();mc.fillStyle='white';mc.fillRect(maskCanvas.width*.36,maskCanvas.height*.36,maskCanvas.width*.18,maskCanvas.height*.2);updateMask();};
$('scratch').onclick=()=>{
  if(!imageUrl)return;remember();mc.strokeStyle='white';mc.lineWidth=Math.max(3,maskCanvas.width*.012);mc.lineCap='round';
  for(const x of [.31,.68]) {mc.beginPath();mc.moveTo(maskCanvas.width*x,maskCanvas.height*.12);mc.lineTo(maskCanvas.width*(x+.06),maskCanvas.height*.45);mc.lineTo(maskCanvas.width*(x-.03),maskCanvas.height*.85);mc.stroke();}
  updateMask();
};
$('file').onchange=e=>{if(e.target.files[0])loadImage(e.target.files[0],false);e.target.value='';};
async function sample() {try {const r=await fetch('/api/sample');if(!r.ok)throw new Error('Sample unavailable');await loadImage(await r.blob(),true);}catch(e){status(e.message,true);}}
$('sample').onclick=sample;
$('edit-tab').onclick=()=>viewResult(false);$('result-tab').onclick=()=>viewResult(true);
$('reference').onchange=invalidate;document.querySelectorAll('[name=method]').forEach(el=>el.onchange=invalidate);
function metric(label,value) {const el=document.createElement('div');el.className='metric';const strong=document.createElement('strong'),span=document.createElement('span');strong.textContent=value;span.textContent=label;el.append(strong,span);return el;}
$('restore').onclick=async()=>{
  if(busy||!imageUrl)return;
  setBusy(true);status('Reconstructing the selected regions…');
  try {
    const data=new FormData();
    data.append('image',await(await fetch(imageUrl)).blob(),'input.png');
    data.append('mask',await new Promise(resolve=>maskCanvas.toBlob(resolve,'image/png')),'mask.png');
    data.append('method',document.querySelector('[name=method]:checked').value);
    data.append('clean_reference',String($('reference').checked));
    const result=await jsonResponse(await fetch('/api/inpaint',{method:'POST',body:data}));
    $('restored').src=result.restored;$('masked').src=result.masked;$('edges').src=result.edges;
    $('download').href=result.restored;$('download-mask').href=result.mask;
    if(metadataUrl)URL.revokeObjectURL(metadataUrl);
    metadataUrl=URL.createObjectURL(new Blob([JSON.stringify(result.metadata,null,2)],{type:'application/json'}));
    $('download-meta').href=metadataUrl;
    const m=result.metadata;$('metrics').replaceChildren(metric('Mask coverage',`${m.coverage_percent}%`),metric('Processing time',`${m.elapsed_ms} ms`));
    if(m.metrics) {
      $('metrics').append(metric('Full-image PSNR',m.metrics.psnr_db===null?'∞ dB':`${m.metrics.psnr_db} dB`),metric('Masked PSNR',m.metrics.masked_psnr_db===null?'∞ dB':`${m.metrics.masked_psnr_db} dB`));
    } else {$('metrics').append(metric('Reference scores','No clean target'));}
    $('result-tab').disabled=false;viewResult(true);
    status(`Candidate ready · ${m.model.method || 'Edge-guided GAN'} · review before saving.`);
  } catch(error) {status(error.message,true);}finally{setBusy(false);}
};
async function init() {
  await sample();
  try {
    const s=await jsonResponse(await fetch('/api/status'));
    if(s.gan_available) {$('gan-status').textContent=`GAN ready · checkpoint step ${s.provenance.selected_step} · synthetic illustrations only.`;}
    else {$('gan').dataset.unavailable='true';$('gan').disabled=true;document.querySelector('[value=telea]').checked=true;$('gan-status').textContent=`GAN unavailable. ${s.reason} Telea is ready.`;}
  } catch(e) {$('gan-status').textContent='Could not check GAN availability.';}
}
init();
