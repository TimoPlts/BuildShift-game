/**
 * Stage 2D — canonical authoritative two-player Colyseus room with
 * deterministic movement AND server-authoritative hitscan combat, plus the
 * authoritative first-to-`ROUNDS_TO_WIN` round lifecycle.
 */
import { Room, type Client } from "@colyseus/core";
import {
  RoomStateSchema, PlayerStateSchema, RoundScoreSchema,
  type RoomStateSchemaInstance, type PlayerNetworkInput,
  type HitResultEvent, type PlayerEliminatedEvent,
  type FireRejectedEvent, type HealthUpdateEvent,
  type WeaponId, PLAYER_NETWORK_INPUT_LIMITS, EVENTS, MatchPhase,
} from "@buildshift/protocol";
import {
  stepPlayerMovement, movementInputToWorld, fireGate, hitscan,
  type PlayerMovementState, type PlayerMovementConfig, type Vec3,
  type HitscanTarget,
} from "@buildshift/simulation";
import {
  PLAYER_MOVEMENT, VERTICAL_MOVEMENT, ASSAULT_RIFLE, MAX_HEALTH, MAX_SHIELD,
  ROUNDS_TO_WIN, ROUND_COUNTDOWN_SECONDS, ROUND_RESET_DELAY_SECONDS,
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

const COUNTDOWN_TICKS = Math.max(1, Math.round(ROUND_COUNTDOWN_SECONDS * TICK_RATE_HZ));
const RESET_DELAY_TICKS = Math.max(1, Math.round(ROUND_RESET_DELAY_SECONDS * TICK_RATE_HZ));

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
  private phaseTicksLeft = 0;

  onCreate():void{
    console.log(`${LOG} room created (roomId=${this.roomId})`);
    this.onMessage(TWO_PLAYER_MOVEMENT_INPUT,(c,m)=>{this.handleInput(c,m);});
    this.state.matchPhase = MatchPhase.IN_PROGRESS;
    this.state.currentRound = 1;
    this.phaseTicksLeft = 0;
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
    const score=new RoundScoreSchema();
    score.value=0;
    this.state.roundScore.set(client.sessionId,score);
    console.log(`${LOG} joined (sid=${client.sessionId}, slot=${si}, clients=${this.clients.length})`);
  }

  onLeave(client:Client,code?:number):void{
    this.state.players.delete(client.sessionId);
    this.state.roundScore.delete(client.sessionId);
    this.inputBuf.delete(client.sessionId);
    this.spawnSlots.delete(client.sessionId);
    console.log(`${LOG} left (sid=${client.sessionId}, code=${code??"n/a"})`);
  }

  onDispose():void{
    this.inputBuf.clear();this.spawnSlots.clear();
    console.log(`${LOG} disposed (roomId=${this.roomId})`);
  }

  private handleInput(client:Client,msg:unknown):void{
    const inp=parseInput(msg);
    if(!inp){console.warn(`${LOG} bad input from ${client.sessionId}`);return;}
    this.inputBuf.set(client.sessionId,inp);
  }

  private tick():void{
    const phase=this.state.matchPhase as MatchPhase;
    if(phase===MatchPhase.COUNTDOWN){
      if(this.phaseTicksLeft>0){
        this.phaseTicksLeft--;
        if(this.phaseTicksLeft===0){this.beginRound();}
      }
      return;
    }
    if(phase===MatchPhase.ROUND_ENDED){
      if(this.phaseTicksLeft>0){
        this.phaseTicksLeft--;
        if(this.phaseTicksLeft===0){this.beginCountdown();}
      }
      return;
    }
    if(phase!==MatchPhase.IN_PROGRESS){
      return;
    }
    for(const[sid,p]of this.state.players){
      if(p.isEliminated){
        this.inputBuf.delete(sid);
        continue;
      }
      if(this.state.matchPhase!==MatchPhase.IN_PROGRESS){
        this.inputBuf.delete(sid);
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

  private beginCountdown():void{
    this.resetPlayers();
    this.inputBuf.clear();
    this.state.matchPhase=MatchPhase.COUNTDOWN;
    this.phaseTicksLeft=COUNTDOWN_TICKS;
    console.log(`${LOG} countdown started (next round in ${ROUND_COUNTDOWN_SECONDS}s)`);
  }

  private beginRound():void{
    this.inputBuf.clear();
    this.state.currentRound+=1;
    this.state.matchPhase=MatchPhase.IN_PROGRESS;
    this.phaseTicksLeft=0;
    console.log(`${LOG} round ${this.state.currentRound} started`);
  }

  private resetPlayers():void{
    for(const[sid,p]of this.state.players){
      const sl=this.spawnSlots.get(sid)??0;
      const sp=SPAWNS[sl];
      p.x=sp.x;p.y=sp.y;p.z=sp.z;p.yaw=0;p.velocityY=0;p.grounded=true;
      p.health=MAX_HEALTH;p.shield=MAX_SHIELD;p.ammo=WEAPON.maxAmmo;
      p.lastFireSequence=-1;p.alive=true;p.isEliminated=false;
    }
    console.log(`${LOG} players reset between rounds`);
  }

  private endRound(winnerId:string,loserId:string):void{
    if(this.state.matchPhase!==MatchPhase.IN_PROGRESS)return;
    const winnerScore=this.state.roundScore.get(winnerId);
    if(winnerScore!==undefined){
      winnerScore.value+=1;
    }else{
      const s=new RoundScoreSchema();
      s.value=1;
      this.state.roundScore.set(winnerId,s);
    }
    const wins=this.state.roundScore.get(winnerId)?.value??0;
    this.state.lastRoundResult.winnerId=winnerId;
    this.state.lastRoundResult.roundNumber=this.state.currentRound;
    this.inputBuf.clear();
    if(wins>=ROUNDS_TO_WIN){
      this.state.matchPhase=MatchPhase.MATCH_ENDED;
      this.phaseTicksLeft=0;
      console.log(`${LOG} MATCH ENDED: ${winnerId} reached ${wins}/${ROUNDS_TO_WIN} round wins`);
      return;
    }
    this.state.matchPhase=MatchPhase.ROUND_ENDED;
    this.phaseTicksLeft=RESET_DELAY_TICKS;
    console.log(`${LOG} round ${this.state.currentRound} ended: ${winnerId} beat ${loserId} (${wins}/${ROUNDS_TO_WIN})`);
  }

  private resolveFire(sid:string,sh:PE,yaw:number,pitch:number):void{
    const gate=fireGate({
      lastFireSequence:sh.lastFireSequence,
      currentSequence:sh.lastProcessedSequence,
      fireIntervalTicks:WEAPON.fireIntervalTicks,
      isEliminated:sh.isEliminated,
      ammo:sh.ammo,
    });
    if(!gate.approved){
      const ev:FireRejectedEvent={shooterId:sid,reason:gate.reason};
      this.broadcast(EVENTS.FIRE_REJECTED,ev);
      console.log(`${LOG} fire rejected: ${sid} (${gate.reason})`);
      return;
    }
    sh.ammo--;
    sh.lastFireSequence=sh.lastProcessedSequence;
    const origin:Vec3={x:sh.x,y:sh.y+EYE_H,z:sh.z};
    const dir=aimDir(yaw,pitch);
    const targets:HitscanTarget[]=[];
    for(const[tid,tp]of this.state.players){
      if(tid===sid||tp.isEliminated)continue;
      targets.push({id:tid,position:{x:tp.x,y:tp.y+EYE_H,z:tp.z}});
    }
    const hits=hitscan(origin,dir,{damage:WEAPON.damage,range:WEAPON.range,targetRadius:TARGET_R},targets);
    if(hits.length===0){
      console.log(`${LOG} shot fired (miss): ${sid}`);
      return;
    }
    for(const hit of hits){
      const tp=this.state.players.get(hit.targetId);
      if(tp===undefined)continue;
      let rem=hit.damage;
      if(tp.shield>0){
        const absorbed=Math.min(tp.shield,rem);
        tp.shield-=absorbed;
        rem-=absorbed;
      }
      if(rem>0){
        tp.health=Math.max(0,tp.health-rem);
      }
      const hitEv:HitResultEvent={shooterId:sid,targetId:hit.targetId,damage:hit.damage,hitPoint:hit.hitPoint,weaponId:WEAPON_ID};
      this.broadcast(EVENTS.HIT,hitEv);
      if(tp.health<=0){
        tp.health=0;
        tp.alive=false;
        tp.isEliminated=true;
        const elimEv:PlayerEliminatedEvent={eliminatedId:hit.targetId,eliminatedById:sid};
        this.broadcast(EVENTS.ELIMINATED,elimEv);
        this.endRound(sid,hit.targetId);
      }
      const huEv:HealthUpdateEvent={playerId:hit.targetId,health:tp.health,shield:tp.shield,alive:tp.alive,isEliminated:tp.isEliminated};
      this.broadcast(EVENTS.HEALTH_UPDATE,huEv);
    }
  }
}
