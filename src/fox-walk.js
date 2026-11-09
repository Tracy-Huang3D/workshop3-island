import { MathUtils, Quaternion, Vector3 } from 'three';

// 可调参数：角度单位为度，时间单位为秒。
export const WALK_SPEED = 0.8; // 原动画播放速度倍率
export const FADE_IN_SECONDS = 1.5; // 从静止原姿态平滑过渡
export const HEAD_MOTION_STRENGTH = 0.25; // 保留头颈预设动作的 25%
export const TAIL_BASE_DEGREES = 1.5;
export const TAIL_TIP_DEGREES = 4;
export const TAIL_CYCLES_PER_WALK = 1; // 每个行走循环的摆动次数，整数可保持循环连续
export const TAIL_SEGMENT_PHASE = 0.3; // 相邻骨节的延迟（弧度）

// 实际绑定只有这一条明确的尾部链，不假造三条独立链。
const TAIL_CHAIN = ['bone_39', 'bone_40', 'bone_41', 'bone_42'];
const HEAD_BONES = ['tripoHead_0', 'tripoHead_1'];
const ROOT_BONE = 'tripoRoot';
const LOCAL_X = new Vector3(1, 0, 0);

export function createFoxWalk(model, clips, { fadeInSeconds = FADE_IN_SECONDS } = {}) {
  const clip = clips.find(clip => clip.name === 'preset:quadruped:walk');
  if (!clip || clip.duration <= 0) throw new Error('缺少有效的狐狸行走动画');
  const bones = new Map();
  const rest = new Map();
  model.traverse(object => {
    if (object.isBone) bones.set(object.name, object);
    rest.set(object, { position: object.position.clone(), quaternion: object.quaternion.clone(), scale: object.scale.clone() });
  });
  for (const name of [...TAIL_CHAIN, 'bone_43', ...HEAD_BONES, ROOT_BONE]) {
    if (!bones.has(name)) throw new Error(`行走动画缺少骨骼：${name}`);
  }
  // 直接采样预设轨道，随后覆盖目标骨骼；避免混合器缓存与程序化覆盖互相干扰。
  const tracks = clip.tracks.map(track => {
    const dot = track.name.lastIndexOf('.');
    const name = track.name.slice(0, dot);
    const property = track.name.slice(dot + 1);
    const target = model.getObjectByName(name);
    if (!target || !['position', 'quaternion', 'scale'].includes(property)) {
      throw new Error(`不支持的行走轨道：${track.name}`);
    }
    return { target, property, interpolant: track.createInterpolant() };
  });
  const rotation = new Quaternion();
  const animatedRotation = new Quaternion();
  const animatedPosition = new Vector3();
  const animatedScale = new Vector3();
  function restore() {
    for (const [object, pose] of rest) {
      object.position.copy(pose.position);
      object.quaternion.copy(pose.quaternion);
      object.scale.copy(pose.scale);
    }
  }
  function update(seconds) {
    const elapsed = Math.max(0, seconds);
    restore();
    // 使用绝对时间重新采样，避免上一帧的程序化动作累积到预设上。
    const clipTime = (elapsed * WALK_SPEED) % clip.duration;
    for (const track of tracks) track.target[track.property].fromArray(track.interpolant.evaluate(clipTime));
    const fade = fadeInSeconds > 0 ? MathUtils.smoothstep(elapsed, 0, fadeInSeconds) : 1;
    for (const [object, pose] of rest) {
      const strength = fade * (HEAD_BONES.includes(object.name) ? HEAD_MOTION_STRENGTH : 1);
      animatedPosition.copy(object.position);
      animatedRotation.copy(object.quaternion);
      animatedScale.copy(object.scale);
      object.position.copy(pose.position).lerp(animatedPosition, strength);
      object.quaternion.copy(pose.quaternion).slerp(animatedRotation, strength);
      object.scale.copy(pose.scale).lerp(animatedScale, strength);
    }
    // 相位来自已降速的预设采样时间，尾摆与步伐同步。
    const phase = clipTime / clip.duration * Math.PI * 2 * TAIL_CYCLES_PER_WALK;
    TAIL_CHAIN.forEach((name, index) => {
      const bone = bones.get(name), pose = rest.get(bone);
      const amplitude = MathUtils.lerp(TAIL_BASE_DEGREES, TAIL_TIP_DEGREES, index / (TAIL_CHAIN.length - 1));
      const angle = fade * MathUtils.degToRad(amplitude) * Math.sin(phase - index * TAIL_SEGMENT_PHASE);
      // 完全覆盖尾部预设的旋转、平移与缩放，回到原姿态后仅绕局部 X 轴摆动。
      bone.position.copy(pose.position);
      bone.scale.copy(pose.scale);
      bone.quaternion.copy(pose.quaternion).multiply(rotation.setFromAxisAngle(LOCAL_X, angle));
    });
    const extraTail = bones.get('bone_43'), extraPose = rest.get(extraTail);
    extraTail.position.copy(extraPose.position);
    extraTail.quaternion.copy(extraPose.quaternion);
    extraTail.scale.copy(extraPose.scale);
    // 锁定模型容器及根骨骼：不积累前进、垂直位移或方向漂移。
    for (const object of [model, bones.get(ROOT_BONE)]) {
      const pose = rest.get(object);
      object.position.copy(pose.position);
      object.quaternion.copy(pose.quaternion);
      object.scale.copy(pose.scale);
    }
  }
  update(0);
  return { update, reset: restore, dispose: restore };
}
