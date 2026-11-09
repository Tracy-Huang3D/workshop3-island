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
// Step 06：真实蒙皮模型验证，不只测试抛物线公式。
setup(); actor.updateMatrixWorld(true);
const ground = new T.Box3().setFromObject(actor,true).min.y;
const baseScale = actor.scale.clone();
const cameraY = camera.position.y, targetY = controls.target.y;
key('keydown','Space');
let maximum = 0, airFrames = 0, frozenTime;
for(let i=0;i<150;i++) {
  if(i===25 || i===30) { key('keyup','Space'); key('keydown','Space'); }
  c.update(1/120); actor.updateMatrixWorld(true);
  maximum = Math.max(maximum,c.state.jumpY);
  if(c.state.jumpPhase !== 'grounded') {
    assert(Math.abs(new T.Box3().setFromObject(actor,true).min.y-ground-c.state.jumpY)<1e-5,'foot pivot');
  }
  if(c.state.jumpPhase==='air') {
    airFrames++;
    if(frozenTime===undefined) frozenTime=c.state.walkTime;
    assert.equal(c.state.walkTime,frozenTime,'walk must freeze in air');
  }
  assert.equal(camera.position.y,cameraY); assert.equal(controls.target.y,targetY);
}
assert(Math.abs(maximum-.6)<.001); assert(Math.abs(airFrames/120-.6)<.02);
assert.equal(c.state.jumpCount,1); assert.equal(c.state.jumpPhase,'grounded'); assert(actor.scale.equals(baseScale));
// 保持空格及重复 keydown 都不重跳；松开再按才允许第二次。
for(let i=0;i<60;i++){key('keydown','Space');c.update(1/60);}assert.equal(c.state.jumpCount,1);
key('keyup','Space');key('keydown','Space');c.update(.05);assert.equal(c.state.jumpCount,2);
c.reset();assert.equal(c.state.jumpPhase,'grounded');assert.equal(c.state.jumpY,0);assert(actor.scale.equals(baseScale));
// 跑步起跳，松开 Shift 后空中仍保留 1.6；从静止起跳也可空中控制。
setup();key('keydown','KeyW');key('keydown','ShiftLeft');for(let i=0;i<40;i++)c.update(1/60);
key('keydown','Space');for(let i=0;i<12;i++)c.update(1/60);assert.equal(c.state.jumpPhase,'air');
key('keyup','ShiftLeft');const before=actor.position.clone();const cy=camera.position.y;for(let i=0;i<6;i++)c.update(1/60);
const distance=new T.Vector2(actor.position.x-before.x,actor.position.z-before.z).length();
assert(Math.abs(distance-.64*1.6*.8*.1)<1e-8);assert.equal(camera.position.y,cy);
c.reset();assert.equal(c.state.keys.length,0);assert(actor.scale.equals(baseScale));
console.log('PASS Step06: feet anchored, apex 0.6, air 0.6s, frozen gait, horizontal camera, no repeat/double jump, release rearm, run momentum, air reset.');
// 把实际控制器接入边界：地面、空中用同一组约束；B 键和重置回归。
const {createCollisionWorld}=await import('../src/island-collision.js');
const outline=new T.CatmullRomCurve3(Array.from({length:24},(_,i)=>new T.Vector3(Math.cos(i/24*Math.PI*2)*4,Math.sin(i/24*Math.PI*2)*3,0)),true);
const world=createCollisionWorld({outline,placements:{}});
c.dispose();
const cc=createYayaController({model,clips:animations,root:actor,camera,controls,eventTarget:events,documentTarget:doc,collisionWorld:world});
camera.position.set(0,8,12);controls.target.set(0,0,0);camera.lookAt(controls.target);camera.updateMatrixWorld();
key('keydown','KeyB');assert(world.debug.visible);key('keyup','KeyB');key('keydown','KeyB');assert(!world.debug.visible);key('keyup','KeyB');
key('keydown','KeyW');key('keydown','ShiftLeft');
for(let i=0;i<700;i++) {if(i%70===0)key('keydown','Space');if(i%70===1)key('keyup','Space');cc.update(1/60);const marker=world.debug.children[0].position;assert(world.valid(marker),'controller outside boundary');}
cc.reset();cc.update(0);assert.equal(cc.state.jumpPhase,'grounded');assert.equal(cc.state.keys.length,0);assert(world.valid(world.debug.children[0].position));cc.dispose();
console.log('PASS integrated controller: running/jumping boundary, B toggle and reset.');
