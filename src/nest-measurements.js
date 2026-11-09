import { Box3, Raycaster, Vector3 } from 'three';

// Step 07 测量门槛：不修改模型、骨骼、碰撞或操控。
const MOSS_HEIGHT_TOLERANCE = 0.08; // 高出窝心苔藓 0.08 视为开始进入窝边（可微调）。
const RADIAL_DIRECTIONS = 24; // 内圈每 15 度测一次；结果为近似安全半径。
const RADIUS_PRECISION = 0.01; // 半径精度，场景单位。
const BODY_BONES = new Set(['tripoRoot', 'tripoSpine_0', 'tripoSpine_1', 'bone_28', 'tripoHead_0', 'tripoHead_1', 'bone_16', 'bone_17']);
const BELLY_BONES = new Set(['tripoSpine_0', 'tripoSpine_1', 'bone_28']);

// 在控制器开始改骨骼之前采样绑定姿态，排除耳朵、尾巴、腿的顶点。
export function measureRestActor(root) {
  root.updateMatrixWorld(true);
  const forward = new Vector3(-0.7, 0, 0.714).normalize().applyAxisAngle(new Vector3(0, 1, 0), root.rotation.y);
  const right = new Vector3().crossVectors(forward, new Vector3(0, 1, 0));
  const point = new Vector3();
  let headFront = -Infinity, left = Infinity, rightmost = -Infinity, bellyY = Infinity;
  root.traverse(mesh => {
    if (!mesh.isSkinnedMesh) return;
    const { skinIndex, skinWeight } = mesh.geometry.attributes;
    for (let i = 0; i < skinIndex.count; i++) {
      let dominant = 0;
      for (let k = 1; k < 4; k++) if (skinWeight.getComponent(i, k) > skinWeight.getComponent(i, dominant)) dominant = k;
      const name = mesh.skeleton.bones[skinIndex.getComponent(i, dominant)].name;
      if (!BODY_BONES.has(name)) continue;
      mesh.getVertexPosition(i, point).applyMatrix4(mesh.matrixWorld);
      headFront = Math.max(headFront, point.dot(forward));
      left = Math.min(left, point.dot(right)); rightmost = Math.max(rightmost, point.dot(right));
      if (BELLY_BONES.has(name)) bellyY = Math.min(bellyY, point.y);
    }
  });
  const tail = root.getObjectByName('bone_39');
  if (!tail || !Number.isFinite(bellyY)) throw new Error('休息测量：找不到已验证的身体/尾根骨骼');
  const soleY = new Box3().setFromObject(root, true).min.y;
  return { length: headFront - tail.getWorldPosition(point).dot(forward), width: rightmost - left, legHeight: bellyY - soleY, bellyY, soleY };
}

// 只读向下射线测真实窝表面，逐方向让出主线程，避免连续阻塞操控。
export async function measureRestNest(root, placement) {
  root.updateMatrixWorld(true);
  const bounds = new Box3().setFromObject(root, true);
  const ray = new Raycaster(); const down = new Vector3(0, -1, 0);
  function height(radius, angle) {
    ray.set(new Vector3(placement.x + radius * Math.cos(angle), bounds.max.y + 1, placement.z + radius * Math.sin(angle)), down);
    return ray.intersectObject(root, true)[0]?.point.y;
  }
  const mossY = height(0, 0);
  if (!Number.isFinite(mossY)) throw new Error('休息测量：窝心没有检测到表面');
  const maxRadius = Math.min(bounds.max.x - placement.x, bounds.max.z - placement.z);
  const radii = [];
  for (let i = 0; i < RADIAL_DIRECTIONS; i++) {
    const angle = i * Math.PI * 2 / RADIAL_DIRECTIONS;
    let low = 0, high = maxRadius;
    // 从窝心向外找到第一个升高的窝边，不能把外侧较低表面误算成窝内。
    for (let radius = 0.1; radius <= maxRadius + 0.1; radius += 0.1) {
      const y = height(radius, angle);
      if (y === undefined || y > mossY + MOSS_HEIGHT_TOLERANCE) { high = radius; break; }
      low = radius;
    }
    while (high - low > RADIUS_PRECISION) {
      const mid = (low + high) / 2, y = height(mid, angle);
      if (y !== undefined && y <= mossY + MOSS_HEIGHT_TOLERANCE) low = mid; else high = mid;
    }
    radii.push(low);
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  return { rimY: bounds.max.y, rimAboveGround: bounds.max.y - placement.ground, mossY, mossAboveGround: mossY - placement.ground, radius: Math.min(...radii), largestRadialReach: Math.max(...radii), radii };
}

export function reportRestMeasurements(actor, nest) {
  const result = { actor, nest, fits: actor.length <= nest.radius * 2 && actor.width <= nest.radius * 2 };
  console.group('[Step 07] 进窝前尺寸检查（场景单位，绑定姿态）');
  console.table({
    '窝边最高点 · 世界Y': { value: nest.rimY },
    '窝边最高点 · 距岛面': { value: nest.rimAboveGround },
    '窝心苔藓表面 · 世界Y': { value: nest.mossY },
    '窝心苔藓表面 · 距岛面': { value: nest.mossAboveGround },
    '平坦内圈安全半径 · 近似': { value: nest.radius },
    '平坦内圈安全直径 · 近似': { value: nest.radius * 2 },
    '芽芽头前缘到尾根': { value: actor.length },
    '芽芽身体含头宽 · 不含耳尾': { value: actor.width },
    '脚底到肚子下缘 · 近似腿长': { value: actor.legHeight },
  });
  console.info('方法：真实蒙皮顶点按最大骨骼权重分组；窝内向下射线24方向，表面高于窝心0.08处视为窝边。未用窝的外径代替内径。', result);
  if (!result.fits) console.warn('当前芽芽超出窝内平坦区域：暂停 Step 07 互动，不自动缩放窝或角色，不折腿。');
  console.groupEnd();
  return result;
}
