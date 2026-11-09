import fs from 'node:fs';
import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
// 无 WebGL 的逻辑测试：跳过贴图，仅使用真实骨骼和动画。
const loader = new GLTFLoader();
loader.register(p => ({ name: 'test-no-textures', beforeRoot() {
  p.json.textures = []; p.json.images = []; p.json.materials = [];
  for (const mesh of p.json.meshes || []) for (const primitive of mesh.primitives) delete primitive.material;
} }));
import assert from 'node:assert/strict';
const {createYayaController}=await import(root+'/src/yaya-controller.js');
const b=fs.readFileSync(root+'/public/models/yaya-rigged.glb');
const {scene:model,animations}=await loader.parseAsync(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),'');

import {createCollisionWorld} from '../src/island-collision.js';
import {measureRestActor} from '../src/nest-measurements.js';
const source=fs.readFileSync(root+'src/main.js','utf8');
const placements=Object.fromEntries(['tree','nest','stool','lantern','basket','bowl'].map(k=>[k,Function('return '+source.match(new RegExp('const '+k+'Placement = (\\{[^;]+\\})'))[1])()]));
const outline=Function('THREE','ISLAND_SCALE','return '+source.match(/const outline = ([\s\S]*?\}\), true\));/)[1])(T,1.5);
const world=createCollisionWorld({outline,placements});
const actor=new T.Group();actor.add(model);actor.scale.setScalar(1.2/new T.Box3().setFromObject(model,true).getSize(new T.Vector3()).y);
actor.updateMatrixWorld(true);const box=new T.Box3().setFromObject(actor,true),center=box.getCenter(new T.Vector3());
actor.position.set(.35-center.x,.57-box.min.y,-1-center.z);actor.updateMatrixWorld(true);
const measurement=measureRestActor(actor);
const camera=new T.PerspectiveCamera();camera.position.set(0,8,12);camera.lookAt(0,0,0);camera.updateMatrixWorld();
const controls={target:new T.Vector3()},events=new EventTarget(),doc=new EventTarget();
const c=createYayaController({model,clips:animations,root:actor,camera,controls,eventTarget:events,documentTarget:doc,collisionWorld:world});
c.setRestNest({placement:placements.nest,mossY:.848151283873,rimY:1.379537059669,actor:measurement});
function key(code){const e=new Event('keydown',{cancelable:true});Object.defineProperty(e,'code',{value:code});events.dispatchEvent(e);const up=new Event('keyup');Object.defineProperty(up,'code',{value:code});events.dispatchEvent(up);}
function frames(n){for(let i=0;i<n;i++)c.update(1/60);}
frames(1);key('KeyE');assert.equal(c.state.restPhase,'turn');
const cy=camera.position.y;frames(240);assert.equal(c.state.restPhase,'rest');assert.equal(camera.position.y,cy);
const p=actor.position.clone();frames(180);assert(Math.hypot(actor.position.x-p.x,actor.position.z-p.z)<1e-8);
// W 朝 -Z：不会经过前方果篮，出窝恢复普通状态。
key('KeyW');assert.equal(c.state.restPhase,'rise');frames(180);assert.equal(c.state.restPhase,'none');assert.equal(camera.position.y,cy);
// 复位必须恢复原站姿；进窝中复位也立刻取消流程。
c.reset();frames(1);key('KeyE');frames(70);c.reset();assert.equal(c.state.restPhase,'none');assert.equal(c.state.jumpPhase,'grounded');
assert(Math.abs(new T.Box3().setFromObject(actor,true).min.y-.57)<.02);
// 忽略窝不等于忽略其它物件。
assert(world.valid({x:2.4,z:-1},'nest'));assert(!world.valid({x:2.4,z:-1}));
assert(!world.valid({x:placements.tree.x,z:placements.tree.z},'nest'));
console.log('PASS Step07: real GLB enter/rest/W-exit, horizontal camera, no position drift, reset during entry, nest-only collision exemption.');
