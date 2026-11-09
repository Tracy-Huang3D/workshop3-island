import { MathUtils, Quaternion, Vector3 } from 'three';

// 调节区：角度单位为度，速度单位为每秒循环次数（Hz）。
export const TAIL_BASE_DEGREES = 1.2;
export const TAIL_TIP_DEGREES = 3.5;
export const TAIL_SPEED_HZ = 0.25;
export const TAIL_SEGMENT_PHASE = 0.35; // 相邻节的延迟，单位弧度
export const HEAD_DEGREES = 0.65;
export const HEAD_SPEED_HZ = 0.125;
export const EAR_DEGREES = 5;
export const EAR_INTERVAL_SECONDS = 8;
export const EAR_TWITCH_SECONDS = 0.5;
export const EAR_TWITCH_CYCLES = 2;
export const EAR_SIDE_DELAY_SECONDS = 0.12;
// 8 秒为公共周期：尾部 2 次、头部 1 次、耳朵 1 组；连续计算，无重置跳变。
// 当前绑定只有一条明确的尾部链，不能把它当成三条独立尾巴。
const TAIL_CHAIN = ['bone_39', 'bone_40', 'bone_41', 'bone_42'];
const EAR_CHAINS = [['bone_18', 'bone_19', 'bone_20'], ['tripoHead_2', 'tripoHead_3', 'tripoHead_4']];
const AXES = { x: new Vector3(1, 0, 0), y: new Vector3(0, 1, 0), z: new Vector3(0, 0, 1) };

export function createFoxIdle(model) {
  const bones = new Map();
  model.traverse(object => { if (object.isBone) bones.set(object.name, object); });
  const required = [...TAIL_CHAIN, 'tripoHead_1', ...EAR_CHAINS.flat()];
  const missing = required.filter(name => !bones.has(name));
  if (missing.length) throw new Error(`待机动画缺少骨骼：${missing.join(', ')}`);
  const rest = new Map(required.map(name => [name, bones.get(name).quaternion.clone()]));
  const delta = new Quaternion();
  function rotate(name, axis, degrees) {
    // 每帧从原姿态叠加局部旋转，不累积误差，不改 position 或根节点。
    bones.get(name).quaternion.copy(rest.get(name)).multiply(delta.setFromAxisAngle(AXES[axis], MathUtils.degToRad(degrees)));
  }
  function reset() { for (const [name, quaternion] of rest) bones.get(name).quaternion.copy(quaternion); }
  function update(seconds) {
    const t = Math.max(0, seconds);
    // 首次启动柔和淡入；随后使用连续周期函数，不播放模型自带走路动画。
    const fade = MathUtils.smoothstep(t, 0, 1.5);
    TAIL_CHAIN.forEach((name, index) => {
      const amplitude = MathUtils.lerp(TAIL_BASE_DEGREES, TAIL_TIP_DEGREES, index / (TAIL_CHAIN.length - 1));
      rotate(name, 'x', fade * amplitude * Math.sin(t * Math.PI * 2 * TAIL_SPEED_HZ - index * TAIL_SEGMENT_PHASE));
    });
    rotate('tripoHead_1', 'z', fade * HEAD_DEGREES * Math.sin(t * Math.PI * 2 * HEAD_SPEED_HZ));
    EAR_CHAINS.forEach((chain, side) => {
      const phase = ((t - 3 - side * EAR_SIDE_DELAY_SECONDS) % EAR_INTERVAL_SECONDS + EAR_INTERVAL_SECONDS) % EAR_INTERVAL_SECONDS;
      const u = phase / EAR_TWITCH_SECONDS;
      // 窗口两端角度和速度均归零，耳朵快速抖动后自然回到原姿态。
      const twitch = u < 1 ? Math.sin(Math.PI * u) ** 2 * Math.sin(2 * Math.PI * EAR_TWITCH_CYCLES * u) : 0;
      chain.forEach((name, index) => rotate(name, 'y', fade * EAR_DEGREES * (1 - index * 0.25) * twitch * (side ? -1 : 1)));
    });
  }
  return { update, reset };
}
