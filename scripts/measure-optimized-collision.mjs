import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const ground = 0.57;
const specs = {
  tree: { file: 'forest-tree.glb', mode: 'height', value: 3.8, slice: 0.5, old: 1.787 },
  nest: { file: 'moss-rest-nest.glb', mode: 'width', value: 2.8, slice: 0.3, old: 1.423 },
  stool: { file: 'peach-mushroom.glb', mode: 'height', value: 0.95, slice: 0.3, old: 0.337 },
  lantern: { file: 'woodland-lantern.glb', mode: 'height', value: 1.05, slice: 0.3, old: 0.360 },
  basket: { file: 'fruit-basket.glb', mode: 'width', value: 1.15, slice: 0.3, old: 0.576 },
  bowl: { file: 'leaf-bowl.glb', mode: 'width', value: 1.0, slice: 0.3, old: 0.470 },
};
function transform(m, p) { return [m[0]*p[0]+m[4]*p[1]+m[8]*p[2]+m[12], m[1]*p[0]+m[5]*p[1]+m[9]*p[2]+m[13], m[2]*p[0]+m[6]*p[1]+m[10]*p[2]+m[14]]; }
function yaw(p, angle) { const c=Math.cos(angle),s=Math.sin(angle); return [c*p[0]+s*p[2],p[1],-s*p[0]+c*p[2]]; }
function sourcePoints(doc) {
  const points=[];
  for (const node of doc.getRoot().listNodes()) {
    const mesh=node.getMesh(); if (!mesh) continue;
    for (const prim of mesh.listPrimitives()) {
      const pos=prim.getAttribute('POSITION'); if (!pos) continue;
      for (let i=0;i<pos.getCount();i++) points.push(transform(node.getWorldMatrix(), pos.getElement(i, [0,0,0])));
    }
  }
  return points;
}
function bounds(points) { const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity]; for(const p of points)for(let a=0;a<3;a++){min[a]=Math.min(min[a],p[a]);max[a]=Math.max(max[a],p[a]);} return {min,max,size:max.map((v,i)=>v-min[i])}; }
function placed(points, spec) {
  const b=bounds(points), axis=spec.mode==='width'?b.size[0]:b.size[1], scale=spec.value/axis;
  let p=points.map(v=>[v[0]*scale,v[1]*scale,v[2]*scale]);
  p=p.map(v=>yaw(v,0));
  const b2=bounds(p), cx=(b2.min[0]+b2.max[0])/2, cz=(b2.min[2]+b2.max[2])/2;
  return p.map(v=>[v[0]-cx,v[1]-b2.min[1]+ground,v[2]-cz]);
}
function measure(points, slice) { const selected=points.filter(p=>p[1]>=ground-1e-5&&p[1]<=ground+slice+1e-5); if(!selected.length)return null; const b=bounds(selected),c=[(b.min[0]+b.max[0])/2,(b.min[2]+b.max[2])/2]; let radius=0; for(const p of selected) radius=Math.max(radius,Math.hypot(p[0]-c[0],p[2]-c[1])); return {radius,count:selected.length,ground:b.min[1],top:b.max[1]}; }
for (const [key,spec] of Object.entries(specs)) {
  const input=path.join(root,'public/models',spec.file), output=path.join(root,'public/models/optimized',spec.file);
  if(!fs.existsSync(output)){console.log(JSON.stringify({物件:key,文件:spec.file,status:'optimized file missing',原版存在:fs.existsSync(input)}));continue;}
  const old=placed(sourcePoints(await io.read(input)),spec); const fresh=placed(sourcePoints(await io.read(output)),spec); const a=measure(old,spec.slice),b=measure(fresh,spec.slice); const delta=b.radius-spec.old;
  console.log(JSON.stringify({物件:key,文件:spec.file,旧常量:+spec.old.toFixed(6),旧模型实测:+a.radius.toFixed(6),新模型实测:+b.radius.toFixed(6),差值:+delta.toFixed(6),新切片顶点:b.count,新贴地:[+b.ground.toFixed(6),+b.top.toFixed(6)]}));
}
