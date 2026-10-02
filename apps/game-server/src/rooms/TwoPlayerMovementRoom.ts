/**
 * Stage 2D — canonical authoritative two-player Colyseus room with
 * deterministic movement AND server-authoritative hitscan combat.
 * The SINGLE authoritative gameplay loop: movement, prediction, reconciliation,
 * interpolation and combat all share this tick-driven path at 30 Hz.
 *
 * The fire-intent path is a thin orchestration over the shared, pure
 * simulation math (see `docs/TECHNICAL_ARCHITECTURE.md` §3.4 and §7.4):
 *
 *   receive intent
 *     → validate via the simulation `fireGate` (cooldown / alive / ammo);
 *         on rejection, broadcast `FIRE_REJECTED` and stop;
 *     → resolve the hit via the simulation `hitscan` (ray vs. every target's
 *         collision sphere, first-hit wins);
 *     → mutate authoritative state (shield absorbs first, then health;
 *       if health reaches 0, mark eliminated);
 *     → broadcast `HIT` + `HEALTH_UPDATE` (and `ELIMINATED` when health hits 0);
 *     → record the fire sequence so the next `fireGate` call respects the
 *         weapon cooldown.
 *
 * The room performs no damage / range math inline — all of that lives in
 * `@buildshift/simulation` so the client can predict against the same rules.
 */
import { Room, type Client } from "@colyseus/core";
import {
  RoomStateSchema, PlayerStateSchema,
  type RoomStateSchemaInstance, type PlayerNetworkInput,
  type HitPoint, type HitResultEvent, type PlayerEliminatedEvent,
  type FireRejectedEvent, type HealthUpdateEvent,
  type WeaponId, PLAYER_NETWORK_INPUT_LIMITS, EVENTS,
} from "@buildshift/protocol";
import {
  stepPlayerMovement, movementInputToWorld, fireGate, hitscan,
  type PlayerMovementState, type PlayerMovementConfig, type Vec3,
  type HitscanTarget,
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

  /**
   * Authoritatively resolve one fire intent.
   *
   * Orchestrates the shared simulation combat math (the room owns only the
   * state mutation + event broadcast):
   *   1. validate via {@link fireGate}; on rejection broadcast
   *      `FIRE_REJECTED` and return;
   *   2. spend a round + record the fire sequence (drives the cooldown);
   *   3. resolve the hit via {@link hitscan} (first target in range wins);
   *   4. apply damage (shield absorbs first, then health);
   *   5. if health reaches 0, mutate the elimination state
   *      (isEliminated = true, alive = false) so the subsequent
   *      `HEALTH_UPDATE` event carries the final authoritative values;
   *   6. broadcast `HIT` + `HEALTH_UPDATE`; on elimination also broadcast
   *      `ELIMINATED` and arm the respawn timer.
   */
  private resolveFire(sid:string,sh:PE,yaw:number,pitch:number):void{
    // 1. Authoritatively validate the fire request via the shared fire gate.
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

    // 2. Gate approved — spend a round and record the fire sequence so the
    //    next fireGate call respects the weapon cooldown.
    sh.ammo--;
    sh.lastFireSequence=sh.lastProcessedSequence;

    // 3. Resolve the hit via the shared multi-target hitscan resolver. The
    //    shooter aims from eye height; every live, non-shooter target is an
    //    aimable sphere at its own eye height.
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

    // 4. Apply damage to each hit target — shield absorbs first, overflow to
    //    health (docs/TECHNICAL_ARCHITECTURE.md §3.4).
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

      // 5. Elimination state mutation: if health reached 0, flip the
      //    elimination flags BEFORE broadcasting events so that the
      //    HEALTH_UPDATE event carries the correct final state.
      let eliminated=false;
      if(tp.health<=0){
        tp.health=0;
        tp.isEliminated=true;
        tp.alive=false;
        eliminated=true;
        this.respawnT.set(hit.targetId,RESPAWN_TICKS);
        console.log(`${LOG} eliminated: ${hit.targetId} by ${sid}`);
      }

      // 6. Broadcast events reflecting the authoritative state after mutation.
      const hp:HitPoint={x:hit.hitPoint.x,y:hit.hitPoint.y,z:hit.hitPoint.z};
      const hitEvent:HitResultEvent={shooterId:sid,targetId:hit.targetId,damage:hit.damage,hitPoint:hp,weaponId:WEAPON_ID};
      this.broadcast(EVENTS.HIT,hitEvent);

      // Health-update event reflecting the new authoritative combat values
      // (including the elimination state if health reached 0).
      const healthEvent:HealthUpdateEvent={playerId:hit.targetId,health:tp.health,shield:tp.shield,alive:tp.alive,isEliminated:tp.isEliminated};
      this.broadcast(EVENTS.HEALTH_UPDATE,healthEvent);

      if(eliminated){
        const ev:PlayerEliminatedEvent={eliminatedId:hit.targetId,eliminatedById:sid};
        this.broadcast(EVENTS.ELIMINATED,ev);
      }
      console.log(`${LOG} hit: ${sid}->${hit.targetId} dmg=${hit.damage} dist=${hit.distance.toFixed(1)}`);
    }
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
