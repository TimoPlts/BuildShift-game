/**
 * Stage 2D — canonical authoritative two-player Colyseus room with
 * deterministic movement AND server-authoritative hitscan combat.
 * The SINGLE authoritative gameplay loop: movement, prediction, reconciliation,
 * interpolation and combat all share this tick-driven path at 30 Hz.
 */
import { Room, type Client } from "@colyseus/core";
import {
  RoomStateSchema, PlayerStateSchema,
  type RoomStateSchemaInstance, type PlayerNetworkInput,
  type HitPoint, type HitResultEvent, type PlayerEliminatedEvent,
  type WeaponId, PLAYER_NETWORK_INPUT_LIMITS, EVENTS,
} from "@buildshift/protocol";
import {
  stepPlayerMovement, movementInputToWorld, canFire, rayIntersectsCapsule,
  type PlayerMovementState, type PlayerMovementConfig, type Vec3,
} from "@buildshift/simulation";
import {
  PLAYER_MOVEMENT, VERTICAL_MOVEMENT, ASSAULT_RIFLE, MAX_HEALTH, MAX_SHIELD,
} from "@buildshift/game-config";

const LOG = "[buildshift:two-player-movement]";
export const TWO_PLAYER_MOVEMENT_ROOM = "two-player-movement";
export const TWO_PLAYER_MOVEMENT_INPUT = "two-player:input";

const TICK_RATE_HZ = 30;
const TICK_DT = 1 / TICK_RATE_HZ;

const MOVEMENT_CONFIG: PlayerMovementConfig = {
  moveSpeed: PLAYER_MOVEMENT.moveSpeed,
  gravity: VERTICAL_MOVEMENT.gravity,
  jumpVelocity: VERTICAL_MOVEMENT.jumpVelocity,
  terminalVelocity: VERTICAL_MOVEMENT.terminalVelocity,
  groundY: VERTICAL_MOVEMENT.groundY,
};

const WEAPON = ASSAULT_RIFLE;
const WEAPON_ID: WeaponId = WEAPON.id as WeaponId;
const EYE_H = VERTICAL_MOVEMENT.playerHalfHeight;
const TARGET_R = 0.4;
const RESPAWN_TICKS = 60;

const SPAWNS: ReadonlyArray<{x:number;y:number;z:number}> = [
  { x: -5, y: VERTICAL_MOVEMENT.groundY, z: 0 },
  { x: 5, y: VERTICAL_MOVEMENT.groundY, z: 0 },
];

type PE = InstanceType<typeof PlayerStateSchema>;

function clamp(v:number,mn:number,mx:number):number{
  if(v<mn)return mn;if(v>mx)return mx;return v;
}

function aimDir(yaw:number,pitch:number):Vec3{
  const cp=Math.cos(pitch);
  return{x:Math.sin(yaw)*cp,y:Math.sin(pitch),z:-Math.cos(yaw)*cp};
}

function parseInput(msg:unknown):PlayerNetworkInput|null{
  if(!msg||typeof msg!=="object")return null;
  const r=msg as Record<string,unknown>;
  const seq=r.sequence;
  if(typeof seq!=="number"||!Number.isFinite(seq))return null;
  const mx=typeof r.moveX==="number"&&Number.isFinite(r.moveX)?clamp(r.moveX,PLAYER_NETWORK_INPUT_LIMITS.movementMin,PLAYER_NETWORK_INPUT_LIMITS.movementMax):0;
  const mz=typeof r.moveZ==="number"&&Number.isFinite(r.moveZ)?clamp(r.moveZ,PLAYER_NETWORK_INPUT_LIMITS.movementMin,PLAYER_NETWORK_INPUT_LIMITS.movementMax):0;
  const ly=typeof r.lookYaw==="number"&&Number.isFinite(r.lookYaw)?clamp(r.lookYaw,-Math.PI,Math.PI):0;
  const lp=typeof r.lookPitch==="number"&&Number.isFinite(r.lookPitch)?clamp(r.lookPitch,PLAYER_NETWORK_INPUT_LIMITS.pitchMin,PLAYER_NETWORK_INPUT_LIMITS.pitchMax):0;
  return{sequence:seq,moveX:mx,moveZ:mz,lookYaw:ly,lookPitch:lp,jump:r.jump===true,sprint:r.sprint===true,crouch:r.crouch===true,primaryFire:r.primaryFire===true,secondaryFire:r.secondaryFire===true};
}

export class TwoPlayerMovementRoom extends Room<{state:RoomStateSchemaInstance}> {
  state = new RoomStateSchema();
  maxPlayers = 2;

  private readonly inputBuf = new Map<string,PlayerNetworkInput>();
  private joinCount = 0;
  private readonly spawnSlots = new Map<string,number>();
  private readonly respawnT = new Map<string,number>();

  onCreate():void{
    console.log(`${LOG} room created (roomId=${this.roomId})`);
    this.onMessage(TWO_PLAYER_MOVEMENT_INPUT,(c,m)=>{this.handleInput(c,m);});
    this.setFixedTimestep(()=>this.tick(),TICK_RATE_HZ);
  }

  onJoin(client:Client):void{
    const si=this.joinCount%SPAWNS.length;
    const sp=SPAWNS[si];
    this.joinCount++;
    this.spawnSlots.set(client.sessionId,si);
    const p=new PlayerStateSchema();
    p.x=sp.x;p.y=sp.y;p.z=sp.z;p.yaw=0;p.velocityY=0;p.grounded=true;
    p.lastProcessedSequence=-1;
    p.health=MAX_HEALTH;p.shield=MAX_SHIELD;p.energy=0;
    p.ammo=WEAPON.maxAmmo;p.lastFireSequence=-1;
    p.alive=true;p.isEliminated=false;
    this.state.players.set(client.sessionId,p);
    console.log(`${LOG} joined (sid=${client.sessionId}, slot=${si}, clients=${this.clients.length})`);
  }

  onLeave(client:Client,code?:number):void{
    this.state.players.delete(client.sessionId);
    this.inputBuf.delete(client.sessionId);
    this.spawnSlots.delete(client.sessionId);
    this.respawnT.delete(client.sessionId);
    console.log(`${LOG} left (sid=${client.sessionId}, code=${code??"n/a"})`);
  }

  onDispose():void{
    this.inputBuf.clear();this.spawnSlots.clear();this.respawnT.clear();
    console.log(`${LOG} disposed (roomId=${this.roomId})`);
  }

  private handleInput(client:Client,msg:unknown):void{
    const inp=parseInput(msg);
    if(!inp){console.warn(`${LOG} bad input from ${client.sessionId}`);return;}
    this.inputBuf.set(client.sessionId,inp);
  }

  private tick():void{
    for(const[sid,p]of this.state.players){
      if(p.isEliminated){
        this.inputBuf.delete(sid);
        const rem=this.respawnT.get(sid);
        if(rem===undefined)continue;
        if(rem<=1){this.respawn(sid,p);}
        else{this.respawnT.set(sid,rem-1);}
        continue;
      }
      const buf=this.inputBuf.get(sid);
      if(buf===undefined){this.stepNeutral(p);continue;}
      if(buf.sequence<=p.lastProcessedSequence){
        this.inputBuf.delete(sid);
        this.stepNeutral(p);
        continue;
      }
      const wd=movementInputToWorld({x:buf.moveX,z:buf.moveZ},p.yaw);
      const st:PlayerMovementState={x:p.x,y:p.y,z:p.z,vx:0,vy:p.velocityY,vz:0,onGround:p.grounded};
      const res=stepPlayerMovement(st,{moveX:wd.x,moveZ:wd.z,jump:buf.jump},TICK_DT,MOVEMENT_CONFIG);
      p.x=res.x;p.y=res.y;p.z=res.z;p.velocityY=res.vy;p.grounded=res.onGround;
      p.yaw=buf.lookYaw;p.lastProcessedSequence=buf.sequence;
      if(buf.primaryFire){this.resolveFire(sid,p,buf.lookYaw,buf.lookPitch);}
      this.inputBuf.delete(sid);
    }
  }

  private stepNeutral(p:PE):void{
    const st:PlayerMovementState={x:p.x,y:p.y,z:p.z,vx:0,vy:p.velocityY,vz:0,onGround:p.grounded};
    const res=stepPlayerMovement(st,{moveX:0,moveZ:0,jump:false},TICK_DT,MOVEMENT_CONFIG);
    p.y=res.y;p.velocityY=res.vy;p.grounded=res.onGround;
  }

  private resolveFire(sid:string,sh:PE,yaw:number,pitch:number):void{
    if(!canFire(sh.lastFireSequence,sh.lastProcessedSequence,WEAPON.fireIntervalTicks,{isEliminated:sh.isEliminated}))return;
    if(sh.ammo<=0)return;
    sh.ammo--;sh.lastFireSequence=sh.lastProcessedSequence;
    const origin:Vec3={x:sh.x,y:sh.y+EYE_H,z:sh.z};
    const dir=aimDir(yaw,pitch);
    let best:{id:string;tp:PE;d:number}|null=null;
    for(const[tid,tp]of this.state.players){
      if(tid===sid||tp.isEliminated)continue;
      const tc:Vec3={x:tp.x,y:tp.y+EYE_H,z:tp.z};
      const r=rayIntersectsCapsule(origin,dir,tc,TARGET_R,WEAPON.range);
      if(r.hit&&(!best||r.distance<best.d)){best={id:tid,tp,d:r.distance};}
    }
    if(!best)return;
    const dmg=WEAPON.damage;
    let rem=dmg;
    if(best.tp.shield>0){const ab=Math.min(best.tp.shield,rem);best.tp.shield-=ab;rem-=ab;}
    if(rem>0){best.tp.health=Math.max(0,best.tp.health-rem);}
    const hp:HitPoint={x:origin.x+dir.x*best.d,y:origin.y+dir.y*best.d,z:origin.z+dir.z*best.d};
    this.broadcast(EVENTS.HIT,{shooterId:sid,targetId:best.id,damage:dmg,hitPoint:hp,weaponId:WEAPON_ID}as HitResultEvent);
    if(best.tp.health<=0){
      best.tp.health=0;best.tp.isEliminated=true;best.tp.alive=false;
      this.respawnT.set(best.id,RESPAWN_TICKS);
      const ev:PlayerEliminatedEvent={eliminatedId:best.id,eliminatedById:sid};
      this.broadcast(EVENTS.ELIMINATED,ev);
      console.log(`${LOG} eliminated: ${best.id} by ${sid}`);
    }
    console.log(`${LOG} hit: ${sid}->${best.id} dmg=${dmg} dist=${best.d.toFixed(1)}`);
  }

  private respawn(sid:string,p:PE):void{
    const sl=this.spawnSlots.get(sid)??0;
    const sp=SPAWNS[sl];
    p.x=sp.x;p.y=sp.y;p.z=sp.z;p.velocityY=0;p.grounded=true;
    p.health=MAX_HEALTH;p.shield=MAX_SHIELD;p.ammo=WEAPON.maxAmmo;
    p.lastFireSequence=-1;p.isEliminated=false;p.alive=true;
    this.respawnT.delete(sid);
    console.log(`${LOG} respawned: ${sid} at (${sp.x},${sp.y},${sp.z})`);
  }
}
