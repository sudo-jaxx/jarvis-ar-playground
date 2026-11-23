const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json','cache-control':'no-store'}});
const roomId=()=>Array.from(crypto.getRandomValues(new Uint8Array(4))).map(x=>x.toString(16).padStart(2,'0')).join('').toUpperCase();
export default {
 async fetch(request,env){
  const url=new URL(request.url);
  if(url.pathname==='/api/create' && request.method==='POST'){
   const room=roomId(); const host=crypto.randomUUID(); const camera=crypto.randomUUID();
   const id=env.ROOMS.idFromName(room); const stub=env.ROOMS.get(id);
   await stub.fetch('https://room/init',{method:'POST',body:JSON.stringify({host,camera})});
   return json({room,host,camera});
  }
  const match=url.pathname.match(/^\/api\/room\/([A-F0-9]{8})\/ws$/);
  if(match){const stub=env.ROOMS.get(env.ROOMS.idFromName(match[1]));return stub.fetch(request);}
  return env.ASSETS.fetch(request);
 }
};
export class PlaygroundRoom {
 constructor(state,env){this.state=state;this.env=env;this.clients=new Map();}
 async fetch(request){
  const u=new URL(request.url);
  if(u.pathname==='/init' && request.method==='POST'){
   if(await this.state.storage.get('auth'))return json({error:'already initialized'},409);
   await this.state.storage.put('auth',await request.json());return json({ok:true});
  }
  if(u.pathname.endsWith('/ws')){
   if(request.headers.get('Upgrade')?.toLowerCase()!=='websocket')return json({error:'websocket required'},426);
   const auth=await this.state.storage.get('auth');
   const token=u.searchParams.get('token'), role=u.searchParams.get('role');
   if(!auth||!['host','camera'].includes(role)||token!==auth[role])return json({error:'invalid room credentials'},403);
   const pair=new WebSocketPair();const client=pair[1];client.accept();
   const previous=this.clients.get(role);if(previous){try{previous.close(4000,'Replaced by new connection')}catch{}}
   this.clients.set(role,client);
   client.addEventListener('message',event=>{
    if(this.clients.get(role)!==client)return;
    if(typeof event.data!=='string'||event.data.length>120000)return;
    let data;try{data=JSON.parse(event.data)}catch{return;}
    if(!data||!['pose','frame','config','ping'].includes(data.type))return;
    if(role==='camera'&&!['pose','frame','ping'].includes(data.type))return;
    if(role==='host'&&!['config','ping'].includes(data.type))return;
    if(data.type==='frame'&&(!/^data:image\/jpeg;base64,/.test(data.image||'')||data.image.length>110000))return;
    const target=this.clients.get(role==='host'?'camera':'host');
    if(target?.readyState===1)try{target.send(event.data)}catch{}
   });
   client.addEventListener('close',()=>{if(this.clients.get(role)===client)this.clients.delete(role);});
   client.send(JSON.stringify({type:'connected',role}));
   return new Response(null,{status:101,webSocket:pair[0]});
  }
  return json({error:'not found'},404);
 }
}
