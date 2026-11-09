import { Box3, MathUtils, Quaternion, Vector3 } from 'three';

// 普通跳、进窝跳、出窝跳共用；只改变姿态，不控制路径或碰撞。
export const CHARGE_SECONDS = 0.18; // 蓄力时长（秒）
export const LAND_SECONDS = 0.25; // 落地压扁、过冲、回正总时长（秒）
export const CHARGE_SCALE = [1.08, 0.85, 1.08]; // 脚底为支点的蓄力缩放
export const LAND_SCALE = [1.06, 0.88, 1.06]; // 落地最大压扁
export const LAND_OVERSHOOT = 1.04; // 回弹最高 Y 缩放
export const LAND_COMPRESS_SECONDS = 0.045; // 接地到最大压扁
export const LAND_OVERSHOOT_SECONDS = 0.14; // 接地到回弹最高点
export const RISE_PITCH_DEGREES = 10; // 上升时身体前端上仰
export const FALL_PITCH_DEGREES = 8; // 下降时身体前端下俯
export const CHARGE_HEAD_DEGREES = 7; // 蓄力低头角度，局部 Z
export const AIR_HEAD_DEGREES = 5; // 空中抬头 / 低头幅度
export const TAIL_DEGREES = 16; // 起跳下甩、扬起和落地续甩幅度
export const EAR_DEGREES = 5; // 耳朵惯性摆动幅度
export const HEAD_DELAY_SECONDS = 0.08; // 头部指数插值时间常数
export const EAR_DELAY_SECONDS = 0.10; // 耳朵指数插值时间常数
export const TAIL_DELAY_SECONDS = 0.12; // 尾部指数插值时间常数
export const RISE_STRETCH = 0.10; // 最大上升速度对应的拉伸量
export const FALL_STRETCH = 0.06; // 最大下降速度对应的拉伸量
export const RELEASE_SECONDS = 0.07; // 离地时从压低平滑伸展
export const CONTACT_EASE_SECONDS = 0.06; // 接地前回到正常缩放、俯仰
export const LEG_BLEND_START = 0.32; // 从伸展向收拢混合的腾空时间比例
export const LEG_BLEND_END = 0.68; // 收拢混合结束比例
export const POSE_SAMPLES = 240; // 一个行走周期的选帧采样数
const FORWARD = new Vector3(-0.7, 0, 0.714).normalize();
const PITCH_AXIS = new Vector3().crossVectors(FORWARD, new Vector3(0,1,0)).normalize();
const X = new Vector3(1,0,0), Y = new Vector3(0,1,0), Z = new Vector3(0,0,1);
const smooth = (v,a,b) => MathUtils.smoothstep(v,a,b);
const snapshot = object => ({ object, p:object.position.clone(), q:object.quaternion.clone(), s:object.scale.clone() });
const copy = p => { p.object.position.copy(p.p); p.object.quaternion.copy(p.q); p.object.scale.copy(p.s); };

export function createJumpPose({ model, clips, root, spawnScale, spawnPosition, poses }) {
  const clip = clips.find(c=>c.name==='preset:quadruped:walk');
  if(!clip) throw new Error('跳跃选帧需要 preset:quadruped:walk');
  const original = poses.map(p=>snapshot(p.object));
  const legs = original.filter(p=>/Limb_/.test(p.object.name));
  const feet = ['tripo0_Left_Limb_3','tripo0_Right_Limb_3','tripo1_Left_Limb_4','tripo1_Right_Limb_4'].map(n=>model.getObjectByName(n));
  const hips = ['tripo0_Left_Limb_0','tripo0_Right_Limb_0','tripo1_Left_Limb_0','tripo1_Right_Limb_0'].map(n=>model.getObjectByName(n));
  if(feet.some(b=>!b)||hips.some(b=>!b))throw new Error('跳跃选帧缺少已验证的脚 / 腿根骨骼');
  const tracks = clip.tracks.map(track=>{const i=track.name.lastIndexOf('.');return {object:model.getObjectByName(track.name.slice(0,i)),property:track.name.slice(i+1),sample:track.createInterpolant()};});
  const center = new Vector3(), v = new Vector3();
  function localPoint(b) { return model.worldToLocal(b.getWorldPosition(new Vector3())); }
  model.updateWorldMatrix(true,true);
  const pivot = hips.reduce((c,b)=>c.add(localPoint(b)),new Vector3()).multiplyScalar(0.25);
  let extension=-Infinity, compact=Infinity, extendedTime=0, tuckedTime=0, extended, tucked;
  // 四条腿只从同一时刻的原预设取姿势；不拼接不同帧，不手写关节角度。
  for(let i=0;i<POSE_SAMPLES;i++) {
    const t=i/POSE_SAMPLES*clip.duration;
    original.forEach(copy);
    for(const tr of tracks)tr.object[tr.property].fromArray(tr.sample.evaluate(t));
    model.updateWorldMatrix(true,true);
    center.set(0,0,0);hips.forEach(b=>center.add(localPoint(b)));center.multiplyScalar(.25);
    const points=feet.map(localPoint);
    const spread=(points[0].dot(FORWARD)+points[1].dot(FORWARD)-points[2].dot(FORWARD)-points[3].dot(FORWARD))*.5;
    const tuck=points.reduce((sum,p)=>sum+p.distanceToSquared(center),0);
    if(spread>extension){extension=spread;extendedTime=t;extended=legs.map(p=>snapshot(p.object));}
    if(tuck<compact){compact=tuck;tuckedTime=t;tucked=legs.map(p=>snapshot(p.object));}
  }
  original.forEach(copy);model.updateWorldMatrix(true,true);
  console.table([{姿态:'伸展：前脚均值最前、后脚均值最后',动画:clip.name,时间秒:extendedTime,评分:extension},
    {姿态:'收拢：四脚到身体中心距离平方和最小',动画:clip.name,时间秒:tuckedTime,评分:compact}]);
  const initial=legs.map(p=>snapshot(p.object));
  const bounds=new Box3(), q=new Quaternion(), pivotBefore=new Vector3(), pivotAfter=new Vector3();
  const followers={head:0,ear:0,tail:0};
  const nodes=new Map(original.map(p=>[p.object.name,p.object]));
  let state={pitch:0,scaleY:1,legBlend:0,extendedTime,tuckedTime};
  function begin(){legs.forEach((p,i)=>{initial[i]=snapshot(p.object);});Object.keys(followers).forEach(k=>followers[k]=0);}
  function mix(a,b,u){legs.forEach((p,i)=>{p.object.position.copy(a[i].p).lerp(b[i].p,u);p.object.quaternion.copy(a[i].q).slerp(b[i].q,u);p.object.scale.copy(a[i].s).lerp(b[i].s,u);});}
  function add(name,axis,degrees){const bone=nodes.get(name);if(bone)bone.quaternion.multiply(q.setFromAxisAngle(axis,MathUtils.degToRad(degrees)));}
  function apply({phase,time,duration,velocity=0,speed=1,height,dt}) {
    let sy=1,sxz=1,pitch=0,head=0,tail=0,ear=0,legBlend=0,recovery=0;
    if(phase==='charge'){
      const u=smooth(time,0,CHARGE_SECONDS);mix(initial,extended,u);
      sy=MathUtils.lerp(1,CHARGE_SCALE[1],u);sxz=MathUtils.lerp(1,CHARGE_SCALE[0],u);
      head=CHARGE_HEAD_DEGREES*u;tail=-TAIL_DEGREES*u;ear=EAR_DEGREES*u;
    } else if(phase==='air'){
      const u=MathUtils.clamp(time/duration,0,1),release=smooth(time,0,RELEASE_SECONDS),contact=1-smooth(time,duration-CONTACT_EASE_SECONDS,duration);
      legBlend=smooth(u,LEG_BLEND_START,LEG_BLEND_END);mix(extended,tucked,legBlend);
      const relative=MathUtils.clamp(velocity/Math.max(.001,speed),-1,1);
      sy=MathUtils.lerp(CHARGE_SCALE[1],1+Math.abs(relative)*(velocity>=0?RISE_STRETCH:FALL_STRETCH)*contact,release);
      sxz=MathUtils.lerp(CHARGE_SCALE[0],1/Math.sqrt(sy),release);
      // 用垂直速度符号和归一化速度，在真正的最高点回平（进出窝两端高度不同）。
      pitch=(relative>=0 ? RISE_PITCH_DEGREES*smooth(relative,0,1) : -FALL_PITCH_DEGREES*smooth(-relative,0,1))*release*contact;
      head=-AIR_HEAD_DEGREES*relative*release*contact;
      tail=MathUtils.lerp(-TAIL_DEGREES,TAIL_DEGREES*relative,release);ear=-EAR_DEGREES*relative;
    } else {
      recovery=smooth(time,0,LAND_SECONDS);
      const base=legs.map(p=>snapshot(p.object));mix(tucked,base,recovery);
      if(time<LAND_COMPRESS_SECONDS)sy=MathUtils.lerp(1,LAND_SCALE[1],smooth(time,0,LAND_COMPRESS_SECONDS));
      else if(time<LAND_OVERSHOOT_SECONDS)sy=MathUtils.lerp(LAND_SCALE[1],LAND_OVERSHOOT,smooth(time,LAND_COMPRESS_SECONDS,LAND_OVERSHOOT_SECONDS));
      else sy=MathUtils.lerp(LAND_OVERSHOOT,1,smooth(time,LAND_OVERSHOOT_SECONDS,LAND_SECONDS));
      sxz=1/Math.sqrt(sy);head=CHARGE_HEAD_DEGREES*Math.sin(Math.PI*recovery);tail=-TAIL_DEGREES*(1-recovery);ear=EAR_DEGREES*(1-recovery);
    }
    // 连续指数延迟，不在空中/落地阶段切换时清零，带出余摆；末端柔和交回原动画。
    for(const [key,target,tau] of [['head',head,HEAD_DELAY_SECONDS],['ear',ear,EAR_DELAY_SECONDS],['tail',tail,TAIL_DELAY_SECONDS]])followers[key]+=(target-followers[key])*(1-Math.exp(-dt/tau));
    const fade=1-recovery;
    add('tripoHead_1',Z,followers.head*fade);
    add('bone_18',Y,followers.ear*fade);add('tripoHead_2',Y,-followers.ear*fade);
    ['bone_39','bone_40','bone_41','bone_42'].forEach((n,i)=>add(n,X,followers.tail*fade*(.3+i*.16)));
    // 模型绕身体中心俯仰；不旋转控制器根节点，因此朝向、身体碰撞圆和移动路线不变。
    pivotBefore.copy(pivot).multiply(model.scale).applyQuaternion(model.quaternion).add(model.position);
    model.quaternion.premultiply(q.setFromAxisAngle(PITCH_AXIS,MathUtils.degToRad(pitch)));
    pivotAfter.copy(pivot).multiply(model.scale).applyQuaternion(model.quaternion).add(model.position);
    model.position.add(v.subVectors(pivotBefore,pivotAfter));
    root.scale.copy(spawnScale).multiply(new Vector3(sxz,sy,sxz));root.position.y=spawnPosition.y;
    root.updateMatrixWorld(true);bounds.setFromObject(root,true);root.position.y+=height-bounds.min.y;root.updateMatrixWorld(true);
    state={pitch,scaleY:sy,legBlend,extendedTime,tuckedTime};
  }
  return {begin,apply,reset(){Object.keys(followers).forEach(k=>followers[k]=0);},get state(){return state;}};
}
