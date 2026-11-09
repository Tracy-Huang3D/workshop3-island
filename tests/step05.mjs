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
const actor=new T.Group();actor.add(model);actor.scale.setScalar(2.43407);actor.position.set(-.45,.57,1.05);
const camera=new T.PerspectiveCamera(); const controls={target:new T.Vector3()};const events=new EventTarget(), doc=new EventTarget();
const c=createYayaController({model,clips:animations,root:actor,camera,controls,eventTarget:events,documentTarget:doc});
function key(type,code){const e=new Event(type,{cancelable:true});Object.defineProperty(e,'code',{value:code});events.dispatchEvent(e);return e;}
function setup(){c.reset();controls.target.set(0,0,0);camera.position.set(0,8,12);camera.lookAt(controls.target);camera.updateMatrixWorld();}
function run(codes,hz=60){setup();for(const code of codes)key('keydown',code);for(let i=0;i<hz*2;i++)c.update(1/hz);return actor.position.distanceTo(new T.Vector3(-.45,.57,1.05));}
const straight=run(['KeyW']), diagonal=run(['KeyW','KeyD']), fast=run(['KeyW','ShiftLeft']);
assert(Math.abs(straight-diagonal)<1e-8);assert(Math.abs(fast/straight-1.6)<1e-8);assert(Math.abs(run(['KeyW'],30)-run(['KeyW'],120))<.02);
setup();camera.position.set(12,8,0);camera.lookAt(controls.target);camera.updateMatrixWorld();key('keydown','KeyW');for(let i=0;i<60;i++)c.update(1/60);assert(actor.position.x<-.8);assert(Math.abs(actor.position.z-1.05)<1e-8);
assert(key('keydown','ArrowUp').defaultPrevented);assert(key('keydown','Space').defaultPrevented);
events.dispatchEvent(new Event('blur'));const stop=actor.position.clone();for(let i=0;i<60;i++)c.update(1/60);assert(actor.position.equals(stop));assert.equal(c.state.weight,0);assert.equal(c.state.keys.length,0);
c.reset();assert(actor.position.equals(new T.Vector3(-.45,.57,1.05)));assert.equal(c.state.walkTime,0);
console.log('PASS: actual GLB idle/walk, diagonal normalization, run 1.6x, 30/120fps, camera-relative W, scroll prevention, blur stop, blend to idle, reset. distances',straight,diagonal,fast);
