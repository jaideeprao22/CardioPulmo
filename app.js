const $=id=>document.getElementById(id);
/* bulletproof logout (delegated, attached before anything else) */
document.addEventListener('click',function(e){
  var t=e.target;while(t&&t.id!=='authLogout')t=t.parentElement;
  if(t){e.preventDefault();
    (async function(){
      try{if(typeof sb!=='undefined'&&sb)await sb.auth.signOut();}catch(_){}
      try{for(var i=localStorage.length-1;i>=0;i--){var k=localStorage.key(i);if(k&&k.indexOf('sb-')===0)localStorage.removeItem(k);}}catch(_){}
      location.reload();
    })();
  }
},true);
const st=m=>$('status').textContent=m;
let pulmoCur='lung';
function hideAllPanes(){['p0','p1','p2','p3','p4','p5','p6'].forEach(function(id){var e=$(id);if(e)e.classList.remove('on');});}
let pendingTab=null;
function needLogin(name){
  if(sbUser)return false;
  pendingTab=name;
  var o=$('authOverlay');if(o)o.style.display='flex';
  if(typeof initGoogleBtn==='function')initGoogleBtn();
  return true;
}
function topTab(name){
  if((name==='cardio'||name==='pulmo'||name==='vasc')&&needLogin(name))return;
  hideAllPanes();
  $('tCardio').classList.toggle('on',name==='cardio');
  $('tPulmo').classList.toggle('on',name==='pulmo');
  $('tVasc').classList.toggle('on',name==='vasc');
  var _th=$('tHome');if(_th)_th.classList.toggle('on',name==='home');
  var _ta=$('tAbout');if(_ta)_ta.classList.toggle('on',name==='about');
  document.body.setAttribute('data-tab',name);
  $('pulmoSubNav').style.display=(name==='pulmo')?'flex':'none';
  if(name==='cardio'){$('p4').classList.add('on');}
  else if(name==='pulmo'){pulmoSub(pulmoCur);}
  else if(name==='vasc'){$('p2').classList.add('on');}
  else if(name==='about'){$('p6').classList.add('on');}
  else if(name==='home'){var _h=$('p0');if(_h)_h.classList.add('on');}
  try{window.scrollTo(0,0);}catch(e){}
}
function pulmoSub(which){
  pulmoCur=which;
  $('p5').classList.toggle('on',which==='lung');
  $('p1').classList.toggle('on',which==='perc');
  $('p3').classList.toggle('on',which==='echo');
  $('psLung').classList.toggle('on',which==='lung');
  $('psPerc').classList.toggle('on',which==='perc');
  $('psEcho').classList.toggle('on',which==='echo');
}
function dl(b,name){const a=document.createElement('a');a.href=URL.createObjectURL(b);a.download=name;a.click();}
function fft(re,im){const n=re.length;
  for(let i=1,j=0;i<n;i++){let bit=n>>1;for(;j&bit;bit>>=1)j^=bit;j^=bit;if(i<j){let tr=re[i];re[i]=re[j];re[j]=tr;let ti=im[i];im[i]=im[j];im[j]=ti;}}
  for(let len=2;len<=n;len<<=1){const ang=-2*Math.PI/len,wr=Math.cos(ang),wi=Math.sin(ang);
   for(let i=0;i<n;i+=len){let cr=1,ci=0;for(let k=0;k<len/2;k++){
    const ur=re[i+k],ui=im[i+k],vr=re[i+k+len/2]*cr-im[i+k+len/2]*ci,vi=re[i+k+len/2]*ci+im[i+k+len/2]*cr;
    re[i+k]=ur+vr;im[i+k]=ui+vi;re[i+k+len/2]=ur-vr;im[i+k+len/2]=ui-vi;const ncr=cr*wr-ci*wi;ci=cr*wi+ci*wr;cr=ncr;}}}}

/* ===================== PERCUSSION ===================== */
const Z=[
 {id:'R Supraclavicular',code:'Sc',view:'F',px:41,py:15},{id:'L Supraclavicular',code:'Sc',view:'F',px:60,py:15},
 {id:'R Infraclavicular',code:'Ic',view:'F',px:37,py:25},{id:'L Infraclavicular',code:'Ic',view:'F',px:64,py:25},
 {id:'R Mammary',code:'M',view:'F',px:37,py:38},{id:'L Mammary',code:'M',view:'F',px:65,py:38},
 {id:'R Inframammary',code:'Im',view:'F',px:35.5,py:52},{id:'L Inframammary',code:'Im',view:'F',px:66.5,py:52},
 {id:'R Axillary',code:'Ax',view:'F',px:20,py:40},{id:'L Axillary',code:'Ax',view:'F',px:80,py:40},
 {id:'R Infra-axillary',code:'IA',view:'F',px:22,py:58},{id:'L Infra-axillary',code:'IA',view:'F',px:78,py:58},
 {id:'R Suprascapular',code:'Ss',view:'B',px:62,py:22},{id:'L Suprascapular',code:'Ss',view:'B',px:38,py:22},
 {id:'R Interscapular',code:'In',view:'B',px:57,py:38},{id:'L Interscapular',code:'In',view:'B',px:43,py:38},
 {id:'R Infrascapular',code:'If',view:'B',px:61,py:53},{id:'L Infrascapular',code:'If',view:'B',px:39,py:53}
];
let state={},selected=null,refFeat=null,refZone=null,wavBlob=null,rows=[],pView='F';
function resetState(){state={};Z.forEach(z=>state[z.id]={status:'pending',feat:null,isRef:false,flag:false});selected=null;refFeat=null;refZone=null;$('resCard').style.display='none';$('selName').textContent='Tap a zone on the body above.';$('recBtn').textContent='● Select a zone first';$('recBtn').disabled=true;renderBody();}
function zoneColor(s){if(s.status==='active')return '#FFB454';if(s.status==='done')return '#2FBF8F';return '#5A6B94';}
function renderBody(){
  const g=$('zones');g.innerHTML='';
  Z.forEach(z=>{if(z.view!==pView)return;const s=state[z.id];
   const d=document.createElement('div');d.className='dot2';
   d.style.left=z.px+'%';d.style.top=z.py+'%';d.style.width='5.6%';d.textContent=z.code;d.style.fontSize='9px';
   d.style.background=zoneColor(s);
   if(z.id===selected){d.style.borderColor='#fff';d.style.borderWidth='3px';d.style.boxShadow='0 0 0 4px rgba(255,255,255,.3)';}
   else if(s.isRef){d.style.borderColor='#56d4dd';d.style.borderWidth='3px';}
   else if(s.flag){d.style.borderColor='#FF6B81';d.style.borderWidth='3px';}
   d.onclick=()=>selectZone(z.id);g.appendChild(d);});
}
function setPView(v){pView=v;$('pImg').src=(v==='F'?'front.jpg':'back.jpg');
  $('pBanner').textContent=(v==='F'?"FRONT view · image-LEFT = patient's RIGHT":"BACK view · image-RIGHT = patient's RIGHT");
  $('pvF').classList.toggle('on',v==='F');$('pvB').classList.toggle('on',v==='B');renderBody();}
function selectZone(id){
  Z.forEach(z=>{const zs=state[z.id];if(z.id!==id&&zs.status==='active')zs.status=zs.feat?'done':'pending';});
  selected=id;state[id].status='active';
  $('selName').innerHTML='Selected: <b>'+id+'</b>'+(state[id].isRef?' (REFERENCE)':'');
  $('recBtn').disabled=false;
  $('recBtn').textContent = refFeat===null ? '● Record REFERENCE on '+id : '● Record '+id;
  renderBody();
}
resetState();

let stream,ctx,proc,zg,buf=[],fs=48000,timer,tLeft;
$('recBtn').onclick=async()=>{
  if(!selected){st('Tap a zone on the body first.');return;}
  if(!$('pid').value){st('Enter a Patient ID first.');return;}
  try{stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false,channelCount:1}});}
  catch(e){st('Microphone blocked. Allow mic access and reload.');return;}
  ctx=new (window.AudioContext||window.webkitAudioContext)();fs=ctx.sampleRate;buf=[];
  const src=ctx.createMediaStreamSource(stream);proc=ctx.createScriptProcessor(4096,1,1);zg=ctx.createGain();zg.gain.value=0;
  proc.onaudioprocess=e=>buf.push(new Float32Array(e.inputBuffer.getChannelData(0)));
  src.connect(proc);proc.connect(zg);zg.connect(ctx.destination);
  $('recBtn').disabled=true;$('stopBtn').disabled=false;$('resCard').style.display='none';
  tLeft=9;st('● Recording '+selected+'… tap 5–6× ('+tLeft+'s)');
  timer=setInterval(()=>{tLeft--;st('● Recording '+selected+'… tap 5–6× ('+tLeft+'s)');if(tLeft<=0)stopRec();},1000);
};
$('stopBtn').onclick=stopRec;
function stopRec(){
  clearInterval(timer);try{proc.disconnect();}catch(e){}
  stream.getTracks().forEach(t=>t.stop());$('stopBtn').disabled=true;$('recBtn').disabled=false;st('Analysing…');
  let n=0;buf.forEach(b=>n+=b.length);
  if(n<fs){st('Too short. Try again.');ctx.close();return;}
  const s=new Float32Array(n);let o=0;buf.forEach(b=>{s.set(b,o);o+=b.length;});ctx.close();
  wavBlob=encodeWAV(s,fs);const p=$('player');p.src=URL.createObjectURL(wavBlob);p.style.display='block';
  const feat=analyze(s,fs);if(!feat)return;
  drawTaps(feat.s,feat.taps);setZoneResult(selected,feat);
}
function tapFeatures(s,start,fs){
  const N=4096,re=new Float32Array(N),im=new Float32Array(N),seg=Math.min(N,s.length-start);
  for(let i=0;i<seg;i++){const w=0.5-0.5*Math.cos(2*Math.PI*i/(seg-1||1));re[i]=s[start+i]*w;}
  fft(re,im);const binHz=fs/N;let pk=0,pkV=0,sumM=0,sumFM=0,lowE=0,highE=0;
  for(let b=Math.ceil(50/binHz);b<=Math.floor(2000/binHz);b++){const m=Math.hypot(re[b],im[b]),f=b*binHz;
   if(m>pkV){pkV=m;pk=f;}sumM+=m;sumFM+=f*m;if(f<300)lowE+=m*m;else if(f<1200)highE+=m*m;}
  const centroid=sumM>0?sumFM/sumM:0,lh=lowE/(highE+1e-9);
  let peakIdx=0,peakAbs=0;const wlen=Math.min(2000,s.length-start);
  for(let i=0;i<wlen;i++){const a=Math.abs(s[start+i]);if(a>peakAbs){peakAbs=a;peakIdx=i;}}
  let dEnd=wlen;for(let i=peakIdx;i<wlen;i++){if(Math.abs(s[start+i])<0.1*peakAbs){dEnd=i;break;}}
  let decayMs=(dEnd-peakIdx)/fs*1000;if(decayMs>400)decayMs=400;return{pk,centroid,lh,decayMs};
}
function analyze(s,fs){
  const F=256,nf=Math.floor(s.length/F),en=new Float32Array(nf);let maxE=0;
  for(let i=0;i<nf;i++){let e=0;for(let j=0;j<F;j++){const v=s[i*F+j];e+=v*v;}en[i]=e;if(e>maxE)maxE=e;}
  const thr=0.18*maxE,sep=Math.round(0.35*fs/F);let taps=[],lastF=-999;
  for(let i=1;i<nf-1;i++){if(en[i]>thr&&en[i]>=en[i-1]&&en[i]>=en[i+1]&&i-lastF>=sep){taps.push(i*F);lastF=i;if(taps.length>=10)break;}}
  if(taps.length===0){st('No clear taps detected. Tap harder / quieter room, retry.');return null;}
  const med=a=>{a=a.slice().sort((x,y)=>x-y);return a[Math.floor(a.length/2)];};
  const pks=[],ces=[],lhs=[],dcs=[];
  taps.forEach(t=>{const f=tapFeatures(s,t,fs);pks.push(f.pk);ces.push(f.centroid);lhs.push(f.lh);dcs.push(f.decayMs);});
  return{pk:med(pks),ce:med(ces),lh:med(lhs),dc:med(dcs),nt:taps.length,taps,s};
}
function setZoneResult(id,feat){
  const z=state[id];z.feat={pk:feat.pk,ce:feat.ce,lh:feat.lh,dc:feat.dc};
  $('pk').textContent=Math.round(feat.pk);$('ce').textContent=Math.round(feat.ce);
  $('lh').textContent=feat.lh.toFixed(2);$('dc').textContent=Math.round(feat.dc);
  let lhDrop='',dcDrop='';
  if(refFeat===null){refFeat=z.feat;refZone=id;z.isRef=true;z.flag=false;z.status='done';
    $('cls').textContent='Reference set';$('cls').style.color='var(--ref)';st('Reference set on '+id+'. Now tap suspicious zones.');}
  else{
    lhDrop=((refFeat.lh-feat.lh)/refFeat.lh)*100;dcDrop=((refFeat.dc-feat.dc)/refFeat.dc)*100;
    z.flag=(lhDrop>25||dcDrop>30);z.status='done';
    if(z.flag){$('cls').textContent='DULLER than reference (flag)';$('cls').style.color='var(--bad)';}
    else{$('cls').textContent='Similar to reference';$('cls').style.color='var(--ok)';}
    st('Recorded '+id+'. lh drop '+lhDrop.toFixed(0)+'% · decay drop '+dcDrop.toFixed(0)+'%.');
  }
  $('resCard').style.display='block';
  rows.push({pid:$('pid').value,age:$('age').value,sex:$('sex').value,ref:$('ref').value,pos:$('pos').value,
    zone:id,isRef:z.isRef?'YES':'',nt:feat.nt,pk:Math.round(feat.pk),ce:Math.round(feat.ce),lh:feat.lh.toFixed(2),dc:Math.round(feat.dc),
    rlh:refFeat?refFeat.lh.toFixed(2):'',rdc:refFeat?Math.round(refFeat.dc):'',
    lhd:lhDrop===''?'':lhDrop.toFixed(0),dcd:dcDrop===''?'':dcDrop.toFixed(0),flag:z.flag?'FLAG':'',t:new Date().toISOString()});
  renderLog();$('logCard').style.display='block';renderBody();
}
function drawTaps(s,taps){
  const c=$('wave');c.style.display='block';c.width=c.clientWidth*2;c.height=220;
  const g=c.getContext('2d'),W=c.width,H=c.height,step=Math.floor(s.length/W)||1;
  g.fillStyle='#070B16';g.fillRect(0,0,W,H);g.strokeStyle='#4CC9F0';g.lineWidth=1;g.beginPath();
  for(let x=0;x<W;x++){let mn=1,mx=-1;for(let j=0;j<step;j++){const v=s[x*step+j]||0;mn=Math.min(mn,v);mx=Math.max(mx,v);}g.moveTo(x,H/2*(1-mx));g.lineTo(x,H/2*(1-mn));}
  g.stroke();g.strokeStyle='#3FDFA0';g.lineWidth=2;
  taps.forEach(t=>{const x=Math.floor(t/step);g.beginPath();g.moveTo(x,0);g.lineTo(x,H);g.stroke();});
}
$('dlAudio').onclick=()=>{if(wavBlob)dl(wavBlob,($('pid').value||'rec')+'_'+(selected||'z')+'_'+Date.now()+'.wav');};
$('newPt').onclick=()=>{resetState();st('Cleared. Ready for next patient.');};
$('dlCsv').onclick=()=>{let c='patient_id,age,sex,reference_dx,position,zone,is_reference,n_taps,peak_hz,centroid_hz,low_high,decay_ms,ref_low_high,ref_decay_ms,lh_drop_pct,decay_drop_pct,flag,datetime\n';
  rows.forEach(r=>c+=[r.pid,r.age,r.sex,'"'+(r.ref||'')+'"',r.pos,r.zone,r.isRef,r.nt,r.pk,r.ce,r.lh,r.dc,r.rlh,r.rdc,r.lhd,r.dcd,r.flag,r.t].join(',')+'\n');
  dl(new Blob([c],{type:'text/csv'}),'cardiopulmo_percussion.csv');};
function renderLog(){let h='<table><tr><th>ID</th><th>Zone</th><th>Pos</th><th>L:H</th><th>Decay</th><th>Δlh%</th><th>Flag</th></tr>';
  rows.forEach(r=>h+='<tr><td>'+r.pid+'</td><td>'+r.zone+(r.isRef?'*':'')+'</td><td>'+r.pos.slice(0,3)+'</td><td>'+r.lh+'</td><td>'+r.dc+'</td><td>'+(r.lhd||'')+'</td><td>'+r.flag+'</td></tr>');
  $('logTable').innerHTML=h+'</table>';}
function encodeWAV(s,rate){const n=s.length,bf=new ArrayBuffer(44+n*2),v=new DataView(bf);
  const ws=(o,t)=>{for(let i=0;i<t.length;i++)v.setUint8(o+i,t.charCodeAt(i));};
  ws(0,'RIFF');v.setUint32(4,36+n*2,true);ws(8,'WAVE');ws(12,'fmt ');v.setUint32(16,16,true);
  v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,rate,true);v.setUint32(28,rate*2,true);
  v.setUint16(32,2,true);v.setUint16(34,16,true);ws(36,'data');v.setUint32(40,n*2,true);
  let o=44;for(let i=0;i<n;i++){let x=Math.max(-1,Math.min(1,s[i]));v.setInt16(o,x<0?x*0x8000:x*0x7FFF,true);o+=2;}
  return new Blob([bf],{type:'audio/wav'});}

/* ===================== VASCAGE ===================== */
let vStream=null,vTorch=false,vData=[],vTimes=[],vRAF=null,vRunning=false,vRows=[],vDur=20000,vT0=0,vTmp=null;
const vst=m=>$('vStatus').textContent=m;
function vSpot(col){var e=$('vSpot');if(e)e.setAttribute('fill',col);}
function vTally(){
  const sm=$('vSmoke').value==='Yes',ht=$('vHtn').value==='Yes',dm=$('vDm').value==='Yes';
  const h=parseFloat($('vHt').value),w=parseFloat($('vWt').value);
  let bmi=(h>0&&w>0)?w/((h/100)*(h/100)):null;
  const age=parseFloat($('age').value)||0;
  let n=0;if(sm)n++;if(ht)n++;if(dm)n++;if(bmi&&bmi>=25)n++;if(age>=60)n++;
  return{sm,ht,dm,bmi,n};
}
$('vBtn').onclick=async()=>{
  if(!$('pid').value){vst('Enter Patient ID (top of page) first.');return;}
  try{vStream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'},width:{ideal:640},height:{ideal:480}},audio:false});}
  catch(e){vst('Camera blocked. Allow camera and reload.');return;}
  const track=vStream.getVideoTracks()[0];vTorch=false;
  try{const caps=track.getCapabilities?track.getCapabilities():{};if(caps.torch){await track.applyConstraints({advanced:[{torch:true}]});vTorch=true;}}catch(e){}
  const vid=$('vVid');vid.srcObject=vStream;try{await vid.play();}catch(e){}
  vData=[];vTimes=[];vRunning=true;vT0=performance.now();vSpot('#FFB454');
  $('vBtn').disabled=true;$('vStop').disabled=false;$('vResCard').style.display='none';
  if(!vTmp){vTmp=document.createElement('canvas');vTmp.width=50;vTmp.height=50;}
  const cc=vTmp.getContext('2d',{willReadFrequently:true});
  function frame(){
    if(!vRunning)return;const now=performance.now();
    try{cc.drawImage(vid,0,0,50,50);const d=cc.getImageData(0,0,50,50).data;let r=0;for(let i=0;i<d.length;i+=4)r+=d[i];r/=(d.length/4);vData.push(r);vTimes.push(now-vT0);}catch(e){}
    const left=Math.max(0,vDur-(now-vT0));
    vst((vTorch?'Torch ON. ':'No torch—bright light. ')+'Recording '+(left/1000).toFixed(0)+'s — hold finger still');
    vDrawLive();
    if(now-vT0>=vDur){vStop();return;}
    vRAF=requestAnimationFrame(frame);
  }
  vRAF=requestAnimationFrame(frame);
};
$('vStop').onclick=vStop;
function vStop(){
  vRunning=false;if(vRAF)cancelAnimationFrame(vRAF);
  if(vStream)vStream.getTracks().forEach(t=>t.stop());
  $('vBtn').disabled=false;$('vStop').disabled=true;
  if(vData.length<30){vst('No signal captured. Cover the lens+flash fully and retry.');vSpot('#5A6B94');return;}
  vAnalyze();
}
function vAnalyze(){
  const red=vData.slice(),t=vTimes.slice(),N=red.length;
  const durSec=(t[N-1]-t[0])/1000||1,sr=N/durSec;
  const w=Math.max(2,Math.round(0.75*sr)),detr=new Float32Array(N);
  for(let i=0;i<N;i++){let a=0,c=0;for(let j=Math.max(0,i-w);j<=Math.min(N-1,i+w);j++){a+=red[j];c++;}detr[i]=red[i]-a/c;}
  let mx=0;for(let i=0;i<N;i++)mx=Math.max(mx,Math.abs(detr[i]));if(mx>0)for(let i=0;i<N;i++)detr[i]/=mx;
  const thr=0.3;let peaks=[],lastT=-1;
  for(let i=1;i<N-1;i++){if(detr[i]>thr&&detr[i]>=detr[i-1]&&detr[i]>detr[i+1]){if(lastT<0||t[i]-lastT>=400){peaks.push(i);lastT=t[i];}}}
  let ibis=[];for(let k=1;k<peaks.length;k++){const d=t[peaks[k]]-t[peaks[k-1]];if(d>=300&&d<=1500)ibis.push(d);}
  if(ibis.length<5){vst('Weak / irregular signal — retry in better light, very still.');vShow('—','—','—','Weak');return;}
  const med=a=>{a=a.slice().sort((x,y)=>x-y);return a[Math.floor(a.length/2)];};
  const ibi=med(ibis),hr=Math.round(60000/ibi);
  const mean=ibis.reduce((p,c)=>p+c,0)/ibis.length;const sd=Math.sqrt(ibis.reduce((p,c)=>p+(c-mean)*(c-mean),0)/ibis.length);
  let ris=[];
  for(let k=1;k<peaks.length;k++){const a=peaks[k-1],b=peaks[k];
    let sysV=detr[a],sysI=a;for(let i=a;i<b;i++)if(detr[i]>sysV){sysV=detr[i];sysI=i;}
    let secV=-2,secI=-1;for(let i=sysI+1;i<b-1;i++){if(detr[i]>detr[i-1]&&detr[i]>detr[i+1]&&detr[i]>secV){secV=detr[i];secI=i;}}
    if(secI>0){const footV=Math.min(detr[a],detr[b]);const denom=(sysV-footV)||1;const ri=(secV-footV)/denom;if(ri>0&&ri<1.2)ris.push(ri);}
  }
  const ri=ris.length>=2?(ris.reduce((p,c)=>p+c,0)/ris.length).toFixed(2):'—';
  const q=(ibis.length>=10&&(sd/mean)<0.25)?'Good':'Fair';
  vShow(hr,Math.round(sd),ri,q);
  vDrawFinal(detr,t,peaks);
  const tl=vTally();
  vRows.push({pid:$('pid').value,age:$('age').value,sex:$('sex').value,sm:tl.sm?'Y':'N',ht:tl.ht?'Y':'N',dm:tl.dm?'Y':'N',
    h:$('vHt').value,w:$('vWt').value,bmi:tl.bmi?tl.bmi.toFixed(1):'',rt:tl.n,hr:hr,ibi:Math.round(ibi),sdnn:Math.round(sd),ri:ri,q:q,t:new Date().toISOString()});
  vRenderLog();$('vLogCard').style.display='block';
}
function vShow(hr,sdnn,ri,q){$('vHR').textContent=hr;$('vSDNN').textContent=sdnn;$('vRI').textContent=ri;$('vQ').textContent=q;
  vSpot(hr==='—'?'#5A6B94':'#2FBF8F');
  const tl=vTally();$('vTallyN').textContent=tl.n+(tl.bmi?(' · BMI '+tl.bmi.toFixed(1)):'');$('vResCard').style.display='block';}
function vDrawLive(){
  const c=$('vWave');c.style.display='block';c.width=c.clientWidth*2;c.height=180;
  const g=c.getContext('2d'),W=c.width,H=c.height,n=Math.min(vData.length,300);
  g.fillStyle='#070B16';g.fillRect(0,0,W,H);if(n<2)return;
  const seg=vData.slice(vData.length-n);let mn=Math.min.apply(null,seg),mx=Math.max.apply(null,seg),rng=(mx-mn)||1;
  g.strokeStyle='#FF6B81';g.lineWidth=2;g.beginPath();
  for(let i=0;i<n;i++){const x=i/(n-1)*W,y=H-((seg[i]-mn)/rng)*H*0.9-H*0.05;i?g.lineTo(x,y):g.moveTo(x,y);}g.stroke();
}
function vDrawFinal(detr,t,peaks){
  const c=$('vWave');c.style.display='block';c.width=c.clientWidth*2;c.height=180;
  const g=c.getContext('2d'),W=c.width,H=c.height,N=detr.length;
  g.fillStyle='#070B16';g.fillRect(0,0,W,H);g.strokeStyle='#4CC9F0';g.lineWidth=1.5;g.beginPath();
  for(let i=0;i<N;i++){const x=i/(N-1)*W,y=H/2-detr[i]*H*0.42;i?g.lineTo(x,y):g.moveTo(x,y);}g.stroke();
  g.fillStyle='#3FDFA0';peaks.forEach(p=>{const x=p/(N-1)*W,y=H/2-detr[p]*H*0.42;g.beginPath();g.arc(x,y,4,0,6.2832);g.fill();});
}
$('vCsv').onclick=()=>{let c='patient_id,age,sex,smoker,hypertension,diabetes,height_cm,weight_kg,bmi,risk_tally,heart_rate_bpm,ibi_ms,sdnn_ms,reflection_index,signal_quality,datetime\n';
  vRows.forEach(r=>c+=[r.pid,r.age,r.sex,r.sm,r.ht,r.dm,r.h,r.w,r.bmi,r.rt,r.hr,r.ibi,r.sdnn,r.ri,r.q,r.t].join(',')+'\n');
  dl(new Blob([c],{type:'text/csv'}),'cardiopulmo_vascage.csv');};
function vRenderLog(){let h='<table><tr><th>ID</th><th>HR</th><th>SDNN</th><th>RI</th><th>BMI</th><th>RF</th><th>Q</th></tr>';
  vRows.forEach(r=>h+='<tr><td>'+r.pid+'</td><td>'+r.hr+'</td><td>'+r.sdnn+'</td><td>'+r.ri+'</td><td>'+(r.bmi||'')+'</td><td>'+r.rt+'</td><td>'+r.q+'</td></tr>');
  $('vLogTable').innerHTML=h+'</table>';}

/* ===================== ECHOLAT ===================== */
const ES=[{id:'R',px:64.07,py:63.27},{id:'L',px:35.41,py:63.27}];
let eStream=null,eCtx=null,eProc=null,eZg=null,eBuf=[],eFs=48000,eTimer=null,eLeft=0,eSide=null;
let eRecR=null,eRecL=null,eFeatR=null,eFeatL=null,eRows=[],eState={R:'pending',L:'pending'},eSel=null;
const est=m=>$('eStatus').textContent=m;
function eColor(s){return s==='active'?'#FFB454':s==='done'?'#2FBF8F':'#5A6B94';}
function eRender(){
  const g=$('espots');g.innerHTML='';
  ES.forEach(z=>{const d=document.createElement('div');d.className='dot2';
   d.style.left=z.px+'%';d.style.top=z.py+'%';d.style.width='5.8%';
   d.style.background=eColor(eState[z.id]);d.textContent=z.id;
   if(z.id===eSel){d.style.borderColor='#fff';d.style.borderWidth='3px';d.style.boxShadow='0 0 0 4px rgba(255,255,255,.3)';}
   d.onclick=()=>eSelect(z.id);g.appendChild(d);});
}
function eSettle(side){const rec=side==='R'?eRecR:eRecL;eState[side]=rec?'done':'pending';}
function eSelect(side){
  if(eSel&&eSel!==side)eSettle(eSel);
  eSel=side;eState[side]='active';eRender();
  $('eSelName').innerHTML='Selected: <b>'+side+' lung</b>';
  $('eRec').disabled=false;$('eRec').textContent='● Record '+side+' lung (15s)';
}
eRender();
$('eRec').onclick=()=>{if(eSel)eStart(eSel);};
function eStart(side){
  if(!$('pid').value){est('Enter Patient ID (top) first.');return;}
  eSide=side;
  navigator.mediaDevices.getUserMedia({audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false,channelCount:1}}).then(s=>{
    eStream=s;eCtx=new (window.AudioContext||window.webkitAudioContext)();eFs=eCtx.sampleRate;eBuf=[];
    const src=eCtx.createMediaStreamSource(s);eProc=eCtx.createScriptProcessor(4096,1,1);eZg=eCtx.createGain();eZg.gain.value=0;
    eProc.onaudioprocess=ev=>eBuf.push(new Float32Array(ev.inputBuffer.getChannelData(0)));
    src.connect(eProc);eProc.connect(eZg);eZg.connect(eCtx.destination);
    eState[side]='active';eRender();
    $('eRec').disabled=true;
    eLeft=15;est('● Recording '+side+' lung… slow deep breaths ('+eLeft+'s)');
    eTimer=setInterval(()=>{eLeft--;est('● Recording '+side+' lung… ('+eLeft+'s)');if(eLeft<=0)eStop();},1000);
  }).catch(e=>est('Microphone blocked. Allow mic and reload.'));
}
function eStop(){
  clearInterval(eTimer);try{eProc.disconnect();}catch(e){}
  if(eStream)eStream.getTracks().forEach(t=>t.stop());
  $('eRec').disabled=false;
  let n=0;eBuf.forEach(b=>n+=b.length);
  if(n<eFs){est('Too short. Retry.');try{eCtx.close();}catch(e){}return;}
  const arr=new Float32Array(n);let o=0;eBuf.forEach(b=>{arr.set(b,o);o+=b.length;});try{eCtx.close();}catch(e){}
  if(eSide==='R')eRecR=arr;else eRecL=arr;
  eState[eSide]='done';eRender();
  est((eRecR?'R ✓ ':'R … ')+(eRecL?'L ✓':'L …')+(eRecR&&eRecL?' — analysing':' — tap the other side'));
  if(eRecR&&eRecL)eAnalyze();
}
function eSpectrum(s,fs){
  const N=4096,step=2048,re=new Float32Array(N),im=new Float32Array(N),pw=new Float32Array(N/2);let frames=0;
  for(let off=0;off+N<=s.length;off+=step){
    for(let i=0;i<N;i++){const w=0.5-0.5*Math.cos(2*Math.PI*i/(N-1));re[i]=s[off+i]*w;im[i]=0;}
    fft(re,im);for(let b=0;b<N/2;b++)pw[b]+=re[b]*re[b]+im[b]*im[b];frames++;
  }
  if(frames>0)for(let b=0;b<N/2;b++)pw[b]/=frames;
  return{pw,binHz:fs/N};
}
function eFeatures(s,fs){
  const sp=eSpectrum(s,fs),pw=sp.pw,binHz=sp.binHz;
  let pLo=0,pHf=0,sumP=0,sumFP=0,logsum=0,lin=0,cnt=0;
  for(let b=0;b<pw.length;b++){const f=b*binHz;if(f<50||f>1000)continue;sumP+=pw[b];sumFP+=f*pw[b];pLo+=pw[b];if(f>=200)pHf+=pw[b];}
  for(let b=0;b<pw.length;b++){const f=b*binHz;if(f<200||f>1000)continue;const v=pw[b]+1e-12;logsum+=Math.log(v);lin+=v;cnt++;}
  const sfm=cnt>0?Math.exp(logsum/cnt)/(lin/cnt):1;
  return{hf:pLo>0?pHf/pLo:0,centroid:sumP>0?sumFP/sumP:0,sfm:sfm};
}
function eAnalyze(){
  eFeatR=eFeatures(eRecR,eFs);eFeatL=eFeatures(eRecL,eFs);
  $('eHFr').textContent=(eFeatR.hf*100).toFixed(0);$('eHFl').textContent=(eFeatL.hf*100).toFixed(0);
  $('eCr').textContent=Math.round(eFeatR.centroid);$('eCl').textContent=Math.round(eFeatL.centroid);
  const diff=(eFeatL.hf-eFeatR.hf)*100;let verdict,col;
  if(Math.abs(diff)>=15){const side=diff>0?'LEFT':'RIGHT';verdict='Asymmetry: more high-freq (adventitious) energy on the '+side;col='var(--bad)';}
  else{verdict='Symmetric high-freq energy';col='var(--ok)';}
  let tons=[];if(eFeatR.sfm<0.4)tons.push('R tonal/wheeze-like');if(eFeatL.sfm<0.4)tons.push('L tonal/wheeze-like');
  $('eVerdict').textContent=verdict+(tons.length?(' · '+tons.join(', ')):'');$('eVerdict').style.color=col;
  $('eResCard').style.display='block';
  eRows.push({pid:$('pid').value,age:$('age').value,sex:$('sex').value,hfr:(eFeatR.hf*100).toFixed(0),hfl:(eFeatL.hf*100).toFixed(0),
    cr:Math.round(eFeatR.centroid),cl:Math.round(eFeatL.centroid),sfmr:eFeatR.sfm.toFixed(2),sfml:eFeatL.sfm.toFixed(2),diff:diff.toFixed(0),verdict:verdict,t:new Date().toISOString()});
  eRenderLog();$('eLogCard').style.display='block';
}
$('eCsv').onclick=()=>{let c='patient_id,age,sex,hf_pct_R,hf_pct_L,centroid_R,centroid_L,flatness_R,flatness_L,hf_diff_pp,verdict,datetime\n';
  eRows.forEach(r=>c+=[r.pid,r.age,r.sex,r.hfr,r.hfl,r.cr,r.cl,r.sfmr,r.sfml,r.diff,'"'+r.verdict+'"',r.t].join(',')+'\n');
  dl(new Blob([c],{type:'text/csv'}),'cardiopulmo_echolat.csv');};
function eRenderLog(){let h='<table><tr><th>ID</th><th>HF R%</th><th>HF L%</th><th>Δpp</th><th>Verdict</th></tr>';
  eRows.forEach(r=>h+='<tr><td>'+r.pid+'</td><td>'+r.hfr+'</td><td>'+r.hfl+'</td><td>'+r.diff+'</td><td>'+r.verdict.split(':')[0]+'</td></tr>');
  $('eLogTable').innerHTML=h+'</table>';}

/* ===================== CARDIOSCOPE ===================== */
function csTab(which){const map={a:'csA',b:'csB',c:'csC'},btn={a:'csTabA',b:'csTabB',c:'csTabC'};
  for(const k in map){$(map[k]).style.display=(k===which)?'block':'none';
    $(btn[k]).style.background=(k===which)?'rgba(93,124,255,.22)':'rgba(16,24,48,.6)';
    $(btn[k]).style.border=(k===which)?'1px solid var(--acc)':'1px solid var(--line)';}}
$('csTabA').onclick=()=>csTab('a');$('csTabB').onclick=()=>csTab('b');$('csTabC').onclick=()=>csTab('c');

/* shared: detrend + time-domain beat detection */
function detectBeats(sig,t,minMs){const N=sig.length;
  const durSec=(t[N-1]-t[0])/1000||1,sr=N/durSec;
  const w=Math.max(2,Math.round(0.6*sr)),d=new Float32Array(N);
  for(let i=0;i<N;i++){let a=0,c=0;for(let j=Math.max(0,i-w);j<=Math.min(N-1,i+w);j++){a+=sig[j];c++;}d[i]=sig[i]-a/c;}
  let mx=0;for(let i=0;i<N;i++)mx=Math.max(mx,Math.abs(d[i]));if(mx>0)for(let i=0;i<N;i++)d[i]/=mx;
  const thr=0.3;let peaks=[],lastT=-1;
  for(let i=1;i<N-1;i++){if(d[i]>thr&&d[i]>=d[i-1]&&d[i]>d[i+1]){if(lastT<0||t[i]-lastT>=minMs){peaks.push(i);lastT=t[i];}}}
  return{d,peaks,sr};}
function rrStats(peaks,t){let rr=[];for(let k=1;k<peaks.length;k++)rr.push(t[peaks[k]]-t[peaks[k-1]]);
  const good=rr.filter(v=>v>=300&&v<=1800);if(good.length<4)return null;
  const med=a=>{a=a.slice().sort((x,y)=>x-y);return a[Math.floor(a.length/2)];};
  const mean=good.reduce((p,c)=>p+c,0)/good.length;
  const sd=Math.sqrt(good.reduce((p,c)=>p+(c-mean)*(c-mean),0)/good.length);
  let irr=0;good.forEach(v=>{if(Math.abs(v-mean)/mean>0.20)irr++;});
  return{rr:good,hr:Math.round(60000/med(good)),meanRR:Math.round(mean),sd:Math.round(sd),irrFrac:irr/good.length};}

/* --- Rhythm via accelerometer (SCG) --- */
let csRun=false,csMag=[],csT=[],csT0=0,csWake=null,csHandler=null,csTimer=null,csRows=[];
const csSt=m=>$('csStatus').textContent=m;
$('csRec').onclick=async()=>{
  if(!$('pid').value){csSt('Enter Patient ID (top of page) first.');return;}
  try{if(typeof DeviceMotionEvent!=='undefined'&&typeof DeviceMotionEvent.requestPermission==='function'){
    const p=await DeviceMotionEvent.requestPermission();if(p!=='granted'){csSt('Motion access denied — enable Motion & Orientation in Settings, reload.');return;}}}catch(e){}
  if(typeof DeviceMotionEvent==='undefined'){csSt('No motion sensor exposed by this browser — use the native app for rhythm.');return;}
  csMag=[];csT=[];csRun=true;csT0=performance.now();
  try{if(navigator.wakeLock)csWake=await navigator.wakeLock.request('screen');}catch(e){csWake=null;}
  $('csRec').disabled=true;$('csStop').disabled=false;$('csResCard').style.display='none';
  csHandler=ev=>{if(!csRun)return;let a=ev.acceleration;if(!a||a.x==null)a=ev.accelerationIncludingGravity;if(!a||a.x==null)return;
    csMag.push(Math.sqrt(a.x*a.x+a.y*a.y+a.z*a.z));csT.push(performance.now()-csT0);csDrawLive();};
  window.addEventListener('devicemotion',csHandler);
  let left=60;csSt('● Recording… phone flat & still on chest ('+left+'s)');
  csTimer=setInterval(()=>{left--;csSt('● Recording… still ('+left+'s)');if(left<=0)csStopR();},1000);
  setTimeout(()=>{if(csRun&&csMag.length<20){csSt('No motion data arriving — sensor blocked. Use the native app.');csStopR();}},3000);};
$('csStop').onclick=csStopR;
function csStopR(){csRun=false;clearInterval(csTimer);
  if(csHandler)window.removeEventListener('devicemotion',csHandler);
  if(csWake){try{csWake.release();}catch(e){}csWake=null;}
  $('csRec').disabled=false;$('csStop').disabled=true;
  if(csMag.length<60){csSt('Too little signal. Lie still, phone flat on the sternum, retry.');return;}
  csAnalyze();}
function csAnalyze(){
  const r=detectBeats(csMag,csT,300),stt=rrStats(r.peaks,csT);
  csDrawFinal(r.d,r.peaks);
  if(!stt){$('csVerdict').textContent='Signal too weak to read';$('csVerdict').style.color='var(--mut)';
    $('csHR').textContent='—';$('csRR').textContent='—';$('csSD').textContent='—';$('csQ').textContent='Poor';
    $('csResCard').style.display='block';csSt('Weak SCG. Lie down, phone flat on lower sternum, fully still.');return;}
  const q=r.sr>=40&&stt.rr.length>=15?'Good':(stt.rr.length>=8?'Fair':'Low');
  let verdict,col;if(stt.irrFrac>=0.20){verdict='Irregular rhythm flag ⚠';col='var(--bad)';}else{verdict='Regular rhythm';col='var(--ok)';}
  $('csVerdict').textContent=verdict+' · ~'+r.sr.toFixed(0)+' Hz';$('csVerdict').style.color=col;
  $('csHR').textContent=stt.hr;$('csRR').textContent=stt.meanRR;$('csSD').textContent=stt.sd;$('csQ').textContent=q;
  $('csResCard').style.display='block';csSt('Done. Tap Start to repeat.');
  csRows.push({pid:$('pid').value,age:$('age').value,sex:$('sex').value,hr:stt.hr,meanRR:stt.meanRR,sdnn:stt.sd,
    irr:(stt.irrFrac*100).toFixed(0),nbeats:r.peaks.length,sr:r.sr.toFixed(0),verdict:verdict,t:new Date().toISOString()});
  csRenderLog();$('csLogCard').style.display='block';}
function csDrawLive(){const c=$('csWave');c.style.display='block';c.width=c.clientWidth*2;c.height=180;
  const g=c.getContext('2d'),W=c.width,H=c.height,n=Math.min(csMag.length,400);g.fillStyle='#070B16';g.fillRect(0,0,W,H);if(n<2)return;
  const seg=csMag.slice(csMag.length-n);let mn=Math.min.apply(null,seg),mx=Math.max.apply(null,seg),rng=(mx-mn)||1;
  g.strokeStyle='#FF6B81';g.lineWidth=2;g.beginPath();
  for(let i=0;i<n;i++){const x=i/(n-1)*W,y=H-((seg[i]-mn)/rng)*H*0.9-H*0.05;i?g.lineTo(x,y):g.moveTo(x,y);}g.stroke();}
function csDrawFinal(d,peaks){const c=$('csWave');c.style.display='block';c.width=c.clientWidth*2;c.height=180;
  const g=c.getContext('2d'),W=c.width,H=c.height,N=d.length;g.fillStyle='#070B16';g.fillRect(0,0,W,H);
  g.strokeStyle='#4CC9F0';g.lineWidth=1.3;g.beginPath();
  for(let i=0;i<N;i++){const x=i/(N-1)*W,y=H/2-d[i]*H*0.42;i?g.lineTo(x,y):g.moveTo(x,y);}g.stroke();
  g.fillStyle='#3FDFA0';peaks.forEach(p=>{const x=p/(N-1)*W,y=H/2-d[p]*H*0.42;g.beginPath();g.arc(x,y,4,0,6.2832);g.fill();});}
$('csCsv').onclick=()=>{let c='patient_id,age,sex,heart_rate_bpm,mean_rr_ms,sdnn_ms,irregular_beat_pct,n_beats,sample_hz,verdict,datetime\n';
  csRows.forEach(r=>c+=[r.pid,r.age,r.sex,r.hr,r.meanRR,r.sdnn,r.irr,r.nbeats,r.sr,'"'+r.verdict+'"',r.t].join(',')+'\n');
  dl(new Blob([c],{type:'text/csv'}),'cardiopulmo_rhythm.csv');};
function csRenderLog(){let h='<table><tr><th>ID</th><th>HR</th><th>RR</th><th>SDNN</th><th>Irr%</th><th>Rhythm</th></tr>';
  csRows.forEach(r=>h+='<tr><td>'+r.pid+'</td><td>'+r.hr+'</td><td>'+r.meanRR+'</td><td>'+r.sdnn+'</td><td>'+r.irr+'</td><td>'+r.verdict.split(' ')[0]+'</td></tr>');
  $('csLogTable').innerHTML=h+'</table>';}

/* --- JVP via camera --- */
let jStream=null,jRun=false,jData=[],jT=[],jT0=0,jRAF=null,jTmp=null,jTorch=false,jRows=[];
const jSt=m=>$('jStatus').textContent=m;
function jFluidEval(){const h=parseFloat($('jHeight').value);const hjr=$('jHJR').value;const el=$('jFluid');if(!el)return;
  if(isNaN(h)){el.innerHTML='Enter the JVP height you read by eye (cm above the sternal angle) to get a fluid-status read.';el.style.color='var(--mut)';return;}
  const cmH2O=(h+5).toFixed(0);let txt,col;
  if(h<3){txt='<b>Normal JVP</b> (~'+cmH2O+' cmH\u2082O est.). No venous congestion by height.';col='var(--ok)';}
  else if(h<4){txt='<b>Borderline JVP</b> (~'+cmH2O+' cmH\u2082O est.). Watch; correlate with symptoms.';col='var(--warn)';}
  else{txt='<b>Elevated JVP</b> (~'+cmH2O+' cmH\u2082O est.) — suggests <b>fluid overload / right-heart failure (CHF)</b>. Correlate clinically.';col='var(--bad)';}
  if(hjr==='Positive')txt+=' Hepatojugular reflux positive — supports volume overload.';
  el.innerHTML=txt;el.style.color=col;}
if($('jHeight')){$('jHeight').oninput=jFluidEval;}if($('jHJR')){$('jHJR').onchange=jFluidEval;}
$('jRec').onclick=async()=>{
  if(!$('pid').value){jSt('Enter Patient ID (top of page) first.');return;}
  try{jStream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'},width:{ideal:640},height:{ideal:480}},audio:false});}
  catch(e){jSt('Camera blocked. Allow camera and reload.');return;}
  const track=jStream.getVideoTracks()[0];jTorch=false;
  try{const caps=track.getCapabilities?track.getCapabilities():{};if(caps.torch){await track.applyConstraints({advanced:[{torch:true}]});jTorch=true;}}catch(e){}
  const vid=$('jVid');vid.srcObject=jStream;try{await vid.play();}catch(e){}
  jData=[];jT=[];jRun=true;jT0=performance.now();
  $('jRec').disabled=true;$('jStop').disabled=false;$('jResCard').style.display='none';
  if(!jTmp){jTmp=document.createElement('canvas');jTmp.width=64;jTmp.height=64;}
  const cc=jTmp.getContext('2d',{willReadFrequently:true});
  function frame(){
    if(!jRun)return;const now=performance.now();
    try{cc.drawImage(vid,0,0,64,64);const d=cc.getImageData(24,8,16,42).data;
      let s=0,c=0;for(let i=0;i<d.length;i+=4){s+=(d[i]*0.299+d[i+1]*0.587+d[i+2]*0.114);c++;}
      jData.push(s/c);jT.push(now-jT0);}catch(e){}
    const left=Math.max(0,15000-(now-jT0));
    jSt((jTorch?'Light ON. ':'')+'Recording neck '+(left/1000).toFixed(0)+'s — hold steady');
    jDrawLive();
    if(now-jT0>=15000){jStopR();return;}
    jRAF=requestAnimationFrame(frame);}
  jRAF=requestAnimationFrame(frame);};
$('jStop').onclick=jStopR;
function jStopR(){jRun=false;if(jRAF)cancelAnimationFrame(jRAF);
  if(jStream)jStream.getTracks().forEach(t=>t.stop());
  $('jRec').disabled=false;$('jStop').disabled=true;
  if(jData.length<30){jSt('No signal. Better light, fill the box with the neck, retry.');return;}
  jAnalyze();}
function jAnalyze(){
  const r=detectBeats(jData,jT,500);jDrawFinal(r.d,r.peaks);
  let rr=[];for(let k=1;k<r.peaks.length;k++){const v=jT[r.peaks[k]]-jT[r.peaks[k-1]];if(v>=500&&v<=2000)rr.push(v);}
  let amp=0;for(let i=0;i<r.d.length;i++)amp=Math.max(amp,Math.abs(r.d[i]));
  if(rr.length<3){$('jVerdict').textContent='No clear pulsation seen';$('jVerdict').style.color='var(--mut)';
    $('jRate').textContent='—';$('jAmp').textContent='—';$('jResCard').style.display='block';
    jSt('No rhythmic pulsation detected. Re-light, steady the phone, fill the box with the neck.');return;}
  const med=a=>{a=a.slice().sort((x,y)=>x-y);return a[Math.floor(a.length/2)];};
  const rate=Math.round(60000/med(rr));
  $('jVerdict').textContent='Pulsation detected · '+rate+'/min';$('jVerdict').style.color='var(--ok)';
  $('jRate').textContent=rate;$('jAmp').textContent=(amp*100).toFixed(1);
  $('jResCard').style.display='block';jFluidEval();jSt('Done. Inspect the trace. Tap Start to repeat.');
  jRows.push({pid:$('pid').value,age:$('age').value,sex:$('sex').value,rate:rate,amp:(amp*100).toFixed(1),sr:r.sr.toFixed(0),jvph:$('jHeight').value,hjr:$('jHJR').value,t:new Date().toISOString()});
  jRenderLog();$('jLogCard').style.display='block';}
function jDrawLive(){const c=$('jWave');c.style.display='block';c.width=c.clientWidth*2;c.height=180;
  const g=c.getContext('2d'),W=c.width,H=c.height,n=Math.min(jData.length,300);g.fillStyle='#070B16';g.fillRect(0,0,W,H);if(n<2)return;
  const seg=jData.slice(jData.length-n);let mn=Math.min.apply(null,seg),mx=Math.max.apply(null,seg),rng=(mx-mn)||1;
  g.strokeStyle='#56d4dd';g.lineWidth=2;g.beginPath();
  for(let i=0;i<n;i++){const x=i/(n-1)*W,y=H-((seg[i]-mn)/rng)*H*0.9-H*0.05;i?g.lineTo(x,y):g.moveTo(x,y);}g.stroke();}
function jDrawFinal(d,peaks){const c=$('jWave');c.style.display='block';c.width=c.clientWidth*2;c.height=180;
  const g=c.getContext('2d'),W=c.width,H=c.height,N=d.length;g.fillStyle='#070B16';g.fillRect(0,0,W,H);
  g.strokeStyle='#56d4dd';g.lineWidth=1.3;g.beginPath();
  for(let i=0;i<N;i++){const x=i/(N-1)*W,y=H/2-d[i]*H*0.42;i?g.lineTo(x,y):g.moveTo(x,y);}g.stroke();
  g.fillStyle='#3FDFA0';peaks.forEach(p=>{const x=p/(N-1)*W,y=H/2-d[p]*H*0.42;g.beginPath();g.arc(x,y,3.5,0,6.2832);g.fill();});}
$('jCsv').onclick=()=>{let c='patient_id,age,sex,pulsation_rate_per_min,rel_amplitude_au,sample_fps,jvp_height_cm,hepatojugular_reflux,datetime\n';
  jRows.forEach(r=>c+=[r.pid,r.age,r.sex,r.rate,r.amp,r.sr,r.jvph,r.hjr,r.t].join(',')+'\n');
  dl(new Blob([c],{type:'text/csv'}),'cardiopulmo_jvp.csv');};
function jRenderLog(){let h='<table><tr><th>ID</th><th>Rate/min</th><th>Amp</th></tr>';
  jRows.forEach(r=>h+='<tr><td>'+r.pid+'</td><td>'+r.rate+'</td><td>'+r.amp+'</td></tr>');
  $('jLogTable').innerHTML=h+'</table>';}

/* --- Heart sound (PCG) via microphone --- */
let pcStream,pcCtx,pcProc,pcZg,pcBuf=[],pcSr=48000,pcWav=null,pcRows=[],pcTimer,pcLeft,pcLastBuf=null,pcLastResult=null;
const pcSt=m=>$('pcStatus').textContent=m;
/* Cardioscope Sound: single interactive apex dot (same pattern as Percussion) */
let pcDotState='pending';
function pcRenderDot(){var g=$('pcspot');if(!g)return;g.innerHTML='';var d=document.createElement('div');d.className='dot2';d.style.left='62%';d.style.top='63%';d.style.width='7%';d.style.background=(pcDotState==='active')?'#FFB454':((pcDotState==='done')?'#2FBF8F':'#5A6B94');if(pcDotState==='active'){d.style.borderColor='#fff';d.style.borderWidth='3px';d.style.boxShadow='0 0 0 4px rgba(255,255,255,.3)';}d.onclick=pcSelectDot;g.appendChild(d);if(pcDotState==='pending'){var ar=document.createElement('div');ar.className='dothint';ar.style.left='34%';ar.style.top='52%';ar.innerHTML='<b>\uD83D\uDC49</b> Tap the blue dot to start';g.appendChild(ar);}}
function pcSelectDot(){pcDotState='active';$('pcRec').disabled=false;pcRenderDot();pcStartQuietGate();}
pcRenderDot();

/* ---- live ambient-noise gate: auto-start recording only when the room is quiet ---- */
const pcNoiseThresh=60;            /* high-freq noise level 0..~120; LOWER = stricter quiet */
let pcGating=false,pcGateRAF=null,pcGateCancel=null;
function pcRR(g,x,y,w,h,r){if(w<0){x+=w;w=-w;}if(r>h/2)r=h/2;if(r>w/2)r=w/2;g.beginPath();g.moveTo(x+r,y);g.arcTo(x+w,y,x+w,y+h,r);g.arcTo(x+w,y+h,x,y+h,r);g.arcTo(x,y+h,x,y,r);g.arcTo(x,y,x+w,y,r);g.closePath();}
function pcNoiseLabel(t,c){var l=$('pcNoiseLbl');if(l){l.textContent=t;l.style.color=c||'#e6edf3';}}
function pcDrawNoise(noise,thresh){
  var c=$('pcNoiseCanvas');if(!c)return;var W=c.width=c.clientWidth*2,H=c.height=c.clientHeight*2,g=c.getContext('2d');g.clearRect(0,0,W,H);
  var full=120,norm=Math.min(1,noise/full),tx=Math.min(1,thresh/full)*W;
  g.fillStyle='rgba(47,191,143,.14)';pcRR(g,0,H*0.30,tx,H*0.40,H*0.20);g.fill();
  g.fillStyle='rgba(255,107,107,.14)';pcRR(g,tx,H*0.30,W-tx,H*0.40,H*0.20);g.fill();
  g.fillStyle=(noise<thresh)?'#2FBF8F':'#ff6b6b';pcRR(g,0,H*0.36,Math.max(H*0.28,norm*W),H*0.28,H*0.14);g.fill();
  g.strokeStyle='#e6edf3';g.lineWidth=3;g.beginPath();g.moveTo(tx,H*0.16);g.lineTo(tx,H*0.84);g.stroke();
  g.fillStyle='#8b98a5';g.font='600 20px system-ui';g.textAlign='center';g.fillText('quiet',tx*0.5,H*0.14);g.fillText('noisy',(W+tx)/2,H*0.14);
}
function pcStartQuietGate(){
  if(pcGating)return;
  if(!$('pid').value){pcSt('Enter Patient ID (top of page) first.');return;}
  pcGating=true;var meter=$('pcNoise');if(meter)meter.style.display='block';
  $('pcRec').style.display='none';$('pcRec').disabled=true;$('pcStop').disabled=false;$('pcResCard').style.display='none';
  pcNoiseLabel('Listening for a quiet moment…','#e6edf3');pcSt('Checking the room is quiet enough…');
  navigator.mediaDevices.getUserMedia({audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false,channelCount:1}}).then(function(stream){
    var ctx=new (window.AudioContext||window.webkitAudioContext)();var src=ctx.createMediaStreamSource(stream);
    var an=ctx.createAnalyser();an.fftSize=2048;an.smoothingTimeConstant=0.8;src.connect(an);
    var freq=new Uint8Array(an.frequencyBinCount),binHz=ctx.sampleRate/an.fftSize,i0=Math.max(1,Math.floor(500/binHz));
    var quietSince=0,gateStart=performance.now(),HOLD=1500,MAXWAIT=15000;
    pcGateCancel=function(){try{cancelAnimationFrame(pcGateRAF);}catch(e){}try{stream.getTracks().forEach(function(t){t.stop();});}catch(e){}try{ctx.close();}catch(e){}pcGating=false;if(meter)meter.style.display='none';};
    function loop(){
      an.getByteFrequencyData(freq);var vs=[];for(var i=i0;i<freq.length;i++)vs.push(freq[i]);vs.sort(function(a,b){return b-a;});var kk=Math.min(8,vs.length),ns=0;for(var j=0;j<kk;j++)ns+=vs[j];var noise=kk?ns/kk:0;
      pcDrawNoise(noise,pcNoiseThresh);
      var now=performance.now(),forced=(now-gateStart)>MAXWAIT;
      if(noise<pcNoiseThresh){if(!quietSince)quietSince=now;var held=now-quietSince;
        pcNoiseLabel('Quiet ✓ — hold still, starting in '+Math.max(0,Math.ceil((HOLD-held)/1000))+'s','#2FBF8F');
        if(held>=HOLD){pcGateArmDone(stream,ctx,src,an,meter,false);return;}
      }else{quietSince=0;pcNoiseLabel('Too noisy — move away from fans/voices, quieten the room','#ff6b6b');}
      if(forced){pcGateArmDone(stream,ctx,src,an,meter,true);return;}
      pcGateRAF=requestAnimationFrame(loop);
    }
    loop();
  }).catch(function(){pcGating=false;if(meter)meter.style.display='none';$('pcRec').style.display='';pcSt('Microphone blocked. Allow mic and reload.');});
}
function pcGateArmDone(stream,ctx,src,an,meter,noisy){
  try{cancelAnimationFrame(pcGateRAF);}catch(e){}pcGating=false;pcGateCancel=null;
  try{an.disconnect();}catch(e){}
  if(meter)meter.style.display='none';
  pcBeginRecording(stream,ctx,src,noisy);
}
function pcBeginRecording(stream,ctx,src,noisy){
  pcStream=stream;pcCtx=ctx;pcSr=ctx.sampleRate;pcBuf=[];
  pcProc=ctx.createScriptProcessor(4096,1,1);pcZg=ctx.createGain();pcZg.gain.value=0;
  pcProc.onaudioprocess=function(ev){pcBuf.push(new Float32Array(ev.inputBuffer.getChannelData(0)));};
  if(!src)src=ctx.createMediaStreamSource(stream);
  src.connect(pcProc);pcProc.connect(pcZg);pcZg.connect(ctx.destination);
  $('pcRec').disabled=true;$('pcStop').disabled=false;$('pcResCard').style.display='none';
  var lead=noisy?'⚠ Noisy room — recording anyway ':'● Recording… hold still ';
  pcLeft=15;pcSt(lead+'('+pcLeft+'s)');
  pcTimer=setInterval(function(){pcLeft--;pcSt('● Recording… ('+pcLeft+'s)');if(pcLeft<=0)pcStopRec();},1000);
}
$('pcRec').onclick=pcStartQuietGate;
$('pcStop').onclick=function(){if(pcGating&&pcGateCancel){pcGateCancel();$('pcStop').disabled=true;$('pcRec').style.display='';$('pcRec').disabled=false;pcDotState='pending';pcRenderDot();pcSt('Cancelled — tap the apex dot to try again.');return;}pcStopRec();};
function pcStopRec(){
  clearInterval(pcTimer);try{pcProc.disconnect();}catch(e){}
  if(pcStream)pcStream.getTracks().forEach(t=>t.stop());
  $('pcRec').style.display='';$('pcRec').disabled=false;$('pcStop').disabled=true;pcSt('Analysing…');
  let n=0;pcBuf.forEach(b=>n+=b.length);
  if(n<pcSr){pcSt('Too short — record ~15s.');try{pcCtx.close();}catch(e){}return;}
  const s=new Float32Array(n);let o=0;pcBuf.forEach(b=>{s.set(b,o);o+=b.length;});try{pcCtx.close();}catch(e){}
  pcLastBuf=s;pcWav=encodeWAV(s,pcSr);const p=$('pcPlayer');p.src=URL.createObjectURL(pcWav);p.style.display='block';$('pcAmp').style.display='block';
  pcDraw(s);const pcRow=pcAnalyze(s,pcSr);pcMLScreen(s,pcSr,pcRow);
  pcDotState='done';pcRenderDot();
}
function pcHP(x,fs,fc){const w=2*Math.PI*fc/fs,c=Math.cos(w),sn=Math.sin(w),al=sn/1.414;
  const a0=1+al,B0=((1+c)/2)/a0,B1=(-(1+c))/a0,B2=((1+c)/2)/a0,A1=(-2*c)/a0,A2=(1-al)/a0;
  const y=new Float32Array(x.length);let x1=0,x2=0,y1=0,y2=0;
  for(let i=0;i<x.length;i++){const xi=x[i],yi=B0*xi+B1*x1+B2*x2-A1*y1-A2*y2;y[i]=yi;x2=x1;x1=xi;y2=y1;y1=yi;}return y;}
function pcLP(x,fs,fc){const w=2*Math.PI*fc/fs,c=Math.cos(w),sn=Math.sin(w),al=sn/1.414;
  const a0=1+al,B0=((1-c)/2)/a0,B1=(1-c)/a0,B2=((1-c)/2)/a0,A1=(-2*c)/a0,A2=(1-al)/a0;
  const y=new Float32Array(x.length);let x1=0,x2=0,y1=0,y2=0;
  for(let i=0;i<x.length;i++){const xi=x[i],yi=B0*xi+B1*x1+B2*x2-A1*y1-A2*y2;y[i]=yi;x2=x1;x1=xi;y2=y1;y1=yi;}return y;}
function pcBandpass(x,fs){return pcLP(pcHP(x,fs,20),fs,150);}
function pcAnalyze(s,fs){
  s=pcBandpass(s,fs);
  let rms=0;for(let i=0;i<s.length;i++)rms+=s[i]*s[i];rms=Math.sqrt(rms/s.length);
  const f=Math.max(1,Math.round(fs/1000)),fd=fs/f,L=Math.floor(s.length/f),ds=new Float32Array(L);
  for(let i=0;i<L;i++){let a=0;for(let j=0;j<f;j++)a+=s[i*f+j];ds[i]=a/f;}
  let mx=0;for(let i=0;i<L;i++)mx=Math.max(mx,Math.abs(ds[i]));if(mx>0)for(let i=0;i<L;i++)ds[i]/=mx;
  const se=new Float32Array(L);for(let i=0;i<L;i++){const x=ds[i]*ds[i];se[i]=x>1e-9?-x*Math.log(x):0;}
  const w=Math.max(1,Math.round(0.05*fd)),env=new Float32Array(L);let run=0;
  for(let i=0;i<L;i++){run+=se[i];if(i>=w)run-=se[i-w];env[i]=run/Math.min(i+1,w);}
  let em=0;for(let i=0;i<L;i++)em+=env[i];em/=L;for(let i=0;i<L;i++)env[i]-=em;
  const lo=Math.round(fd*0.40),hi=Math.round(fd*1.5);let e0=0;for(let i=0;i<L;i++)e0+=env[i]*env[i];
  const ac=new Float32Array(hi+2);
  for(let lag=lo;lag<=hi&&lag<L;lag++){let c=0;for(let i=0;i<L-lag;i++)c+=env[i]*env[i+lag];ac[lag]=c/(e0||1);}
  let bestLag=0,bestC=-1;
  for(let lag=lo;lag<=hi&&lag<L;lag++){if(ac[lag]>bestC){bestC=ac[lag];bestLag=lag;}}
  if(bestLag>0){for(let m=3;m>=2;m--){var L2=bestLag*m;if(L2<=hi&&L2<L&&ac[L2]>=0.80*bestC){bestLag=L2;bestC=ac[L2];break;}}}
  const bpm=bestLag?Math.round(60*fd/bestLag):0;
  const uncertain=(bestC<0.35||!bpm||rms<0.0003);
  let verdict,col,reg,q;
  if(uncertain){verdict='Beat pattern unclear — reposition, press firmer, quieter room';col='var(--mut)';reg='—';q='Poor';$('pcHR').textContent='—';}
  else{
    $('pcHR').textContent=bpm;
    const rateNote=bpm<60?'brady':(bpm>100?'tachy':'normal rate');
    if(bestC>=0.5){reg='Regular';verdict='Regular beats · '+bpm+' bpm ('+rateNote+')';col=(bpm<60||bpm>100)?'var(--warn)':'var(--ok)';q='Good';}
    else{reg='Unclear';verdict='Beats detected · '+bpm+' bpm ('+rateNote+') — rhythm unclear, recheck';col='var(--warn)';q='Fair';}
  }
  $('pcVerdict').textContent=verdict;$('pcVerdict').style.color=col;
  $('pcReg').textContent=reg;$('pcConf').textContent=bestC.toFixed(2);$('pcQ').textContent=q;
  $('pcResCard').style.display='block';
  pcLastResult={bpm:uncertain?null:bpm,rhythm:reg,confidence:bestC.toFixed(2),quality:q,age:($('age')?$('age').value:'')||null,sex:($('sex')?$('sex').value:'')||null};
  pcSt('Done. Check the trace looks like clean lub-dub beats before trusting the number.');
  let pcRow=null;
  if(!uncertain){pcRow={pid:$('pid').value,age:$('age').value,sex:$('sex').value,bpm:bpm,reg:bestC>=0.5?'reg':'irreg',conf:bestC.toFixed(2),ai:'',t:new Date().toISOString()};pcRows.push(pcRow);
    pcRenderLog();$('pcLogCard').style.display='block';}
  return pcRow;
}
function pcDraw(s){const c=$('pcWave');c.style.display='block';c.width=c.clientWidth*2;c.height=180;
  const g=c.getContext('2d'),W=c.width,H=c.height,step=Math.floor(s.length/W)||1;
  let pk=1e-6;for(let i=0;i<s.length;i++){const a=Math.abs(s[i]);if(a>pk)pk=a;}const sc=0.9/pk; // auto-scale to fill
  g.fillStyle='#070B16';g.fillRect(0,0,W,H);g.strokeStyle='#4CC9F0';g.lineWidth=1;g.beginPath();
  for(let x=0;x<W;x++){let mn=1,mx=-1;for(let j=0;j<step;j++){const v=(s[x*step+j]||0)*sc;mn=Math.min(mn,v);mx=Math.max(mx,v);}
    g.moveTo(x,H/2*(1-mx)+H/4);g.lineTo(x,H/2*(1-mn)+H/4);}g.stroke();}
$('pcDl').onclick=()=>{if(pcWav)dl(pcWav,($('pid').value||'rec')+'_pcg_'+Date.now()+'.wav');};
$('pcAmp').onclick=pcAmplifyPlay;
$('pcCsv').onclick=()=>{let c='patient_id,age,sex,heart_rate_bpm,rhythm,confidence,ai_abnormal_prob,datetime\n';
  pcRows.forEach(r=>c+=[r.pid,r.age,r.sex,r.bpm,r.reg,r.conf,r.ai||'',r.t].join(',')+'\n');
  dl(new Blob([c],{type:'text/csv'}),'cardiopulmo_heartsound.csv');};
function pcRenderLog(){let h='<table><tr><th>ID</th><th>BPM</th><th>Rhythm</th><th>Conf</th></tr>';
  pcRows.forEach(r=>h+='<tr><td>'+r.pid+'</td><td>'+r.bpm+'</td><td>'+r.reg+'</td><td>'+r.conf+'</td></tr>');
  $('pcLogTable').innerHTML=h+'</table>';}

/* ===== Cardioscope on-device AI: murmur/abnormal heart-sound screen (TF.js) ===== */
const PC_SR2=2000,PC_NFFT=512,PC_HOP=64,PC_NMEL=64,PC_TFR=157,PC_LWAV=10000,PC_NB=PC_NFFT/2+1,PC_THR=0.25;
const PC_WIN=new Float32Array(PC_NFFT);for(let n=0;n<PC_NFFT;n++)PC_WIN[n]=0.5-0.5*Math.cos(2*Math.PI*n/PC_NFFT);
let pcModel=null,pcMel=null,pcModelLoading=null,pcModelErr='';
async function pcLoadModel(){
  if(pcModel&&pcMel)return true;
  if(pcModelLoading)return pcModelLoading;
  pcModelLoading=(async()=>{
    try{
      if(typeof tf==='undefined')throw new Error('tfjs library not loaded (check internet)');
      const mr=await fetch('mel_filter.json');
      if(!mr.ok)throw new Error('mel_filter.json → '+mr.status+' (upload it next to index.html)');
      const mjson=await mr.json();pcMel=Array.isArray(mjson)?mjson:mjson.mel;
      pcModel=await tf.loadGraphModel('model.json');
      pcSelfTest();return true;
    }catch(e){pcModelErr=e.message||String(e);console.error('AI model load failed:',e);return false;}
  })();
  return pcModelLoading;
}
function pcResample(s,fromR,toR){
  if(fromR===toR)return Float32Array.from(s);
  const ratio=toR/fromR,outLen=Math.max(1,Math.round(s.length*ratio)),out=new Float32Array(outLen);
  for(let i=0;i<outLen;i++){const pos=i/ratio,i0=Math.floor(pos),frac=pos-i0,a=s[i0]||0,b=(i0+1<s.length)?s[i0+1]:a;out[i]=a+(b-a)*frac;}
  return out;
}
function pcLogMel(x){
  let xf=new Float32Array(PC_LWAV);
  if(x.length>=PC_LWAV)xf.set(x.subarray(0,PC_LWAV));else xf.set(x);
  let mx=0;for(let i=0;i<PC_LWAV;i++){const a=Math.abs(xf[i]);if(a>mx)mx=a;}
  const nrm=1/(mx+1e-9);for(let i=0;i<PC_LWAV;i++)xf[i]*=nrm;
  const pad=PC_NFFT/2,xp=new Float32Array(PC_LWAV+PC_NFFT);xp.set(xf,pad);
  const nfr=1+Math.floor(PC_LWAV/PC_HOP);
  const P=new Float32Array(PC_NB*nfr),re=new Float64Array(PC_NFFT),im=new Float64Array(PC_NFFT);
  for(let f=0;f<nfr;f++){const off=f*PC_HOP;
    for(let k=0;k<PC_NFFT;k++){re[k]=xp[off+k]*PC_WIN[k];im[k]=0;}
    fft(re,im);
    for(let b=0;b<PC_NB;b++)P[b*nfr+f]=re[b]*re[b]+im[b]*im[b];}
  const S=new Float32Array(PC_NMEL*nfr);
  for(let m=0;m<PC_NMEL;m++){const mrow=pcMel[m];
    for(let f=0;f<nfr;f++){let acc=0;for(let b=0;b<PC_NB;b++)acc+=mrow[b]*P[b*nfr+f];
      S[m*nfr+f]=10*Math.log10(Math.max(1e-10,acc+1e-10));}}
  let smax=-Infinity;for(let i=0;i<S.length;i++)if(S[i]>smax)smax=S[i];
  const fl=smax-80;for(let i=0;i<S.length;i++)if(S[i]<fl)S[i]=fl;
  let mean=0;for(let i=0;i<S.length;i++)mean+=S[i];mean/=S.length;
  let vs=0;for(let i=0;i<S.length;i++){const d=S[i]-mean;vs+=d*d;}
  const std=Math.sqrt(vs/S.length)+1e-6;
  const out=new Float32Array(PC_NMEL*PC_TFR);
  for(let m=0;m<PC_NMEL;m++)for(let f=0;f<PC_TFR;f++)out[m*PC_TFR+f]=(f<nfr)?(S[m*nfr+f]-mean)/std:0;
  return out;
}
function pcInfer(feat){return tf.tidy(()=>{const x=tf.tensor4d(feat,[1,PC_NMEL,PC_TFR,1]);const y=pcModel.predict(x);const t=Array.isArray(y)?y[0]:y;return t.dataSync()[0];});}
function pcGenTest(){const n=PC_LWAV,out=new Float32Array(n);for(let i=0;i<n;i++){const t=i/PC_SR2;out[i]=Math.sin(2*Math.PI*50*t)+0.5*Math.sin(2*Math.PI*150*t)+0.25*Math.sin(2*Math.PI*300*t);}return out;}
function pcSelfTest(){try{const p=pcInfer(pcLogMel(pcGenTest()));const okv=isFinite(p)&&p>=0&&p<=1;console.log('AI engine self-check prob='+p.toFixed(4)+' ('+(okv?'ENGINE OK':'ERROR')+')');}catch(e){console.warn('self-test skipped',e);}}
function pcHeartSignal(s,fs){
  const x=pcResample(s,fs,PC_SR2),N=512,H=256,NB=N/2+1;
  const avg=new Float64Array(NB),re=new Float64Array(N),im=new Float64Array(N);let nw=0;
  for(let off=0;off+N<=x.length;off+=H){
    for(let k=0;k<N;k++){re[k]=x[off+k]*PC_WIN[k];im[k]=0;}
    fft(re,im);
    for(let b=0;b<NB;b++)avg[b]+=re[b]*re[b]+im[b]*im[b];
    nw++;}
  if(nw>0)for(let b=0;b<NB;b++)avg[b]/=nw;
  const binHz=PC_SR2/N,bandE=(lo,hi)=>{let e=0;for(let b=0;b<NB;b++){const f=b*binHz;if(f>=lo&&f<hi)e+=avg[b];}return e;};
  const eLow=bandE(20,150),eMid=bandE(150,600),eHigh=bandE(600,1000),eTot=eLow+eMid+eHigh+1e-12;
  const ratioLow=eLow/eTot;
  let rms=0;for(let i=0;i<x.length;i++)rms+=x[i]*x[i];rms=Math.sqrt(rms/x.length);
  let verdict,ok,col,quality;
  if(rms<0.0004){verdict='Mic silent — no input (check mic permission / port)';ok=false;col='var(--mut)';quality='none';}
  else if(ratioLow>=0.30){verdict='Heart-sound signal detected ✓';ok=true;col='var(--ok)';quality='good';}
  else if(ratioLow>=0.15){verdict='Partial heart signal — AI shown, interpret with caution';ok=true;col='var(--warn)';quality='low';}
  else{verdict='Mostly high-freq noise — reposition';ok=false;col='var(--bad)';quality='none';}
  return {ratioLow:ratioLow,rms:rms,verdict:verdict,ok:ok,col:col,quality:quality};
}
async function pcRenderAmplified(s,fs){
  const oac=new OfflineAudioContext(1,s.length,fs);
  const buf=oac.createBuffer(1,s.length,fs);buf.copyToChannel(Float32Array.from(s),0);
  const src=oac.createBufferSource();src.buffer=buf;
  const hp1=oac.createBiquadFilter();hp1.type='highpass';hp1.frequency.value=20;
  const hp2=oac.createBiquadFilter();hp2.type='highpass';hp2.frequency.value=20;
  const lp1=oac.createBiquadFilter();lp1.type='lowpass';lp1.frequency.value=150;
  const lp2=oac.createBiquadFilter();lp2.type='lowpass';lp2.frequency.value=150;
  const comp=oac.createDynamicsCompressor();comp.threshold.value=-45;comp.knee.value=30;comp.ratio.value=12;comp.attack.value=0.003;comp.release.value=0.25;
  src.connect(hp1);hp1.connect(hp2);hp2.connect(lp1);lp1.connect(lp2);lp2.connect(comp);comp.connect(oac.destination);src.start();
  const r=await oac.startRendering();let o=r.getChannelData(0);
  let mx=1e-6;for(let i=0;i<o.length;i++){const a=Math.abs(o[i]);if(a>mx)mx=a;}
  const g=0.97/mx,amp=new Float32Array(o.length);for(let i=0;i<o.length;i++)amp[i]=o[i]*g;
  return amp;
}
async function pcAmplifyPlay(){
  if(!pcLastBuf){return;}
  try{
    const amp=await pcRenderAmplified(pcLastBuf,pcSr);
    const wav=encodeWAV(amp,pcSr),p=$('pcPlayer');p.src=URL.createObjectURL(wav);p.style.display='block';pcDraw(amp);p.play();
    pcSt('Amplified hard + heart-band filtered (20–150 Hz) + compressed. Listen for lub-dub under the noise.');
  }catch(e){console.error(e);pcSt('Amplify failed on this device.');}
}
/* ===== CirCor murmur model (multi-head: murmur / systolic / diastolic) ===== */
const MM_SR=2000,MM_N=20000,MM_NFFT=512,MM_HOP=64,MM_NMEL=64,MM_NB=257,MM_FR=313,MM_THR=0.619;
const MM_WIN=new Float32Array(MM_NFFT);for(let n=0;n<MM_NFFT;n++)MM_WIN[n]=0.5-0.5*Math.cos(2*Math.PI*n/MM_NFFT);
let mmModel=null,mmMel=null,mmErr='',mmLoading=null;
function mmLoad(){
  if(mmModel)return Promise.resolve(true);
  if(mmLoading)return mmLoading;
  mmLoading=(async()=>{
    try{
      if(typeof tf==='undefined')throw new Error('tfjs not loaded');
      const r=await fetch('murmur_mel.json');if(!r.ok)throw new Error('murmur_mel.json '+r.status);
      mmMel=await r.json();
      mmModel=await tf.loadLayersModel('murmur_model.json');
      return true;
    }catch(e){mmErr=e.message||String(e);console.error('murmur model load failed',e);return false;}
  })();
  return mmLoading;
}
function pcMurmurMel(sig,fs){
  let x=pcResample(sig,fs,MM_SR),y=new Float32Array(MM_N);
  for(let i=0;i<MM_N;i++)y[i]=(i<x.length)?x[i]:0;
  let mx=1e-9;for(let i=0;i<MM_N;i++){let a=Math.abs(y[i]);if(a>mx)mx=a;}
  for(let i=0;i<MM_N;i++)y[i]/=mx;
  const pad=MM_NFFT/2,xp=new Float32Array(MM_N+MM_NFFT);xp.set(y,pad);
  const re=new Float64Array(MM_NFFT),im=new Float64Array(MM_NFFT),pw=new Float64Array(MM_NB);
  const mel=new Float32Array(MM_NMEL*MM_FR);
  for(let f=0;f<MM_FR;f++){const off=f*MM_HOP;
    for(let k=0;k<MM_NFFT;k++){re[k]=xp[off+k]*MM_WIN[k];im[k]=0;}
    fft(re,im);
    for(let b=0;b<MM_NB;b++)pw[b]=re[b]*re[b]+im[b]*im[b];
    for(let m=0;m<MM_NMEL;m++){let acc=0,row=mmMel[m];for(let b=0;b<MM_NB;b++)acc+=row[b]*pw[b];mel[m*MM_FR+f]=acc;}
  }
  let mxdb=-1e9;for(let i=0;i<mel.length;i++){let v=10*Math.log10(Math.max(1e-10,mel[i]));mel[i]=v;if(v>mxdb)mxdb=v;}
  const floor=mxdb-80;for(let i=0;i<mel.length;i++)if(mel[i]<floor)mel[i]=floor;
  let mean=0;for(let i=0;i<mel.length;i++)mean+=mel[i];mean/=mel.length;
  let sd=0;for(let i=0;i<mel.length;i++){let d=mel[i]-mean;sd+=d*d;}sd=Math.sqrt(sd/mel.length);
  for(let i=0;i<mel.length;i++)mel[i]=(mel[i]-mean)/(sd+1e-9);
  return mel;
}
async function pcRunMurmur(s,fs){
  var el=$('pcMurmur'),sub=$('pcMurmurSub');if(!el)return;
  el.style.display='block';el.textContent='🫀 Murmur AI: analysing…';el.style.color='var(--mut)';
  var ok=await mmLoad();
  if(!ok){el.textContent='🫀 Murmur AI unavailable — '+mmErr;el.style.color='var(--mut)';return;}
  try{
    var mel=pcMurmurMel(s,fs);
    var t=tf.tensor4d(mel,[1,MM_NMEL,MM_FR,1]);
    var yy=mmModel.predict(t),arr=Array.isArray(yy)?yy:[yy];
    var pm=arr[0].dataSync()[0],ps=arr[1].dataSync()[0],pd=arr[2].dataSync()[0];
    tf.dispose([t].concat(arr));
    var present=pm>=MM_THR,timing=[];
    if(present){if(ps>=0.5)timing.push('systolic');if(pd>=0.5)timing.push('diastolic');}
    if(present){el.textContent='🫀 Murmur AI: MURMUR PRESENT'+(timing.length?' — '+timing.join(' + '):'');el.style.color='var(--bad)';}
    else{el.textContent='🫀 Murmur AI: No murmur detected';el.style.color='var(--ok)';}
    if(sub){sub.style.display='block';sub.textContent='Murmur '+(pm*100).toFixed(0)+'% (threshold 62%) · systolic '+(ps*100).toFixed(0)+'% · diastolic '+(pd*100).toFixed(0)+'% · CirCor-trained, screening only';}
    if(pcLastResult){pcLastResult.murmur=present?'present':'absent';pcLastResult.murmur_p=pm.toFixed(3);pcLastResult.systolic_p=ps.toFixed(3);pcLastResult.diastolic_p=pd.toFixed(3);}
  }catch(e){console.error(e);el.textContent='🫀 Murmur AI: error';el.style.color='var(--mut)';}
}
async function pcMLScreen(s,fs,pcRow){
  const el=$('pcAI'),sub=$('pcAIsub'),sig=$('pcSig');
  const q=pcHeartSignal(s,fs);
  sig.style.display='block';sig.textContent='📶 '+q.verdict+'  ('+(q.ratioLow*100).toFixed(0)+'% low-band)';sig.style.color=q.col;
  el.style.display='block';sub.style.display='block';
  if(q.rms<0.0004){el.textContent='🧠 AI screen: skipped — mic silent';el.style.color='var(--mut)';
    sub.textContent='No sound reached the mic. Press the phone bottom edge firmly on bare skin over the heart and re-record.';
    if($('pcMurmur'))$('pcMurmur').style.display='none';if($('pcMurmurSub'))$('pcMurmurSub').style.display='none';
    pcUploadSafe('mic_silent',null,q,s,fs,sub);return;}
  el.textContent='🧠 AI screen: loading model…';el.style.color='var(--mut)';
  const ok=await pcLoadModel();
  if(!ok){el.textContent='🧠 AI screen unavailable — '+pcModelErr;el.style.color='var(--mut)';
    sub.textContent='Model files must sit in the same folder as index.html.';
    pcUploadSafe('model_unavailable',null,q,s,fs,sub);return;}
  try{
    const p=pcInfer(pcLogMel(pcResample(s,fs,PC_SR2)));
    var pos=p>=PC_THR;
    el.textContent=pos?'🧠 AI heart-sound screen: SCREEN POSITIVE — refer for clinical assessment':'🧠 AI heart-sound screen: Screen negative';
    el.style.color=pos?'var(--bad)':'var(--ok)';
    sub.textContent='Model probability of abnormal sound: '+(p*100).toFixed(0)+'%  ·  threshold '+(PC_THR*100).toFixed(0)+'%  ·  screening only, not diagnostic';
    if(pcRow)pcRow.ai=p.toFixed(3);
    pcUploadSafe(pos?'screen_positive':'screen_negative',p,q,s,fs,sub);
    pcRunMurmur(s,fs);
  }catch(e){console.error(e);el.textContent='🧠 AI screen: error processing audio';el.style.color='var(--mut)';
    pcUploadSafe('processing_error',null,q,s,fs,sub);}
}
function pcExtra(base){var L=pcLastResult||{};return Object.assign({bpm:L.bpm,rhythm:L.rhythm,confidence:L.confidence,signal_quality:L.quality,age:L.age,sex:L.sex},base);}
async function pcUploadSafe(verdict,prob,q,s,fs,subEl){
  const r=await uploadRecording('cardioscope','apex_raw',makeSmallWavNorm(s,fs,PC_SR2),prob,verdict,pcExtra({band:'raw',ratioLow:q.ratioLow}));
  if(!r.ok&&subEl)subEl.textContent+=' · ⚠ raw not saved — '+r.reason;
  else if(r.ok&&r.reason&&subEl)subEl.textContent+=' · ⚠ '+r.reason;
  try{
    const amp=await pcRenderAmplified(s,fs);
    const r2=await uploadRecording('cardioscope','apex_ampl_20_150hz',makeSmallWav(amp,fs,PC_SR2),prob,verdict,pcExtra({band:'20-150Hz',amplified:true}));
    if(!r2.ok&&subEl)subEl.textContent+=' · ⚠ amplified not saved — '+r2.reason;
  }catch(e){console.warn('amplified save failed',e);}
}

/* ===== PulmoScope on-device AI: lung-sound normal/abnormal screen (TF.js) ===== */
const LG_SR=4000,LG_NFFT=512,LG_HOP=128,LG_NMEL=64,LG_TFR=157,LG_LWAV=20000,LG_NB=LG_NFFT/2+1,LG_THR=0.5;
const LG_WIN=new Float32Array(LG_NFFT);for(let n=0;n<LG_NFFT;n++)LG_WIN[n]=0.5-0.5*Math.cos(2*Math.PI*n/LG_NFFT);
let lgModel=null,lgMel=null,lgModelLoading=null,lgModelErr='';
async function lgLoadModel(){
  if(lgModel&&lgMel)return true;
  if(lgModelLoading)return lgModelLoading;
  lgModelLoading=(async()=>{
    try{
      if(typeof tf==='undefined')throw new Error('tfjs library not loaded (check internet)');
      const mr=await fetch('mel_filter_lung.json');
      if(!mr.ok)throw new Error('mel_filter_lung.json → '+mr.status+' (upload it next to index.html)');
      const mjson=await mr.json();lgMel=Array.isArray(mjson)?mjson:mjson.mel;
      lgModel=await tf.loadGraphModel('lung_model.json');
      lgSelfTest();return true;
    }catch(e){lgModelErr=e.message||String(e);console.error('Lung model load failed:',e);return false;}
  })();
  return lgModelLoading;
}
function lgLogMelWindow(x,start){
  let xf=new Float32Array(LG_LWAV);
  for(let i=0;i<LG_LWAV;i++){const j=start+i;xf[i]=(j<x.length)?x[j]:0;}
  let mx=0;for(let i=0;i<LG_LWAV;i++){const a=Math.abs(xf[i]);if(a>mx)mx=a;}
  const nrm=1/(mx+1e-9);for(let i=0;i<LG_LWAV;i++)xf[i]*=nrm;
  const pad=LG_NFFT/2,xp=new Float32Array(LG_LWAV+LG_NFFT);xp.set(xf,pad);
  const nfr=1+Math.floor(LG_LWAV/LG_HOP);
  const P=new Float32Array(LG_NB*nfr),re=new Float64Array(LG_NFFT),im=new Float64Array(LG_NFFT);
  for(let f=0;f<nfr;f++){const off=f*LG_HOP;
    for(let k=0;k<LG_NFFT;k++){re[k]=xp[off+k]*LG_WIN[k];im[k]=0;}
    fft(re,im);
    for(let b=0;b<LG_NB;b++)P[b*nfr+f]=re[b]*re[b]+im[b]*im[b];}
  const S=new Float32Array(LG_NMEL*nfr);
  for(let m=0;m<LG_NMEL;m++){const mrow=lgMel[m];
    for(let f=0;f<nfr;f++){let acc=0;for(let b=0;b<LG_NB;b++)acc+=mrow[b]*P[b*nfr+f];
      S[m*nfr+f]=10*Math.log10(Math.max(1e-10,acc+1e-10));}}
  let smax=-Infinity;for(let i=0;i<S.length;i++)if(S[i]>smax)smax=S[i];
  const flo=smax-80;for(let i=0;i<S.length;i++)if(S[i]<flo)S[i]=flo;
  let mean=0;for(let i=0;i<S.length;i++)mean+=S[i];mean/=S.length;
  let vs=0;for(let i=0;i<S.length;i++){const d=S[i]-mean;vs+=d*d;}
  const std=Math.sqrt(vs/S.length)+1e-6;
  const out=new Float32Array(LG_NMEL*LG_TFR);
  for(let m=0;m<LG_NMEL;m++)for(let f=0;f<LG_TFR;f++)out[m*LG_TFR+f]=(f<nfr)?(S[m*nfr+f]-mean)/std:0;
  return out;
}
function lgInfer(feat){return tf.tidy(()=>{const x=tf.tensor4d(feat,[1,LG_NMEL,LG_TFR,1]);const y=lgModel.predict(x);const t=Array.isArray(y)?y[0]:y;return t.dataSync()[0];});}
function lgSelfTest(){try{const n=LG_LWAV,g=new Float32Array(n);for(let i=0;i<n;i++){const t=i/LG_SR;g[i]=Math.sin(2*Math.PI*250*t)+0.4*Math.sin(2*Math.PI*700*t);}const p=lgInfer(lgLogMelWindow(g,0));console.log('Lung AI self-check prob='+p.toFixed(4)+' ('+((isFinite(p)&&p>=0&&p<=1)?'ENGINE OK':'ERROR')+')');}catch(e){console.warn('lung self-test skipped',e);}}
/* average the model probability over sliding 5s windows (hop 2.5s) across the recording */
function lgProbForBuffer(s,fs){
  const x=pcResample(s,fs,LG_SR);
  const hop=LG_LWAV/2;let starts=[];
  for(let st=0; st+LG_LWAV<=x.length; st+=hop)starts.push(st);
  if(starts.length===0)starts=[0];
  let sum=0;for(const st of starts)sum+=lgInfer(lgLogMelWindow(x,st));
  return sum/starts.length;
}
function lgSignalOK(s,fs){
  let rms=0;for(let i=0;i<s.length;i++)rms+=s[i]*s[i];rms=Math.sqrt(rms/s.length);
  return rms>=0.0004;
}
/* ---- PulmoScope interactive lung map (same pattern as Percussion) ---- */
const LGZ=[
 {id:'R upper',px:60,py:24},{id:'L upper',px:40,py:24},
 {id:'R mid',px:58,py:40},{id:'L mid',px:42,py:40},
 {id:'R lower',px:60,py:56},{id:'L lower',px:40,py:56}
];
let lgState={},lgSel=null,lgWav=null;
function lgResetAll(){lgState={};LGZ.forEach(z=>lgState[z.id]={status:'pending',p:null});lgSel=null;$('lgResCard').style.display='none';$('lgSelName').textContent='Tap a point on the back above.';$('lgRec').textContent='\u25CF Select a point first';$('lgRec').disabled=true;lgRenderMap();lgRenderGrid();}
function lgColor(st){if(st.status==='active')return '#FFB454';if(st.status==='done')return '#2FBF8F';return '#5A6B94';}
function lgRenderMap(){const g=$('lgzones');g.innerHTML='';LGZ.forEach(z=>{const stt=lgState[z.id];const d=document.createElement('div');d.className='dot2';d.style.left=z.px+'%';d.style.top=z.py+'%';d.style.width='7%';d.style.background=lgColor(stt);if(z.id===lgSel){d.style.borderColor='#fff';d.style.borderWidth='3px';d.style.boxShadow='0 0 0 4px rgba(255,255,255,.3)';}d.onclick=()=>lgSelect(z.id);g.appendChild(d);});}
function lgRenderGrid(){const g=$('lgGrid');if(!g)return;g.innerHTML='';LGZ.forEach(z=>{const stt=lgState[z.id];const d=document.createElement('div');d.className='kv';d.innerHTML=z.id+'<b>'+(stt.p!=null?(stt.p*100).toFixed(0)+'%':'\u2014')+'</b>';g.appendChild(d);});}
function lgSelect(id){LGZ.forEach(z=>{const zs=lgState[z.id];if(z.id!==id&&zs.status==='active')zs.status=zs.p!=null?'done':'pending';});lgSel=id;lgState[id].status='active';$('lgSelName').innerHTML='Selected: <b>'+id+'</b>';$('lgRec').disabled=false;$('lgRec').textContent='\u25CF Record '+id+' (15s)';lgRenderMap();}
lgResetAll();

let lgStream,lgCtx,lgProc,lgZg,lgBuf=[],lgSr=48000,lgTimer,lgLeft;
function lgSt(m){$('lgStatus').textContent=m;}
let lgGating=false,lgGateRAF=null,lgGateCancel=null;
function lgNoiseLabel(t,c){var l=$('lgNoiseLbl');if(l){l.textContent=t;l.style.color=c||'#e6edf3';}}
function lgDrawNoise(noise,thresh){
  var c=$('lgNoiseCanvas');if(!c)return;var W=c.width=c.clientWidth*2,H=c.height=c.clientHeight*2,g=c.getContext('2d');g.clearRect(0,0,W,H);
  var full=120,norm=Math.min(1,noise/full),tx=Math.min(1,thresh/full)*W;
  g.fillStyle='rgba(47,191,143,.14)';pcRR(g,0,H*0.30,tx,H*0.40,H*0.20);g.fill();
  g.fillStyle='rgba(255,107,107,.14)';pcRR(g,tx,H*0.30,W-tx,H*0.40,H*0.20);g.fill();
  g.fillStyle=(noise<thresh)?'#2FBF8F':'#ff6b6b';pcRR(g,0,H*0.36,Math.max(H*0.28,norm*W),H*0.28,H*0.14);g.fill();
  g.strokeStyle='#e6edf3';g.lineWidth=3;g.beginPath();g.moveTo(tx,H*0.16);g.lineTo(tx,H*0.84);g.stroke();
  g.fillStyle='#8b98a5';g.font='600 20px system-ui';g.textAlign='center';g.fillText('quiet',tx*0.5,H*0.14);g.fillText('noisy',(W+tx)/2,H*0.14);
}
function lgStartQuietGate(){
  if(lgGating)return;
  if(!lgSel){lgSt('Tap a point on the back first.');return;}
  if(!$('pid').value){lgSt('Enter Patient ID (top of page) first.');return;}
  lgGating=true;var meter=$('lgNoise');if(meter)meter.style.display='block';
  $('lgRec').style.display='none';$('lgRec').disabled=true;$('lgStop').disabled=false;
  lgNoiseLabel('Listening for a quiet moment…','#e6edf3');lgSt('Checking the room is quiet enough…');
  navigator.mediaDevices.getUserMedia({audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false,channelCount:1}}).then(function(stream){
    var ctx=new (window.AudioContext||window.webkitAudioContext)();var src=ctx.createMediaStreamSource(stream);
    var an=ctx.createAnalyser();an.fftSize=2048;an.smoothingTimeConstant=0.8;src.connect(an);
    var freq=new Uint8Array(an.frequencyBinCount),binHz=ctx.sampleRate/an.fftSize,i0=Math.max(1,Math.floor(500/binHz));
    var quietSince=0,gateStart=performance.now(),HOLD=1500,MAXWAIT=15000;
    lgGateCancel=function(){try{cancelAnimationFrame(lgGateRAF);}catch(e){}try{stream.getTracks().forEach(function(t){t.stop();});}catch(e){}try{ctx.close();}catch(e){}lgGating=false;if(meter)meter.style.display='none';};
    function loop(){
      an.getByteFrequencyData(freq);var vs=[];for(var i=i0;i<freq.length;i++)vs.push(freq[i]);vs.sort(function(a,b){return b-a;});var kk=Math.min(8,vs.length),ns=0;for(var j=0;j<kk;j++)ns+=vs[j];var noise=kk?ns/kk:0;
      lgDrawNoise(noise,pcNoiseThresh);
      var now=performance.now(),forced=(now-gateStart)>MAXWAIT;
      if(noise<pcNoiseThresh){if(!quietSince)quietSince=now;var held=now-quietSince;
        lgNoiseLabel('Quiet ✓ — breathe deep, starting in '+Math.max(0,Math.ceil((HOLD-held)/1000))+'s','#2FBF8F');
        if(held>=HOLD){lgGateArmDone(stream,ctx,src,an,meter,false);return;}
      }else{quietSince=0;lgNoiseLabel('Too noisy — move away from fans/voices, quieten the room','#ff6b6b');}
      if(forced){lgGateArmDone(stream,ctx,src,an,meter,true);return;}
      lgGateRAF=requestAnimationFrame(loop);
    }
    loop();
  }).catch(function(){lgGating=false;if(meter)meter.style.display='none';$('lgRec').style.display='';lgSt('Microphone blocked. Allow mic and reload.');});
}
function lgGateArmDone(stream,ctx,src,an,meter,noisy){
  try{cancelAnimationFrame(lgGateRAF);}catch(e){}lgGating=false;lgGateCancel=null;
  try{an.disconnect();}catch(e){}if(meter)meter.style.display='none';
  lgBeginRecording(stream,ctx,src,noisy);
}
function lgBeginRecording(stream,ctx,src,noisy){
  lgStream=stream;lgCtx=ctx;lgSr=ctx.sampleRate;lgBuf=[];
  lgProc=ctx.createScriptProcessor(4096,1,1);lgZg=ctx.createGain();lgZg.gain.value=0;
  lgProc.onaudioprocess=function(e){lgBuf.push(new Float32Array(e.inputBuffer.getChannelData(0)));};
  if(!src)src=ctx.createMediaStreamSource(stream);
  src.connect(lgProc);lgProc.connect(lgZg);lgZg.connect(ctx.destination);
  $('lgRec').disabled=true;$('lgStop').disabled=false;
  var lead=noisy?'⚠ Noisy room — recording anyway ':('\u25CF Recording '+lgSel+'\u2026 deep breaths ');
  lgLeft=15;lgSt(lead+'('+lgLeft+'s)');
  lgTimer=setInterval(function(){lgLeft--;lgSt('\u25CF Recording '+lgSel+'\u2026 ('+lgLeft+'s)');if(lgLeft<=0)lgStopRec();},1000);
}
$('lgRec').onclick=lgStartQuietGate;
$('lgStop').onclick=function(){if(lgGating&&lgGateCancel){lgGateCancel();$('lgStop').disabled=true;$('lgRec').style.display='';$('lgRec').disabled=false;lgSt('Cancelled — tap a point and record again.');return;}lgStopRec();};
function lgStopRec(){
  clearInterval(lgTimer);try{lgProc.disconnect();}catch(e){}
  if(lgStream)lgStream.getTracks().forEach(t=>t.stop());
  $('lgStop').disabled=true;$('lgRec').style.display='';$('lgRec').disabled=false;lgSt('Analysing '+lgSel+'\u2026');
  let n=0;lgBuf.forEach(b=>n+=b.length);
  if(n<lgSr){lgSt('Too short \u2014 record ~15s.');try{lgCtx.close();}catch(e){}return;}
  const s=new Float32Array(n);let o=0;lgBuf.forEach(b=>{s.set(b,o);o+=b.length;});try{lgCtx.close();}catch(e){}
  lgWav=encodeWAV(s,lgSr);const p=$('lgPlayer');p.src=URL.createObjectURL(lgWav);p.style.display='block';
  lgDraw(s);lgScreen(s,lgSr,lgSel);
}
async function lgScreen(s,fs,zone){
  $('lgResCard').style.display='block';
  if(!lgSignalOK(s,fs)){lgSt(zone+': mic silent \u2014 press on skin and re-record.');lgUploadSafe(zone,'no_signal',null,s,fs);return;}
  const ok=await lgLoadModel();
  if(!ok){lgSt('AI model unavailable \u2014 '+lgModelErr);lgUploadSafe(zone,'model_unavailable',null,s,fs);return;}
  try{
    const pr=lgProbForBuffer(s,fs);
    lgState[zone].p=pr;lgState[zone].status='done';
    lgUpdate();lgRenderMap();lgRenderGrid();
    lgUploadSafe(zone,pr>=LG_THR?'abnormal':'normal',pr,s,fs);
    lgSt(zone+' done ('+(pr*100).toFixed(0)+'%). Tap the next point, or read the result below.');
  }catch(e){console.error(e);lgSt('Error processing '+zone+'.');lgUploadSafe(zone,'processing_error',null,s,fs);}
}
async function lgUploadSafe(zone,verdict,prob,s,fs){
  const r=await uploadRecording('pulmoscope',zone,makeSmallWavNorm(s,fs,LG_SR),prob,verdict,null);
  if(!r.ok)lgSt(zone+': \u26a0 not saved \u2014 '+r.reason);
  else if(r.reason)lgSt(zone+': saved, but \u26a0 '+r.reason);
}
function lgUpdate(){
  const vals=LGZ.filter(z=>lgState[z.id].p!=null).map(z=>lgState[z.id].p);
  $('lgN').textContent=vals.length+'/'+LGZ.length;
  if(vals.length===0){$('lgAvg').textContent='\u2014';$('lgVerdict').textContent='\u2014';return;}
  const avg=vals.reduce((a,b)=>a+b,0)/vals.length;
  $('lgAvg').textContent=(avg*100).toFixed(0)+'%';
  const pos=avg>=LG_THR;
  const partial=vals.length<LGZ.length?' ('+vals.length+'/'+LGZ.length+' points \u2014 do all for best reliability)':'';
  $('lgVerdict').textContent=(pos?'\uD83E\uDEC1 SCREEN POSITIVE \u2014 abnormal lung sounds likely, refer':'\uD83E\uDEC1 Screen negative \u2014 lungs sound normal')+partial;
  $('lgVerdict').style.color=pos?'var(--bad)':'var(--ok)';
}
function lgDraw(s){const c=$('lgWave');if(!c)return;c.style.display='block';c.width=c.clientWidth*2;c.height=180;const ctx=c.getContext('2d'),W=c.width,H=c.height;ctx.fillStyle='#070B16';ctx.fillRect(0,0,W,H);ctx.strokeStyle='#56d4dd';ctx.lineWidth=1;ctx.beginPath();const step=Math.max(1,Math.floor(s.length/W));for(let x=0;x<W;x++){const v=s[x*step]||0;const y=H/2-v*H*0.45;if(x===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);}ctx.stroke();}
$('lgReset').onclick=lgResetAll;
$('lgCsv').onclick=function(){
  const vals=LGZ.filter(z=>lgState[z.id].p!=null).map(z=>lgState[z.id].p);
  const avg=vals.length?vals.reduce((a,b)=>a+b,0)/vals.length:'';
  const verdict=avg===''?'':(avg>=LG_THR?'screen_positive':'screen_negative');
  const head='patient_id,'+LGZ.map(z=>'p_'+z.id.replace(/ /g,'_')).join(',')+',mean_abnormal_prob,threshold,verdict,datetime\n';
  const row=[($('pid').value||'')].concat(LGZ.map(z=>lgState[z.id].p!=null?lgState[z.id].p.toFixed(3):'')).concat([avg===''?'':avg.toFixed(3),LG_THR,verdict,new Date().toISOString()]).join(',')+'\n';
  dl(new Blob([head+row],{type:'text/csv'}),($('pid').value||'patient')+'_pulmoscope.csv');
};

/* ===== bilingual EN/Telugu ===== */
function applyLang(l){document.body.setAttribute('lang',l);
  document.querySelectorAll('[data-te]').forEach(function(el){
    if(!el.hasAttribute('data-en'))el.setAttribute('data-en',el.innerHTML);
    el.innerHTML=(l==='te')?el.getAttribute('data-te'):el.getAttribute('data-en');});
  var b=document.getElementById('langBtn');if(b)b.textContent=(l==='te')?'English':'తెలుగు';
  try{localStorage.setItem('cardiopulmo_lang',l);}catch(e){}}
function toggleLang(){applyLang(document.body.getAttribute('lang')==='te'?'en':'te');}
applyLang((function(){try{return localStorage.getItem('cardiopulmo_lang')||'en';}catch(e){return 'en';}})());
csTab('c');
topTab('home');


/* ===== Supabase: login (Google + email), one-time profile, audio upload ===== */
const SB_URL='https://cxqvghjdqyvtxdavhzjw.supabase.co';
const SB_ANON='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN4cXZnaGpkcXl2dHhkYXZoemp3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMwMDY5MzUsImV4cCI6MjA5ODU4MjkzNX0.vSEowF2M4Hv_j0LOSSJto_TulEce-wcA337ffK7kd5s';
const sb=(window.supabase&&window.supabase.createClient)?window.supabase.createClient(SB_URL,SB_ANON):null;
let sbUser=null;
function makeSmallWav(s,fs,targetSR){return encodeWAV(pcResample(s,fs,targetSR),targetSR);}
function makeSmallWavNorm(s,fs,targetSR){var r=pcResample(s,fs,targetSR),mx=1e-6;for(var i=0;i<r.length;i++){var a=Math.abs(r[i]);if(a>mx)mx=a;}var g=0.9/mx,o=new Float32Array(r.length);for(var j=0;j<r.length;j++)o[j]=r[j]*g;return encodeWAV(o,targetSR);}
async function uploadRecording(module,zone,wavBlob,probability,verdict,extra){
  if(!sb||!sbUser)return {ok:false,reason:'not logged in'};
  try{
    const path=sbUser.id+'/'+module+'_'+(zone||'x')+'_'+Date.now()+'.wav';
    const up=await sb.storage.from('recordings').upload(path,wavBlob,{contentType:'audio/wav',upsert:false});
    const ins=await sb.from('recordings').insert({user_id:sbUser.id,module:module,zone:zone||null,audio_path:up.error?null:path,probability:(probability==null?null:probability),verdict:verdict||null,extra:extra||null,subject_code:(document.getElementById('pid')?document.getElementById('pid').value:null)||null});
    if(ins.error){console.warn('recordings insert failed',ins.error);return {ok:false,reason:ins.error.message};}
    if(typeof cpLoadMine==='function')cpLoadMine();
    if(up.error){console.warn('audio upload failed',up.error);return {ok:true,reason:'audio file not saved — '+up.error.message};}
    return {ok:true};
  }catch(e){console.warn('upload failed',e);return {ok:false,reason:(e&&e.message)||'unknown error'};}
}
function sbShowApp(){var o=$('authOverlay');if(o)o.style.display='none';if(sbUser&&$('authWho'))$('authWho').textContent='Logged in as '+(sbUser.email||'user');if($('authBox'))$('authBox').style.display='block';if($('notLoggedBox'))$('notLoggedBox').style.display='none';cpLoadMine();if(pendingTab){var t=pendingTab;pendingTab=null;topTab(t);}}
async function cpLoadMine(){
  if(!sb||!sbUser){if($('myRecCard'))$('myRecCard').style.display='none';return;}
  if($('myRecCard'))$('myRecCard').style.display='block';
  var body=$('myRecBody');if(!body)return;
  try{
    const {data}=await sb.from('recordings').select('*').eq('user_id',sbUser.id).order('created_at',{ascending:false});
    var rows=data||[];
    if(!rows.length){body.innerHTML='<span class="note">No recordings yet. Record from Cardio or Pulmo.</span>';return;}
    var h='<div style="overflow:auto"><table style="width:100%;border-collapse:collapse;font-size:12px"><tr style="color:var(--mut)"><th style="text-align:left;padding:6px">Date</th><th style="text-align:left;padding:6px">Module</th><th style="text-align:left;padding:6px">Zone</th><th style="text-align:left;padding:6px">BPM</th><th style="text-align:left;padding:6px">Verdict</th><th style="padding:6px"></th></tr>';
    rows.forEach(function(r){var ex=r.extra||{};if(typeof ex==='string'){try{ex=JSON.parse(ex);}catch(e){ex={};}}
      h+='<tr><td style="padding:6px">'+new Date(r.created_at).toLocaleString()+'</td><td style="padding:6px">'+(r.module||'')+'</td><td style="padding:6px">'+(r.zone||'')+'</td><td style="padding:6px">'+(ex.bpm!=null?ex.bpm:'')+'</td><td style="padding:6px">'+(r.verdict||'')+'</td><td style="padding:6px;white-space:nowrap" data-id="'+r.id+'" data-path="'+(r.audio_path||'')+'"></td></tr>';
    });
    h+='</table></div>';body.innerHTML=h;
    body.querySelectorAll('td[data-id]').forEach(function(td){
      var path=td.getAttribute('data-path'),id=td.getAttribute('data-id');
      if(path){var pb=document.createElement('button');pb.className='sbtn';pb.textContent='▶';pb.style.marginRight='6px';pb.onclick=function(){cpPlayMine(path,pb);};td.appendChild(pb);}
      /* user delete temporarily disabled */
    });
  }catch(e){body.innerHTML='<span class="note">Could not load your recordings.</span>';}
}
async function cpPlayMine(path,btn){
  var old=btn.textContent;btn.textContent='…';
  try{var r=await sb.storage.from('recordings').createSignedUrl(path,3600);
    if(r.error||!r.data){btn.textContent='✕';return;}
    var a=new Audio(r.data.signedUrl);a.play();btn.textContent=old;
  }catch(e){btn.textContent='✕';}
}
async function cpDeleteMine(id,path){
  if(!confirm('Delete this recording? This cannot be undone.'))return;
  try{if(path){try{await sb.storage.from('recordings').remove([path]);}catch(e){}}
    await sb.from('recordings').delete().eq('id',id);cpLoadMine();
  }catch(e){}
}
function sbShowLogin(){var o=$('authOverlay');if(o)o.style.display='flex';initGoogleBtn();}
async function sbMaybeProfile(){
  if(!sb||!sbUser)return;
  try{const {data}=await sb.from('profiles').select('full_name,age,sex').eq('id',sbUser.id).maybeSingle();
    if(!data||!data.full_name){if($('profileOverlay'))$('profileOverlay').style.display='flex';}
    else if($('profileOverlay'))$('profileOverlay').style.display='none';
    if(data){
      if($('age')&&!$('age').value&&data.age){$('age').value=data.age;localStorage.setItem('cp_age',data.age);}
      if($('sex')&&!$('sex').value&&data.sex){var sv=(data.sex==='Male')?'M':(data.sex==='Female')?'F':'';if(sv){$('sex').value=sv;localStorage.setItem('cp_sex',sv);}}
    }
  }catch(e){}
}
async function sbInit(){
  var _o=$('authOverlay');if(_o)_o.style.display='none';
  topTab('home');
  if(!sb){return;}
  try{const {data}=await sb.auth.getSession();sbUser=data.session?data.session.user:null;}catch(e){sbUser=null;}
  if(sbUser){sbShowApp();sbMaybeProfile();}
  else{if($('authBox'))$('authBox').style.display='none';if($('notLoggedBox'))$('notLoggedBox').style.display='block';}
  sb.auth.onAuthStateChange(function(_e,session){
    sbUser=session?session.user:null;
    if(sbUser){sbShowApp();sbMaybeProfile();}
    else{var o=$('authOverlay');if(o)o.style.display='none';pendingTab=null;topTab('home');if($('authBox'))$('authBox').style.display='none';if($('notLoggedBox'))$('notLoggedBox').style.display='block';if($('myRecCard'))$('myRecCard').style.display='none';}
  });
}

if($('authLogin'))$('authLogin').onclick=async function(){if(!sb)return;const {error}=await sb.auth.signInWithPassword({email:$('authEmail').value.trim(),password:$('authPass').value});if(error)$('authMsg').textContent=error.message;};
if($('authSignup'))$('authSignup').onclick=async function(){if(!sb)return;const {error}=await sb.auth.signUp({email:$('authEmail').value.trim(),password:$('authPass').value});$('authMsg').textContent=error?error.message:'Account created — check your email to confirm, then log in.';};
if($('authLogout'))$('authLogout').onclick=async function(){if(sb)await sb.auth.signOut();};
if($('profileSave'))$('profileSave').onclick=async function(){
  if(!sb||!sbUser)return;
  var pfA=parseInt($('pfAge').value)||null;
  var pfS=$('pfSex').value||null;
  await sb.from('profiles').update({full_name:$('pfName').value.trim(),age:pfA,sex:pfS,phone:$('pfPhone').value.trim()||null,role:$('pfRole').value||null}).eq('id',sbUser.id);
  if($('age')&&pfA){$('age').value=pfA;localStorage.setItem('cp_age',pfA);}
  if($('sex')&&pfS){var sv2=(pfS==='Male')?'M':(pfS==='Female')?'F':'';if(sv2){$('sex').value=sv2;localStorage.setItem('cp_sex',sv2);}}
  $('profileOverlay').style.display='none';
};

/* ===== Google native sign-in (GSI) -> Supabase (no redirect page) ===== */
const GOOGLE_CLIENT_ID='533637534015-8eob9q94fecugvf6d4rm41hnc1fd6f4u.apps.googleusercontent.com';
let gsiDone=false;
function initGoogleBtn(){
  if(gsiDone)return;
  if(!(window.google&&google.accounts&&google.accounts.id)){setTimeout(initGoogleBtn,300);return;}
  gsiDone=true;
  google.accounts.id.initialize({client_id:GOOGLE_CLIENT_ID,callback:handleGoogleCredential,auto_select:false,cancel_on_tap_outside:true});
  var el=document.getElementById('googleSignInBtn');
  if(el&&!el.hasChildNodes()){google.accounts.id.renderButton(el,{theme:'outline',size:'large',width:320,text:'continue_with',shape:'rectangular'});}
}
async function handleGoogleCredential(resp){
  if(!sb){return;}
  const {error}=await sb.auth.signInWithIdToken({provider:'google',token:resp.credential});
  if(error){if($('authMsg'))$('authMsg').textContent='Google login failed — '+error.message;}
}

initGoogleBtn();
sbInit();

/* auto patient numbering + persistent age/sex */
function cpPad(n){return 'P'+String(n).padStart(3,'0');}
function cpSyncProfile(){
  try{
    if(!sb||!sbUser)return;
    var a=parseInt($('age')?$('age').value:'')||null;
    var sRaw=$('sex')?$('sex').value:'';
    var s=(sRaw==='M')?'Male':(sRaw==='F')?'Female':null;
    sb.from('profiles').update({age:a,sex:s}).eq('id',sbUser.id);
  }catch(e){}
}
(function cpInitPatient(){
  try{
    if($('pid')){var c=parseInt(localStorage.getItem('cp_pid_counter')||'1');$('pid').value=cpPad(c);}
    var a=localStorage.getItem('cp_age');if(a&&$('age'))$('age').value=a;
    var s=localStorage.getItem('cp_sex');if(s&&$('sex'))$('sex').value=s;
    if($('age'))$('age').addEventListener('change',function(){localStorage.setItem('cp_age',$('age').value);cpSyncProfile();});
    if($('sex'))$('sex').addEventListener('change',function(){localStorage.setItem('cp_sex',$('sex').value);cpSyncProfile();});
    if($('newPatientBtn'))$('newPatientBtn').onclick=function(){
      var c2=parseInt(localStorage.getItem('cp_pid_counter')||'1')+1;
      localStorage.setItem('cp_pid_counter',c2);$('pid').value=cpPad(c2);
    };
  }catch(e){}
})();
