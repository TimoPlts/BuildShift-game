import{Room,type Client}from"@colyseus/core";
import{RoomStateSchema,PlayerStateSchema,RoundScoreSchema,type RoomStateSchemaInstance,PLAYER_NETWORK_INPUT_LIMITS as PIL,EVENTS,MatchPhase,BUILD_EVENTS,validateStructurePlacementIntent,ENERGY_EVENTS,canAffordBuild,computeEnergyAfterBuild,computeEnergyAfterRegeneration,applyStructureDamage,isStructureDestroyed}from"@buildshift/protocol";
import{stepPlayerMovement,movementInputToWorld,fireGate,hitscan}from"@buildshift/simulation";
import{PLAYER_MOVEMENT,VERTICAL_MOVEMENT,ASSAULT_RIFLE,MAX_HEALTH,MAX_SHIELD,ROUNDS_TO_WIN,ROUND_COUNTDOWN_SECONDS as RCS,ROUND_RESET_DELAY_SECONDS as RRS,BUILD_GRID,BUILD_RANGE,BUILD_RATE,getStructureConfig,ENERGY,getStructureDurability}from"@buildshift/game-config";
import{BuildingStateSchema,StructureStateSchema,StructureGridSchema,ib,oc,wc}from"../state/buildingState.js";
import{ServerPhysicsWorld}from"../physics/serverPhysicsWorld.js";
export const TWO_PLAYER_MOVEMENT_ROOM="two-player-movement";export const TWO_PLAYER_MOVEMENT_INPUT="two-player:input";
const THZ=30,TD=1/THZ;
const MC={moveSpeed:PLAYER_MOVEMENT.moveSpeed,gravity:VERTICAL_MOVEMENT.gravity,jumpVelocity:VERTICAL_MOVEMENT.jumpVelocity,terminalVelocity:VERTICAL_MOVEMENT.terminalVelocity,groundY:VERTICAL_MOVEMENT.groundY};
const W=ASSAULT_RIFLE,WID=W.id,EH=VERTICAL_MOVEMENT.playerHalfHeight,TR=0.4;
const CT=Math.max(1,Math.round(RCS*THZ)),RT=Math.max(1,Math.round(RRS*THZ));
const SP=[{x:-5,y:VERTICAL_MOVEMENT.groundY,z:0},{x:5,y:VERTICAL_MOVEMENT.groundY,z:0}];
type PE=InstanceType<typeof PlayerStateSchema>;
function cl(v:number,a:number,b:number){return v<a?a:v>b?b:v;}
function ad(y:number,p:number){const c=Math.cos(p);return{x:Math.sin(y)*c,y:Math.sin(p),z:-Math.cos(y)*c};}
function pi(m:unknown){if(!m||typeof m!=="object")return null;const r=m as Record<string,unknown>,s=r.sequence;if(typeof s!=="number"||!Number.isFinite(s))return null;const mx=typeof r.moveX==="number"&&Number.isFinite(r.moveX)?cl(r.moveX,PIL.movementMin,PIL.movementMax):0,mz=typeof r.moveZ==="number"&&Number.isFinite(r.moveZ)?cl(r.moveZ,PIL.movementMin,PIL.movementMax):0,ly=typeof r.lookYaw==="number"&&Number.isFinite(r.lookYaw)?cl(r.lookYaw,-Math.PI,Math.PI):0,lp=typeof r.lookPitch==="number"&&Number.isFinite(r.lookPitch)?cl(r.lookPitch,PIL.pitchMin,PIL.pitchMax):0;return{sequence:s,moveX:mx,moveZ:mz,lookYaw:ly,lookPitch:lp,jump:r.jump===true,sprint:r.sprint===true,crouch:r.crouch===true,primaryFire:r.primaryFire===true,secondaryFire:r.secondaryFire===true};}
function dd(ax:number,ay:number,az:number,bx:number,by:number,bz:number){const x=ax-bx,y=ay-by,z=az-bz;return Math.sqrt(x*x+y*y+z*z);}
export class TwoPlayerMovementRoom extends Room<{state:RoomStateSchemaInstance}>{
state=new RoomStateSchema();maxPlayers=2;
private readonly bld=new BuildingStateSchema();
private readonly occ=new Set<string>();
private readonly lpt=new Map<string,number>();
private tc=0;private sc=0;
private pw:ServerPhysicsWorld|null=null;
private readonly pwp:Promise<ServerPhysicsWorld>;
private readonly inb=new Map<string,any>();
private jc=0;private readonly ss=new Map<string,number>();private ptl=0;
constructor(...args:ConstructorParameters<typeof Room>){super(...args);(this.state as unknown as Record<string,unknown>).building=this.bld;this.pwp=ServerPhysicsWorld.create().then(w=>{this.pw=w;return w;});}
onCreate():void{this.onMessage(TWO_PLAYER_MOVEMENT_INPUT,(c,m)=>{this.hi(c,m);});this.onMessage(BUILD_EVENTS.PLACEMENT_REQUEST,(c,m)=>{this.hpr(c,m);});this.state.matchPhase=MatchPhase.IN_PROGRESS;this.state.currentRound=1;this.ptl=0;this.setFixedTimestep(()=>this.tick(),THZ);}
onJoin(c:Client):void{const si=this.jc%SP.length,sp=SP[si];this.jc++;this.ss.set(c.sessionId,si);const p=new PlayerStateSchema();p.x=sp.x;p.y=sp.y;p.z=sp.z;p.yaw=0;p.velocityY=0;p.grounded=true;p.lastProcessedSequence=-1;p.health=MAX_HEALTH;p.shield=MAX_SHIELD;p.energy=ENERGY.startingEnergy;p.ammo=W.maxAmmo;p.lastFireSequence=-1;p.alive=true;p.isEliminated=false;this.state.players.set(c.sessionId,p);const r=new RoundScoreSchema();r.value=0;this.state.roundScore.set(c.sessionId,r);}
onLeave(c:Client,_e?:number):void{this.state.players.delete(c.sessionId);this.state.roundScore.delete(c.sessionId);this.inb.delete(c.sessionId);this.ss.delete(c.sessionId);this.lpt.delete(c.sessionId);}
onDispose():void{this.inb.clear();this.ss.clear();this.lpt.clear();this.occ.clear();if(this.pw){this.pw.dispose();this.pw=null;}}
private hi(c:Client,m:unknown):void{const i=pi(m);if(!i)return;this.inb.set(c.sessionId,i);}
private rb(c:Client,seq:number,reason:string):void{c.send(BUILD_EVENTS.STRUCTURE_REJECTED,{sequence:seq,reason});}
private async hpr(c:Client,msg:unknown):Promise<void>{
const sid=c.sessionId,v=validateStructurePlacementIntent(msg);
if(!v.ok){const r=msg as Record<string,unknown>|null,q=r&&typeof r.sequence==="number"?r.sequence:0;this.rb(c,q,"invalid_grid");return;}
const it=v.value,pl=this.state.players.get(sid);
if(!pl){this.rb(c,it.sequence,"invalid_grid");return;}
const cfg=getStructureConfig(it.buildType);
if(!cfg){this.rb(c,it.sequence,"unknown_build_type");return;}
if(cfg.rotationCount===1&&it.rotation!==0){this.rb(c,it.sequence,"invalid_grid");return;}
if(this.state.matchPhase!==MatchPhase.IN_PROGRESS){this.rb(c,it.sequence,"rate_limited");return;}
if(!ib(it.grid,cfg,it.rotation)){this.rb(c,it.sequence,"invalid_grid");return;}
const ax=it.grid.x*BUILD_GRID.cellSize,ay=it.grid.y*BUILD_GRID.layerHeight,az=it.grid.z*BUILD_GRID.cellSize;
if(dd(pl.x,pl.y,pl.z,ax,ay,az)>BUILD_RANGE.maxPlacementDistance){this.rb(c,it.sequence,"out_of_range");return;}
const cells=oc(it.grid,cfg,it.rotation);
for(const cell of cells)if(this.occ.has(cell)){this.rb(c,it.sequence,"overlap");return;}
const lt=this.lpt.get(sid);
if(lt!==undefined&&this.tc-lt<BUILD_RATE.minTicksBetweenPlacements){this.rb(c,it.sequence,"rate_limited");return;}
if(!canAffordBuild(pl.energy,cfg.cost)){this.rb(c,it.sequence,"unaffordable");return;}
this.sc++;const id=this.roomId+"-"+this.sc;
const maxDur=getStructureDurability(it.buildType)??100;
const st={structureId:id,buildType:it.buildType,grid:{x:it.grid.x,y:it.grid.y,z:it.grid.z},rotation:it.rotation,ownerId:sid,createdSequence:it.sequence};
const en=new StructureStateSchema(),gr=new StructureGridSchema();
en.structureId=st.structureId;en.buildType=st.buildType;gr.x=st.grid.x;gr.y=st.grid.y;gr.z=st.grid.z;
en.grid=gr;en.rotation=st.rotation;en.ownerId=st.ownerId;en.createdSequence=st.createdSequence;
en.maxDurability=maxDur;en.currentDurability=maxDur;
this.bld.structures.set(id,en);for(const cell of cells)this.occ.add(cell);this.lpt.set(sid,this.tc);
pl.energy=computeEnergyAfterBuild(pl.energy,cfg.cost,ENERGY.maxEnergy);
this.broadcast(ENERGY_EVENTS.ENERGY_UPDATE,{playerId:sid,energy:pl.energy});
const pw=await this.pwp,wco=wc(it.grid,cfg,it.rotation);pw.addStructureCollider(id,wco.ctr,wco.he);
this.broadcast(BUILD_EVENTS.STRUCTURE_PLACED,{structure:st});}
private tick():void{
this.tc++;const ph=this.state.matchPhase as MatchPhase;
if(ph===MatchPhase.COUNTDOWN){if(this.ptl>0){this.ptl--;if(this.ptl===0)this.br();}return;}
if(ph===MatchPhase.ROUND_ENDED){if(this.ptl>0){this.ptl--;if(this.ptl===0)this.bc();}return;}
if(ph!==MatchPhase.IN_PROGRESS)return;
for(const[,p]of this.state.players){p.energy=computeEnergyAfterRegeneration(p.energy,ENERGY.maxEnergy,1,ENERGY.regenPerTick);}
for(const[sid,p]of this.state.players){
if(p.isEliminated||this.state.matchPhase!==MatchPhase.IN_PROGRESS){this.inb.delete(sid);continue;}
const buf=this.inb.get(sid);
if(buf===undefined){this.sn(p);continue;}
if(buf.sequence<=p.lastProcessedSequence){this.inb.delete(sid);this.sn(p);continue;}
const wd=movementInputToWorld({x:buf.moveX,z:buf.moveZ},p.yaw);
const res=stepPlayerMovement({x:p.x,y:p.y,z:p.z,vx:0,vy:p.velocityY,vz:0,onGround:p.grounded},{moveX:wd.x,moveZ:wd.z,jump:buf.jump},TD,MC);
p.x=res.x;p.y=res.y;p.z=res.z;p.velocityY=res.vy;p.grounded=res.onGround;p.yaw=buf.lookYaw;p.lastProcessedSequence=buf.sequence;
if(buf.primaryFire)this.rf(sid,p,buf.lookYaw,buf.lookPitch);
this.inb.delete(sid);}}
private sn(p:PE):void{const res=stepPlayerMovement({x:p.x,y:p.y,z:p.z,vx:0,vy:p.velocityY,vz:0,onGround:p.grounded},{moveX:0,moveZ:0,jump:false},TD,MC);p.y=res.y;p.velocityY=res.vy;p.grounded=res.onGround;}
private bc():void{this.rp();this.inb.clear();this.state.matchPhase=MatchPhase.COUNTDOWN;this.ptl=CT;}
private br():void{this.inb.clear();this.state.currentRound+=1;this.state.matchPhase=MatchPhase.IN_PROGRESS;this.ptl=0;}
private ks(id:string,by:string){const s=this.bld.structures.get(id);if(!s)return;this.bld.structures.delete(id);const c=getStructureConfig(s.buildType);if(c){const cs=oc(s.grid,c,s.rotation);for(const k of cs)this.occ.delete(k);}if(this.pw)this.pw.removeStructureCollider(id);this.broadcast(ENERGY_EVENTS.STRUCTURE_DESTROYED,{structureId:id,destroyedByPlayerId:by,destroyedByWeaponId:WID});}
private clearStructures():void{for(const id of this.bld.structures.keys())this.ks(id,"");}
private rp():void{this.clearStructures();for(const[sid,p]of this.state.players){const sp=SP[this.ss.get(sid)??0];p.x=sp.x;p.y=sp.y;p.z=sp.z;p.yaw=0;p.velocityY=0;p.grounded=true;p.health=MAX_HEALTH;p.shield=MAX_SHIELD;p.energy=ENERGY.startingEnergy;p.ammo=W.maxAmmo;p.lastFireSequence=-1;p.alive=true;p.isEliminated=false;}}
private endRound(wid:string,_lid:string):void{
if(this.state.matchPhase!==MatchPhase.IN_PROGRESS)return;
const ws=this.state.roundScore.get(wid);
if(ws!==undefined)ws.value+=1;else{const s=new RoundScoreSchema();s.value=1;this.state.roundScore.set(wid,s);}
const wins=this.state.roundScore.get(wid)?.value??0;
this.state.lastRoundResult.winnerId=wid;this.state.lastRoundResult.roundNumber=this.state.currentRound;this.inb.clear();
if(wins>=ROUNDS_TO_WIN){this.state.matchPhase=MatchPhase.MATCH_ENDED;this.ptl=0;return;}
this.state.matchPhase=MatchPhase.ROUND_ENDED;this.ptl=RT;}
private rf(sid:string,sh:PE,yaw:number,pitch:number):void{
const g=fireGate({lastFireSequence:sh.lastFireSequence,currentSequence:sh.lastProcessedSequence,fireIntervalTicks:W.fireIntervalTicks,isEliminated:sh.isEliminated,ammo:sh.ammo});
if(!g.approved){this.broadcast(EVENTS.FIRE_REJECTED,{shooterId:sid,reason:g.reason});return;}
sh.ammo--;sh.lastFireSequence=sh.lastProcessedSequence;
const o={x:sh.x,y:sh.y+EH,z:sh.z},d=ad(yaw,pitch),t=[],st=[];
for(const[id,tp]of this.state.players){if(id!==sid&&!tp.isEliminated)t.push({id,position:{x:tp.x,y:tp.y+EH,z:tp.z}});}
for(const[id,s]of this.bld.structures){const c=getStructureConfig(s.buildType);if(!c)continue;const w=wc(s.grid,c,s.rotation);st.push({id,position:{x:w.ctr.x,y:w.ctr.y,z:w.ctr.z}});}
const pH=hitscan(o,d,{damage:W.damage,range:W.range,targetRadius:TR},t)[0];
const sH=hitscan(o,d,{damage:W.damage,range:W.range,targetRadius:0.5},st)[0];
const hit=pH&&(sH===undefined||pH.distance<=sH.distance)?pH:sH;
if(!hit)return;
if(this.state.players.has(hit.targetId)){
const tp=this.state.players.get(hit.targetId)!;
let r=hit.damage;if(tp.shield>0){const a=Math.min(tp.shield,r);tp.shield-=a;r-=a;}
if(r>0)tp.health=Math.max(0,tp.health-r);
this.broadcast(EVENTS.HIT,{shooterId:sid,targetId:hit.targetId,damage:hit.damage,hitPoint:hit.hitPoint,weaponId:WID});
if(tp.health<=0){tp.health=0;tp.alive=false;tp.isEliminated=true;this.broadcast(EVENTS.ELIMINATED,{eliminatedId:hit.targetId,eliminatedById:sid});this.endRound(sid,hit.targetId);}
this.broadcast(EVENTS.HEALTH_UPDATE,{playerId:hit.targetId,health:tp.health,shield:tp.shield,alive:tp.alive,isEliminated:tp.isEliminated});
}else{
const s=this.bld.structures.get(hit.targetId);if(!s)return;
const nd=applyStructureDamage(s.currentDurability,W.damage);s.currentDurability=nd;
if(isStructureDestroyed(nd))this.ks(hit.targetId,sid);
else this.broadcast(ENERGY_EVENTS.STRUCTURE_DAMAGED,{structureId:hit.targetId,damage:W.damage,remainingDurability:nd,sourcePlayerId:sid,sourceWeaponId:WID});
}}}
