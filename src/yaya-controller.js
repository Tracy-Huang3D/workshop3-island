import { Box3, MathUtils, Quaternion, Vector3 } from 'three';
import { createFoxIdle } from './fox-idle.js';
import { createFoxWalk } from './fox-walk.js';
import { createNestRest } from './yaya-rest.js';
import { createJumpPose, CHARGE_SECONDS, LAND_SECONDS } from './yaya-jump-pose.js';
export { CHARGE_SECONDS, LAND_SECONDS, CHARGE_SCALE, LAND_SCALE } from './yaya-jump-pose.js';

// Step 05 调节区：距离为场景单位，时间为秒。
export const MOVE_SPEED = 0.64; // 四脚低位后扫速度中位数约 0.636（身高 2.25、预设 0.8 倍）；可按录屏微调
export const TURN_SPEED = 7; // 每秒最多转动的弧度，避免突然掉头
export const RUN_MULTIPLIER = 1.6; // 移动、步伐与尾摆共用倍率
export const BLEND_SECONDS = 0.3; // 待机 / 行走混合时间
// Step 06 第一部分：纯代码跳跃，不播放 Tripo 跳跃动画。
export const JUMP_HEIGHT = 0.6; // 最高点离地高度
export const GRAVITY = 13.3333333333; // 重力；配合高度，腾空约 0.6 秒
export const AIR_SPEED_MULTIPLIER = 0.8; // 空中水平操控速度
const TAKEOFF_SPEED = Math.sqrt(2 * GRAVITY * JUMP_HEIGHT);
const AIR_SECONDS = 2 * TAKEOFF_SPEED / GRAVITY;
const CAMERA_FOLLOW_RATE = 5; // 首次移动时环绕中心柔和靠近芽芽
const MODEL_FORWARD_YAW = Math.atan2(-0.7, 0.714); // 原模型前后脚中心方向，不假定模型正面为 +Z
const UP = new Vector3(0, 1, 0);
const MOVEMENT_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

export function createYayaController({ model, clips, root, camera, controls, eventTarget = window, documentTarget = document, collisionWorld, dayNight, lanternPlacement }) {
  // 两套动作都基于同一原姿态创建；每帧分别采样，再逐骨骼混合，不让两套动画相互覆盖。
  const idle = createFoxIdle(model);
  const walk = createFoxWalk(model, clips, { fadeInSeconds: 0 });
  walk.reset();
  const poses = [];
  model.traverse(object => poses.push({ object, p: object.position.clone(), q: object.quaternion.clone(), s: object.scale.clone(), ip: new Vector3(), iq: new Quaternion(), is: new Vector3() }));
  const spawnPosition = root.position.clone(), spawnRotation = root.quaternion.clone();
  const spawnScale = root.scale.clone();
  root.updateMatrixWorld(true);
  const groundY = new Box3().setFromObject(root, true).min.y;
  const jumpPose = createJumpPose({model, clips, root, spawnScale, spawnPosition, poses});
  let jumpPhase = 'grounded', phaseTime = 0, jumpY = 0, jumpRate = 1;
  let jumpRequested = false, jumpCount = 0;
  // 用躯干四条腿根的中心定位身体圆；尾链不参与。保存初始偏移，避免动画使碰撞圆抖动。
  const bodyBones = ['tripo0_Left_Limb_0','tripo0_Right_Limb_0','tripo1_Left_Limb_0','tripo1_Right_Limb_0'].map(name=>model.getObjectByName(name)).filter(Boolean);
  const bodyOffset = new Vector3();
  for (const bone of bodyBones) bodyOffset.add(bone.getWorldPosition(new Vector3()));
  if(bodyBones.length) root.worldToLocal(bodyOffset.divideScalar(bodyBones.length));
  const bodyCenter = new Vector3(), nextBodyCenter = new Vector3(), previousPosition = new Vector3();
  function getBodyCenter(target) { return target.copy(bodyOffset).multiply(spawnScale).applyQuaternion(root.quaternion).add(root.position); }
  const keys = new Set();
  const lanternPrompt = documentTarget.createElement?.('div');
  let lanternAllowed = false;
  if (lanternPrompt) { lanternPrompt.id = 'lantern-prompt'; lanternPrompt.setAttribute('role', 'status'); lanternPrompt.hidden = true; lanternPrompt.textContent = '按 E 点亮灯笼'; documentTarget.body.append(lanternPrompt); }
  function lanternIsCloser() {
    if (!lanternPlacement) return false;
    getBodyCenter(bodyCenter);
    const lantern = collisionWorld?.obstacles.find(o => o.key === 'lantern');
    const nest = collisionWorld?.obstacles.find(o => o.key === 'nest');
    if (!lantern) return false;
    const lanternDistance = Math.hypot(bodyCenter.x - lantern.x, bodyCenter.z - lantern.z);
    const nestDistance = nest ? Math.hypot(bodyCenter.x - nest.x, bodyCenter.z - nest.z) : Infinity;
    return lanternDistance <= nestDistance;
  }
  function refreshLanternPrompt() {
    const lantern = collisionWorld?.obstacles.find(o => o.key === 'lantern');
    if (!lantern || jumpPhase !== 'grounded' || resting?.active) { lanternAllowed = false; if (lanternPrompt) lanternPrompt.hidden = true; return; }
    getBodyCenter(bodyCenter);
    const distance = Math.hypot(bodyCenter.x - lantern.x, bodyCenter.z - lantern.z);
    const nest = collisionWorld?.obstacles.find(o => o.key === 'nest');
    const nestDistance = nest ? Math.hypot(bodyCenter.x - nest.x, bodyCenter.z - nest.z) : Infinity;
    lanternAllowed = distance <= lantern.radius + 0.28 + 0.65 && distance <= nestDistance;
    if (lanternPrompt) { lanternPrompt.textContent = dayNight?.isNight ? '按 E 熄灭灯笼' : '按 E 点亮灯笼'; lanternPrompt.hidden = !lanternAllowed; }
  }
  const forward = new Vector3(), right = new Vector3(), direction = new Vector3(), displacement = new Vector3();
  const desiredRotation = new Quaternion(), followTarget = new Vector3(), followShift = new Vector3();
  let elapsed = 0, walkTime = 0, weight = 0, moving = false, following = false;
  let transitionFrom = 0, transitionTime = BLEND_SECONDS, targetWeight = 0;
  const editable = target => target?.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target?.tagName);
  const resting = createNestRest({ root, model, camera, controls, collisionWorld, groundY, spawnPosition, spawnScale,
    poses, restore, sampleIdle: t => idle.update(t), sampleWalk: t => walk.update(t), getBodyCenter,
    clearKeys, documentTarget, jumpPose, canUseNest: () => !lanternIsCloser() });
  function keydown(event) {
    if (editable(event.target) || event.metaKey || event.ctrlKey || event.altKey) return;
    if (MOVEMENT_KEYS.has(event.code) || event.code === 'Space') event.preventDefault();
    if (event.code === 'KeyE' && !event.repeat && lanternAllowed) { event.preventDefault(); dayNight?.toggle(); return; }
    if (resting.keydown(event)) return;
    // 键盘自动重复不触发；空中请求直接丢弃，不排队到落地。
    if (event.code === 'Space' && !event.repeat && !keys.has('Space') && jumpPhase === 'grounded') jumpRequested = true;
    if(event.code === 'KeyB' && !event.repeat && !keys.has('KeyB')) collisionWorld?.toggleDebug();
    keys.add(event.code);
  }
  function keyup(event) { keys.delete(event.code); }
  function clearKeys() { keys.clear(); jumpRequested = false; }
  function visibility() { if (documentTarget.hidden) clearKeys(); }
  eventTarget.addEventListener('keydown', keydown);
  eventTarget.addEventListener('keyup', keyup);
  eventTarget.addEventListener('blur', clearKeys);
  documentTarget.addEventListener('visibilitychange', visibility);
  function restore() {
    for (const { object, p, q, s } of poses) { object.position.copy(p); object.quaternion.copy(q); object.scale.copy(s); }
  }
  function updateJump(delta, rate) {
    if (jumpRequested) {
      jumpRequested = false;
      if (jumpPhase === 'grounded') {
        jumpPhase = 'charge'; phaseTime = 0; jumpRate = rate; jumpCount++;
        jumpPose.begin();
      }
    }
    // 保留阶段交界处的剩余时间，30/60/120 帧下使用同一条抛物线。
    let remaining = delta;
    while (jumpPhase !== 'grounded' && remaining > 0) {
      const duration = jumpPhase === 'charge' ? CHARGE_SECONDS : jumpPhase === 'air' ? AIR_SECONDS : LAND_SECONDS;
      const step = Math.min(remaining, duration - phaseTime);
      phaseTime += step; remaining -= step;
      if (phaseTime >= duration - 1e-9) {
        jumpPhase = jumpPhase === 'charge' ? 'air' : jumpPhase === 'air' ? 'land' : 'grounded';
        phaseTime = 0;
      }
    }
    jumpY = jumpPhase === 'air' ? Math.max(0, TAKEOFF_SPEED * phaseTime - 0.5 * GRAVITY * phaseTime ** 2) : 0;
  }
  function applyJumpPose(delta) {
    if (jumpPhase === 'grounded') { root.scale.copy(spawnScale); root.position.y = spawnPosition.y; return; }
    jumpPose.apply({phase:jumpPhase,time:phaseTime,duration:AIR_SECONDS,
      velocity:TAKEOFF_SPEED-GRAVITY*phaseTime,speed:TAKEOFF_SPEED,height:groundY+jumpY,dt:delta});
  }
  function update(delta) {
    elapsed += delta;
    resting.refreshPrompt(jumpPhase === 'grounded');
    // 每帧都刷新灯笼提示；之前只在进窝休息分支里调用，平时走到灯笼旁不会出现提示。
    refreshLanternPrompt();
    if (resting.active) {
      moving=false; weight=targetWeight=transitionFrom=0; transitionTime=BLEND_SECONDS; jumpRequested=false;
      resting.update(delta);
      collisionWorld?.updateBody(getBodyCenter(bodyCenter));
      return;
    }
    const x = Number(keys.has('KeyD') || keys.has('ArrowRight')) - Number(keys.has('KeyA') || keys.has('ArrowLeft'));
    const z = Number(keys.has('KeyW') || keys.has('ArrowUp')) - Number(keys.has('KeyS') || keys.has('ArrowDown'));
    moving = x !== 0 || z !== 0;
    const nextWeight = moving ? 1 : 0;
    if (nextWeight !== targetWeight) { transitionFrom = weight; transitionTime = 0; targetWeight = nextWeight; }
    transitionTime += delta;
    weight = MathUtils.lerp(transitionFrom, targetWeight, MathUtils.smoothstep(transitionTime, 0, BLEND_SECONDS));
    const rate = moving && (keys.has('ShiftLeft') || keys.has('ShiftRight')) ? RUN_MULTIPLIER : 1;
    updateJump(delta, rate);
    if (jumpPhase !== 'charge' && jumpPhase !== 'air' && (moving || weight > 0)) walkTime += delta * rate;
    restore(); idle.update(elapsed);
    for (const pose of poses) { pose.ip.copy(pose.object.position); pose.iq.copy(pose.object.quaternion); pose.is.copy(pose.object.scale); }
    walk.update(walkTime);
    for (const { object, ip, iq, is } of poses) {
      object.position.lerp(ip, 1 - weight); object.quaternion.slerp(iq, 1 - weight); object.scale.lerp(is, 1 - weight);
    }
    applyJumpPose(delta);
    previousPosition.copy(root.position);
    getBodyCenter(bodyCenter);
    if (moving) {
      camera.getWorldDirection(forward); forward.y = 0; forward.normalize();
      right.crossVectors(forward, UP).normalize();
      direction.copy(forward).multiplyScalar(z).addScaledVector(right, x).normalize();
      desiredRotation.setFromAxisAngle(UP, Math.atan2(direction.x, direction.z) - MODEL_FORWARD_YAW);
      root.quaternion.rotateTowards(desiredRotation, TURN_SPEED * delta);
      // 过渡期速度随动作权重渐入；松手立即停下，剩余姿势柔和回到待机。
      const horizontalRate = jumpPhase === 'air' ? jumpRate * AIR_SPEED_MULTIPLIER : rate;
      const motionWeight = jumpPhase === 'air' ? 1 : weight;
      displacement.copy(direction).multiplyScalar(MOVE_SPEED * horizontalRate * delta * motionWeight);
      if(collisionWorld) {
        getBodyCenter(nextBodyCenter);
        // 转向时躯干中心的偏移也要参加检测，空中与地面使用相同水平约束。
        displacement.add(nextBodyCenter.sub(bodyCenter));
        const allowed=collisionWorld.move(bodyCenter,displacement);
        getBodyCenter(nextBodyCenter);
        root.position.x+=allowed.x-nextBodyCenter.x;root.position.z+=allowed.z-nextBodyCenter.z;
      } else root.position.add(displacement);
      displacement.subVectors(root.position,previousPosition);displacement.y=0;
      camera.position.add(displacement); controls.target.add(displacement);
      following = true;
    }
    collisionWorld?.updateBody(getBodyCenter(bodyCenter));
    if (following) {
      followTarget.copy(root.position); followTarget.y = controls.target.y; // 只跟水平，不随跳跃上下晃动
      followShift.subVectors(followTarget, controls.target).multiplyScalar(1 - Math.exp(-CAMERA_FOLLOW_RATE * delta));
      controls.target.add(followShift); camera.position.add(followShift);
    }
  }
  function reset() {
    resting.reset(); jumpPose.reset(); if (lanternPrompt) lanternPrompt.hidden = true; clearKeys(); jumpPhase = 'grounded'; phaseTime = jumpY = jumpCount = 0; jumpRate = 1; root.scale.copy(spawnScale);
    root.position.copy(spawnPosition); root.quaternion.copy(spawnRotation);
    elapsed = walkTime = weight = targetWeight = transitionFrom = 0;
    transitionTime = BLEND_SECONDS; moving = following = false; restore(); idle.update(0); root.updateMatrixWorld(true);
  }
  return { update, reset, setRestNest: resting.setNest, get state() { return { jumpPose: jumpPose.state, phaseTime, restPhase: resting.phase, moving, weight, walkTime, jumpPhase, jumpY, jumpRate, jumpCount, position: root.position.toArray(), keys: [...keys] }; }, dispose() {
    resting.dispose(); lanternPrompt?.remove();
    eventTarget.removeEventListener('keydown', keydown); eventTarget.removeEventListener('keyup', keyup);
    eventTarget.removeEventListener('blur', clearKeys); documentTarget.removeEventListener('visibilitychange', visibility); restore();
  } };
}
