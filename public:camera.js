import {PoseLandmarker,FilesetResolver} from 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22/+esm';
const q=new URLSearchParams(location.search),room=q.get('room'),token=q.get('token');
const state=document.querySelector('#state'),video=document.querySelector('video'),canvas=document.querySelector('#process'),ctx=canvas.getContext('2d');
let ws,stream,landmarker,active=false,mode='avatars',lastFrame=0,lastPose=0,processing=false,frames=0;
function send(v){if(ws?.readyState===1)ws.send(JSON.stringify(v));}
async function setupTracker(){
 const vision=await FilesetResolver.forVisionTasks('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22/wasm');
 landmarker=await PoseLandmarker.createFromOptions(vision,{baseOptions:{modelAssetPath:'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',delegate:'CPU'},runningMode:'VIDEO',numPoses:4,minPoseDetectionConfidence:.45,minTrackingConfidence:.4});
}
function connect(){const protocol=location.protocol==='https:'?'wss:':'ws:';ws=new WebSocket(`${protocol}//${location.host}/api/room/${room}/ws?role=camera&token=${encodeURIComponent(token)}`);ws.onopen=()=>state.textContent='Connected — camera active';ws.onclose=()=>{state.textContent='Disconnected — reconnecting';if(active)setTimeout(connect,2000)};ws.onmessage=e=>{let d=JSON.parse(e.data);if(d.type==='config')mode=d.mode};}
async function loop(now){if(!active)return;requestAnimationFrame(loop);if(processing||video.readyState<2||!landmarker||now-lastPose<85)return;processing=true;lastPose=now;
 try{const result=landmarker.detectForVideo(video,performance.now());const poses=(result.landmarks||[]).slice(0,4).map(points=>points.map(p=>[+p.x.toFixed(3),+p.y.toFixed(3),+(p.visibility||0).toFixed(2)]));send({type:'pose',poses,time:Date.now()});frames++;
 if(mode==='ar'&&now-lastFrame>200){lastFrame=now;canvas.width=320;canvas.height=180;ctx.drawImage(video,0,0,320,180);send({type:'frame',image:canvas.toDataURL('image/jpeg',.38)});}
 document.querySelector('#metrics').textContent=`Detected players: ${poses.length} · Tracking updates: ${frames}`;
 }catch(e){state.textContent='Tracking error: '+e.message}finally{processing=false;}
}
document.querySelector('#start').onclick=async()=>{if(!room||!token){state.textContent='Missing private room link';return}const start=document.querySelector('#start');start.disabled=true;state.textContent='Requesting camera…';try{stream=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:'environment'},width:{ideal:1280},height:{ideal:720},frameRate:{ideal:24}}});video.srcObject=stream;await video.play();state.textContent='Loading body tracking model…';await setupTracker();active=true;connect();requestAnimationFrame(loop);document.querySelector('#stop').disabled=false}catch(e){state.textContent='Could not start: '+e.message;stream?.getTracks().forEach(t=>t.stop());start.disabled=false}};
document.querySelector('#stop').onclick=()=>{active=false;ws?.close();stream?.getTracks().forEach(t=>t.stop());video.srcObject=null;document.querySelector('#start').disabled=false;document.querySelector('#stop').disabled=true;state.textContent='Camera stopped'};
window.addEventListener('pagehide',()=>{active=false;stream?.getTracks().forEach(t=>t.stop());ws?.close()});
