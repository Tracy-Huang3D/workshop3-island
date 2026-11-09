import { Box3, MathUtils, Quaternion, Vector3 } from 'three';
import { CHARGE_SECONDS, LAND_SECONDS } from './yaya-jump-pose.js';
import { BODY_RADIUS } from './island-collision.js';

// Step 07：距离为场景单位，角度为度，时长为秒。腿部始终保持原姿态，不折腿。
export const REST_SINK_MULTIPLIER = 1; // 下沉深度 = 实测脚底到肚子 × 此倍率
export const REST_HEAD_DEGREES = 15; // 头部局部 Z 低头
export const REST_EAR_DEGREES = 8; // 两侧耳朵局部 Y 放松
export const REST_TAIL_DEGREES = [12, 22, 30, 38]; // 尾链局部 Y 卷向身体侧面，越到尾尖越大
export const REST_BREATH = 0.008; // 呼吸上下幅度
export const REST_BREATH_SECONDS = 3; // 呼吸周期
export const REST_LIE_SECONDS = 1; // 趴下时长
export const REST_RISE_SECONDS = 0.6; // 起来时长
export const REST_TURN_SECONDS = 0.45; // 自动转向时长
export const REST_APPROACH_SECONDS = 0.6; // 走到窝边
export const REST_CHARGE_SECONDS = CHARGE_SECONDS; // 蓄力
export const REST_FLIGHT_SECONDS = 0.9; // 进出窝腾空时长
export const REST_LAND_SECONDS = LAND_SECONDS; // 落地回弹
export const REST_JUMP_CLEARANCE = 0.38; // 超过最高窝边的高度余量
export const REST_PROMPT_DISTANCE = 0.65; // 身体圆到窝阻挡圆边缘的提示距离
const UP = new Vector3(0, 1, 0), X = new Vector3(1, 0, 0), Z = new Vector3(0, 0, 1);
const FORWARD_YAW = Math.atan2(-0.7, 0.714);
const directions = { KeyW:[0,1], ArrowUp:[0,1], KeyS:[0,-1], ArrowDown:[0,-1], KeyA:[-1,0], ArrowLeft:[-1,0], KeyD:[1,0], ArrowRight:[1,0] };

export function createNestRest({root, model, camera, controls, collisionWorld: world, groundY, spawnPosition, spawnScale, poses, restore, sampleIdle, sampleWalk, getBodyCenter, clearKeys, documentTarget: doc, jumpPose, canUseNest=()=>true}) {
  let nest, phase = 'none', time = 0, clock = 0, allowed = false, outgoing = false;
  const from = new Vector3(), to = new Vector3(), direction = new Vector3(), body = new Vector3();
  const turnFrom = new Quaternion(), turnTo = new Quaternion(), dq = new Quaternion();
  let fromY = groundY, toY = groundY, apex = 0;
  const saved = poses.map(p=>({p:p.p.clone(),q:p.q.clone(),s:p.s.clone()}));
  const bones = new Map(poses.map(p=>[p.object.name,p]));
  const bounds = new Box3();
  const prompt = doc.createElement?.('div'), card = doc.createElement?.('section');
  if(prompt) {
    prompt.id='rest-prompt'; prompt.setAttribute('role','status'); prompt.hidden=true;
    prompt.textContent='按 E 进窝休息'; doc.body.append(prompt);
    card.id='rest-card'; card.hidden=true; card.setAttribute('role','dialog'); card.setAttribute('aria-label','芽芽的家');
    card.innerHTML='<button type="button" aria-label="关闭芽芽的家">×</button><h2>芽芽的家</h2><p>芽芽把捡来的柔软苔藓铺成了小床。风经过树梢时，这里总能睡一个暖暖的午觉。</p><small>按 WASD、空格或 E 起来 · Esc 关闭卡片</small>';
    card.querySelector('button').onclick=()=>{card.hidden=true;}; doc.body.append(card);
  }
  function begin(p) { if(p==='charge')jumpPose.begin(); phase=p; time=0; }
  function capture(){poses.forEach((p,i)=>{saved[i].p.copy(p.object.position);saved[i].q.copy(p.object.quaternion);saved[i].s.copy(p.object.scale);});}
  function blendSaved(u){poses.forEach((p,i)=>{p.object.position.lerp(saved[i].p,1-u);p.object.quaternion.slerp(saved[i].q,1-u);p.object.scale.lerp(saved[i].s,1-u);});}
  function rotate(name,axis,angle){const p=bones.get(name);if(p)p.object.quaternion.copy(p.q).multiply(dq.setFromAxisAngle(axis,MathUtils.degToRad(angle)));}
  function bodyAt(target){getBodyCenter(body);root.position.x+=target.x-body.x;root.position.z+=target.z-body.z;}
  function supported(y,sy=1,sxz=1){root.scale.copy(spawnScale).multiply(new Vector3(sxz,sy,sxz));root.position.y=spawnPosition.y;root.updateMatrixWorld(true);bounds.setFromObject(root,true);root.position.y+=y-bounds.min.y;}
  function restingPose(u){
    restore(); rotate('tripoHead_1',Z,REST_HEAD_DEGREES*u);
    ['bone_18','tripoHead_2'].forEach((n,i)=>rotate(n,UP,REST_EAR_DEGREES*u*(i?-1:1)));
    ['bone_39','bone_40','bone_41','bone_42'].forEach((n,i)=>rotate(n,UP,REST_TAIL_DEGREES[i]*u+(i===3?Math.sin(clock*5)*Math.max(0,Math.sin(clock*Math.PI/5))**12*1.2*u:0)));
    const breath=REST_BREATH*Math.sin(clock*Math.PI*2/REST_BREATH_SECONDS)*u;
    supported(nest.mossY-nest.actor.legHeight*REST_SINK_MULTIPLIER*u+breath);
  }
  function aim(dir){turnFrom.copy(root.quaternion);turnTo.setFromAxisAngle(UP,Math.atan2(dir.x,dir.z)-FORWARD_YAW);}
  function refreshPrompt(grounded){
    allowed=false;
    if(phase!=='none') return;
    if(prompt)prompt.textContent='按 E 进窝休息';
    if(nest && phase==='none' && grounded && canUseNest()){getBodyCenter(body);const o=world.obstacles.find(o=>o.key==='nest');allowed=Math.hypot(body.x-o.x,body.z-o.z)<=o.radius+BODY_RADIUS+REST_PROMPT_DISTANCE;}
    if(prompt) prompt.hidden=!allowed;
  }
  function chooseExit(code){
    camera.getWorldDirection(direction);direction.y=0;direction.normalize();
    const pair=directions[code];if(pair){const right=new Vector3().crossVectors(direction,UP);direction.multiplyScalar(pair[1]).addScaledVector(right,pair[0]).normalize();}
    else direction.negate(); // 无方向按键时朝镜头跳出。
    const o=world.obstacles.find(o=>o.key==='nest');
    const distance=o.radius+BODY_RADIUS+0.22;
    getBodyCenter(from);to.copy(from).addScaledVector(direction,distance);
    // 目标和整条路径必须避开其它物件；只允许忽略窝，不静默穿过树等物件。
    for(let i=1;i<=40;i++){const p=from.clone().lerp(to,i/40);if(!world.valid(p,'nest'))return false;}
    if(!world.valid(to))return false;
    aim(direction);return true;
  }
  function keydown(e){
    if(e.code==='Escape'){if(card)card.hidden=true;return false;}
    if(phase!=='none'){
      if(directions[e.code] || e.code==='Space' || e.code==='KeyE')e.preventDefault();
      if(phase==='rest' && !e.repeat && (directions[e.code] || e.code==='Space' || e.code==='KeyE')){
        if(!chooseExit(e.code)){if(prompt){prompt.textContent='这个方向有物件，请换个方向出窝';prompt.hidden=false;}return true;}
        outgoing=true;if(card)card.hidden=true;capture();begin('rise');
      }
      return e.code!=='KeyB';
    }
    if(e.code==='KeyE' && !e.repeat && allowed && canUseNest()){
      e.preventDefault();getBodyCenter(from);
      const center=new Vector3(nest.placement.x,0,nest.placement.z);
      for(let i=0;i<=40;i++) if(!world.valid(from.clone().lerp(center,i/40),'nest')) return true;
      clearKeys();outgoing=false;capture();
      direction.set(nest.placement.x-from.x,0,nest.placement.z-from.z).normalize();aim(direction);
      const o=world.obstacles.find(o=>o.key==='nest');
      to.set(o.x,0,o.z).addScaledVector(direction,-o.radius-BODY_RADIUS-0.06);begin('turn');return true;
    }
    return false;
  }
  function startFlight(){getBodyCenter(from);fromY=outgoing?nest.mossY:groundY;toY=outgoing?groundY:nest.mossY;
    if(!outgoing)to.set(nest.placement.x,0,nest.placement.z);
    apex=nest.rimY+REST_JUMP_CLEARANCE-Math.min(fromY,toY);begin('flight');}
  function update(dt){
    clock+=dt;time+=dt;const old=root.position.clone();
    if(prompt && phase!=='rest')prompt.hidden=true;
    if(phase==='turn'){
      const u=MathUtils.smoothstep(time,0,REST_TURN_SECONDS);restore();sampleIdle(clock);blendSaved(u);root.quaternion.slerpQuaternions(turnFrom,turnTo,u);bodyAt(from);supported(groundY);
      if(time>=REST_TURN_SECONDS){getBodyCenter(from);begin('approach');}
    } else if(phase==='approach'){
      restore();sampleWalk(time);blendSaved(MathUtils.smoothstep(time,0,.3));
      getBodyCenter(body);const target=from.clone().lerp(to,Math.min(1,time/REST_APPROACH_SECONDS));const p=world.move(body,target.sub(body));bodyAt(p);supported(groundY);
      if(time>=REST_APPROACH_SECONDS){getBodyCenter(body);if(Math.hypot(body.x-to.x,body.z-to.z)>.12){reset();return;}capture();begin('charge');}
    } else if(phase==='charge'){
      restore();jumpPose.apply({phase:'charge',time,duration:REST_FLIGHT_SECONDS,height:outgoing?nest.mossY:groundY,dt});
      if(time>=REST_CHARGE_SECONDS)startFlight();
    } else if(phase==='flight'){
      const u=Math.min(1,time/REST_FLIGHT_SECONDS);restore();getBodyCenter(body);
      const target=from.clone().lerp(to,u),p=world.move(body,target.sub(body),'nest');bodyAt(p);
      jumpPose.apply({phase:'air',time:u*REST_FLIGHT_SECONDS,duration:REST_FLIGHT_SECONDS,velocity:(toY-fromY+4*apex*(1-2*u))/REST_FLIGHT_SECONDS,speed:(4*apex+Math.abs(toY-fromY))/REST_FLIGHT_SECONDS,height:MathUtils.lerp(fromY,toY,u)+4*apex*u*(1-u),dt});
      if(u===1){begin('land');}
    } else if(phase==='land'){
      restore();jumpPose.apply({phase:'land',time,duration:REST_FLIGHT_SECONDS,height:toY,dt});
      if(time>=REST_LAND_SECONDS){if(outgoing){begin('none');clearKeys();root.scale.copy(spawnScale);root.position.y=spawnPosition.y;}else{clock=0;begin('lie');if(card)card.hidden=false;}}
    } else if(phase==='lie'){
      restingPose(MathUtils.smoothstep(time,0,REST_LIE_SECONDS));if(time>=REST_LIE_SECONDS)begin('rest');
    } else if(phase==='rest')restingPose(1);
    else if(phase==='rise'){
      const u=MathUtils.smoothstep(time,0,REST_RISE_SECONDS);restingPose(1-u);if(time>=REST_RISE_SECONDS){getBodyCenter(from);begin('exit-turn');}
    } else if(phase==='exit-turn'){
      restore();const u=MathUtils.smoothstep(time,0,REST_TURN_SECONDS);root.quaternion.slerpQuaternions(turnFrom,turnTo,u);bodyAt(from);supported(nest.mossY);
      if(time>=REST_TURN_SECONDS){capture();begin('charge');}
    }
    const shift=root.position.clone().sub(old);shift.y=0;camera.position.add(shift);controls.target.add(shift);
  }
  function reset(){phase='none';time=clock=0;allowed=false;outgoing=false;clearKeys();if(prompt){prompt.hidden=true;prompt.textContent='按 E 进窝休息';}if(card)card.hidden=true;}
  return {get active(){return phase!=='none';},get phase(){return phase;},setNest(n){nest=n;},refreshPrompt,keydown,update,reset,dispose(){prompt?.remove();card?.remove();}};
}
