const q=new URLSearchParams(location.search),room=q.get('room'),token=q.get('token');let secrets;try{secrets=JSON.parse(sessionStorage.getItem('jarvis-'+room)||'null')}catch{};
const camToken=secrets?.camera;const link=camToken?`${location.origin}/camera.html?room=${room}&token=${encodeURIComponent(camToken)}`:'';
document.querySelector('#link').textContent=link||'Camera link unavailable. Create a new room from the homepage.';
document.querySelector('#copy').onclick=()=>link&&navigator.clipboard.writeText(link);
const canvas=document.querySelector('#stage'),ctx=canvas.getContext('2d'),bg=document.querySelector('#videoBg'),mode=document.querySelector('#mode'),scores=document.querySelector('#scores'),status=document.querySelector('#connection');
const colors=['#3ddcff','#ffb648','#a3ff73','#ed8cff'];let ws,poses=[],lastPose=0,points=[0,0,0,0],stars=[],lastHit=new Map();
function spawn(){return {x:90+Math.random()*780,y:90+Math.random()*330,r:24+Math.random()*8};}
function reset(){points=[0,0,0,0];stars=Array.from({length:5},spawn);lastHit.clear();}reset();
document.querySelector('#reset').onclick=reset;
function send(v){if(ws?.readyState===1)ws.send(JSON.stringify(v))}
mode.onchange=()=>{bg.style.display=mode.value==='ar'?'block':'none';send({type:'config',mode:mode.value})};
function connect(){if(!room||!token){status.textContent='Invalid display link';return}const p=location.protocol==='https:'?'wss:':'ws:';ws=new WebSocket(`${p}//${location.host}/api/room/${room}/ws?role=host&token=${encodeURIComponent(token)}`);ws.onopen=()=>{status.textContent='Display connected';send({type:'config',mode:mode.value})};ws.onclose=()=>{status.textContent='Reconnecting…';setTimeout(connect,2000)};ws.onmessage=e=>{const d=JSON.parse(e.data);if(d.type==='pose'){poses=d.poses||[];lastPose=Date.now()}if(d.type==='frame'&&mode.value==='ar'&&typeof d.image==='string')bg.src=d.image;};}connect();
const bones=[[11,12],[11,13],[13,15],[12,14],[14,16],[11,23],[12,24],[23,24],[23,25],[25,27],[24,26],[26,28]];
function drawPerson(p,i){ctx.strokeStyle=colors[i];ctx.fillStyle=colors[i];ctx.lineWidth=6;const xy=j=>({x:(1-p[j][0])*960,y:p[j][1]*540});for(const [a,b]of bones){if((p[a]?.[2]||0)<.35||(p[b]?.[2]||0)<.35)continue;const A=xy(a),B=xy(b);ctx.beginPath();ctx.moveTo(A.x,A.y);ctx.lineTo(B.x,B.y);ctx.stroke();}for(const j of [0,11,12,15,16,23,24,27,28]){if((p[j]?.[2]||0)<.35)continue;const A=xy(j);ctx.beginPath();ctx.arc(A.x,A.y,j===0?12:7,0,Math.PI*2);ctx.fill();}if(p[0]){const a=xy(0);ctx.font='bold 20px system-ui';ctx.fillText('P'+(i+1),a.x+15,a.y-15)}}
function tick(){requestAnimationFrame(tick);ctx.clearRect(0,0,960,540);if(mode.value==='avatars'){ctx.fillStyle='#0d1930';ctx.fillRect(0,0,960,540);ctx.strokeStyle='#233a54';for(let x=0;x<960;x+=80){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,540);ctx.stroke()}}
ctx.font='bold 28px system-ui';ctx.fillStyle='#fff';ctx.fillText('STAR CATCH',25,45);
for(const s of stars){ctx.shadowBlur=22;ctx.shadowColor='#ffd348';ctx.fillStyle='#ffe66a';ctx.beginPath();ctx.arc(s.x,s.y,s.r,0,Math.PI*2);ctx.fill();ctx.shadowBlur=0;}
if(Date.now()-lastPose<2000){poses.forEach((p,i)=>{if(i>3||p.length<29)return;drawPerson(p,i);for(const j of [15,16]){if((p[j]?.[2]||0)<.55)continue;const x=(1-p[j][0])*960,y=p[j][1]*540;for(let k=0;k<stars.length;k++){const s=stars[k];if(Math.hypot(x-s.x,y-s.y)<s.r+20 && performance.now()-(lastHit.get(i+'-'+j)||0)>450){points[i]++;stars[k]=spawn();lastHit.set(i+'-'+j,performance.now())}}}});scores.textContent=points.map((n,i)=>`P${i+1}: ${n}`).join('  |  ')+` · Tracking ${poses.length} player(s)`;}else{scores.textContent='Waiting for camera tracking…';ctx.fillStyle='#d6e7ff';ctx.font='24px system-ui';ctx.fillText('Open the private camera link on your iPhone',170,270)}
}tick();
