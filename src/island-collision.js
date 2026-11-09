import { Box3, Vector3, Group, BufferGeometry, LineLoop, LineBasicMaterial } from 'three';

// Step 06：单位均为场景单位。实测贴地切片最大半径向上取整，可逐项微调。
export const OBSTACLE_RADII = { tree: 1.787, nest: 1.423, stool: 0.337, lantern: 0.360, basket: 0.576, bowl: 0.470 };
export const BODY_RADIUS = 0.46; // 芽芽躯干近似圆，不含头、耳朵和尾巴；不随跳跃缩放变化
export const BOUNDARY_MARGIN = 0.04; // 身体半径以外的岛边安全留白
export const BOUNDARY_INSET = BODY_RADIUS + BOUNDARY_MARGIN; // 中心距岛边至少这么远
const SLICE_HEIGHT = { tree: 0.5, other: 0.3 }; // 只测落地部分，不包括树冠
const STEP_LENGTH = 0.025; // 短距离子步防止高速/低帧率穿透
const EPSILON = 0.00001;
const NAMES = { tree: '树（树干和主要树根）', nest: '苔藓窝', stool: '蘑菇凳', lantern: '灯笼', basket: '果篮', bowl: '叶形水碗' };
// 加载前的切片圆心偏移；加载完成后由实际顶点重算。相对于 main.js 的 placement。
const CENTER_OFFSETS = { tree: [-.700063,.062411], nest: [-.028190,-.000043], stool: [-.000148,-.000130], lantern: [.001048,-.001392], basket: [.003905,.000269], bowl: [-.030674,0] };

export function measureGroundSlice(root, placement, height) {
  root.updateMatrixWorld(true);
  const bounds = new Box3(), vertex = new Vector3();
  let count = 0;
  function visit(fn) {
    root.traverse(mesh => {
      if (!mesh.isMesh || !mesh.geometry.attributes.position) return;
      for (let i = 0; i < mesh.geometry.attributes.position.count; i++) {
        mesh.getVertexPosition(i, vertex).applyMatrix4(mesh.matrixWorld);
        if (vertex.y >= placement.ground - EPSILON && vertex.y <= placement.ground + height + EPSILON) fn(vertex);
      }
    });
  }
  visit(v => { bounds.expandByPoint(v); count++; });
  if (!count) throw new Error('贴地切片没有顶点，不能确认阻挡区');
  const center = bounds.getCenter(new Vector3());
  let radius = 0;
  visit(v => { radius = Math.max(radius, Math.hypot(v.x - center.x, v.z - center.z)); });
  return { x: center.x, z: center.z, radius, count, height };
}

export function createCollisionWorld({ outline, placements, scene }) {
  // outline 在局部 XY；岛旋转 -PI/2 后 world Z = -local Y，不能直接把 Y 当 Z。
  const polygon = outline.getPoints(384).slice(0, -1).map(p => ({ x: p.x, z: -p.y }));
  const obstacles = Object.entries(placements).map(([key, p]) => ({ key, x: p.x + CENTER_OFFSETS[key][0], z: p.z + CENTER_OFFSETS[key][1], radius: OBSTACLE_RADII[key] }));
  const debug = new Group(); debug.name = 'B · 碰撞线框'; debug.visible = false; scene?.add(debug);
  const bodyLine = new LineLoop(new BufferGeometry(), new LineBasicMaterial({ color: 0x2288ff, depthTest: false }));
  bodyLine.renderOrder = 100; debug.add(bodyLine);
  const material = color => new LineBasicMaterial({ color, depthTest: false });
  function line(points, color) {
    const l = new LineLoop(new BufferGeometry().setFromPoints(points.map(p => new Vector3(p.x,.60,p.z))),material(color));
    l.renderOrder = 100; debug.add(l); return l;
  }
  function circle(x,z,r) { return Array.from({length:128},(_,i)=>({x:x+Math.cos(i/128*Math.PI*2)*r,z:z+Math.sin(i/128*Math.PI*2)*r})); }
  function inside(p) {
    let result = false;
    for (let i=0,j=polygon.length-1;i<polygon.length;j=i++) {
      const a=polygon[i],b=polygon[j];
      if ((a.z>p.z)!==(b.z>p.z) && p.x < (b.x-a.x)*(p.z-a.z)/(b.z-a.z)+a.x) result=!result;
    }
    return result;
  }
  function nearest(p) {
    let best={ distance: Infinity };
    for (let i=0;i<polygon.length;i++) {
      const a=polygon[i],b=polygon[(i+1)%polygon.length],dx=b.x-a.x,dz=b.z-a.z;
      const t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.z-a.z)*dz)/(dx*dx+dz*dz)));
      const x=a.x+t*dx,z=a.z+t*dz,d=Math.hypot(p.x-x,p.z-z);
      if(d<best.distance) best={x,z,distance:d,dx,dz};
    }
    return best;
  }
  function constrainBoundary(p) {
    const n=nearest(p), isInside=inside(p);
    if(isInside && n.distance>=BOUNDARY_INSET) return;
    let nx=p.x-n.x,nz=p.z-n.z;
    if(n.distance>EPSILON) { nx/=n.distance;nz/=n.distance;if(!isInside){nx=-nx;nz=-nz;} }
    else { const len=Math.hypot(n.dx,n.dz);nx=-n.dz/len;nz=n.dx/len;if(!inside({x:n.x+nx*.001,z:n.z+nz*.001})){nx=-nx;nz=-nz;} }
    p.x=n.x+nx*(BOUNDARY_INSET+EPSILON);p.z=n.z+nz*(BOUNDARY_INSET+EPSILON);
  }
  function valid(p, ignore) { return inside(p) && nearest(p).distance>=BOUNDARY_INSET-EPSILON && obstacles.every(o=>o.key===ignore || Math.hypot(p.x-o.x,p.z-o.z)>=o.radius+BODY_RADIUS-EPSILON); }
  function project(p, ignore) {
    // 多个圆和岛边同时接触时反复约束，不能只检查最后一个物件。
    for(let pass=0;pass<16;pass++) {
      for(const o of obstacles) {
        if(o.key===ignore) continue;
        const dx=p.x-o.x,dz=p.z-o.z,d=Math.hypot(dx,dz),r=o.radius+BODY_RADIUS;
        if(d<r) { p.x=o.x+(d>EPSILON?dx/d:1)*(r+EPSILON);p.z=o.z+(d>EPSILON?dz/d:0)*(r+EPSILON); }
      }
      constrainBoundary(p);
      if(valid(p, ignore))return true;
    }
    return false;
  }
  function move(start, displacement, ignore) {
    const p={x:start.x,z:start.z};
    if(!valid(p, ignore) && !project(p, ignore)) return p;
    const steps=Math.max(1,Math.ceil(Math.hypot(displacement.x,displacement.z)/STEP_LENGTH));
    for(let i=0;i<steps;i++) {
      const next={x:p.x+displacement.x/steps,z:p.z+displacement.z/steps};
      // 径向推出只去掉朝内分量，保留切向分量，形成沿圆/岛边滑动。
      if(project(next, ignore)) {p.x=next.x;p.z=next.z;}
      // 无可行解则保留上个合法点，不把角色从狭缝挤进另一个物件。
    }
    return p;
  }
  function rebuildDebug() {
    for(const child of [...debug.children]) if(child!==bodyLine){debug.remove(child);child.geometry.dispose();child.material.dispose();}
    line(polygon,0x219653); // 绿色：原始岛轮廓
    const inset=polygon.map(p=>{const q={...p};for(let i=0;i<4;i++)constrainBoundary(q);return q;});
    line(inset,0xffc000); // 黄色：芽芽中心可到达的内缩边界
    for(const o of obstacles) line(circle(o.x,o.z,o.radius),0xef4444); // 红色：物件贴地圆
    bodyLine.geometry.dispose();bodyLine.geometry=new BufferGeometry().setFromPoints(circle(0,0,BODY_RADIUS).map(p=>new Vector3(p.x,0,p.z)));
  }
  rebuildDebug();
  return { obstacles, polygon, move, valid, debug,
    toggleDebug(){debug.visible=!debug.visible;},
    updateBody(center){bodyLine.position.set(center.x,.615,center.z);},
    register(key, root) {
      const p=placements[key], measurement=measureGroundSlice(root,p,SLICE_HEIGHT[key]??SLICE_HEIGHT.other);
      const o=obstacles.find(o=>o.key===key);o.x=measurement.x;o.z=measurement.z;
      console.table([{物件:NAMES[key],切片高度:measurement.height,顶点数:measurement.count,实测半径:+measurement.radius.toFixed(6),使用半径:o.radius,圆心X:+o.x.toFixed(6),圆心Z:+o.z.toFixed(6)}]);
      rebuildDebug();return measurement;
    },
    dispose(){debug.traverse(o=>{o.geometry?.dispose();o.material?.dispose();});debug.removeFromParent();}
  };
}
