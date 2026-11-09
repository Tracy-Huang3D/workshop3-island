import fs from 'node:fs';
import assert from 'node:assert/strict';
import * as T from 'three';
import {createCollisionWorld,OBSTACLE_RADII} from '../src/island-collision.js';
const source=fs.readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
const placements=Object.fromEntries(['tree','nest','stool','lantern','basket','bowl'].map(k=>[k,Function('return '+source.match(new RegExp('const '+k+'Placement = (\\{[^;]+\\})'))[1])()]));
const ISLAND_SCALE=1.5;
const outline=Function('THREE','ISLAND_SCALE','return '+source.match(/const outline = ([\s\S]*?\}\), true\));/)[1])(T,ISLAND_SCALE);
const world=createCollisionWorld({outline,placements});
assert.equal(world.debug.visible,false);world.toggleDebug();assert.equal(world.debug.visible,true);
for(const o of world.obstacles){
  // 从每个圆周多角度发起正面碰撞，连跨大距离也不能穿过。
  for(let a=0;a<Math.PI*2;a+=.3){const p={x:o.x+Math.cos(a)*(o.radius+1),z:o.z+Math.sin(a)*(o.radius+1)};if(!world.valid(p))continue;
    const q=world.move(p,{x:-Math.cos(a)*2,z:-Math.sin(a)*2});assert(world.valid(q),o.key);}
}
const tree=world.obstacles[0];let p={x:tree.x+tree.radius+.5,z:tree.z};
assert(world.valid(p));const start={...p};for(let i=0;i<90;i++){p=world.move(p,{x:-.01,z:.014});assert(world.valid(p));}assert(p.z>start.z+.5,'diagonal slide');
// 360 度向岛外移动，并在边缘持续斜走；采样每一步保证中心圆始终在内。
for(let a=0;a<Math.PI*2;a+=.1){let p={x:0,z:2.5};for(let i=0;i<100;i++){p=world.move(p,{x:Math.cos(a)*.14,z:Math.sin(a)*.14});assert(world.valid(p),'boundary');}}
// 确定性随机游走同时覆盖复合接触。
let seed=124; p={x:0,z:2.5};for(let i=0;i<3000;i++){seed=(seed*1664525+1013904223)>>>0;const a=seed/2**32*Math.PI*2;p=world.move(p,{x:Math.cos(a)*.16,z:Math.sin(a)*.16});assert(world.valid(p));}
console.log('PASS collision: six circles, frontal block, tangential slide, 360-degree boundary, 3000 random steps, debug toggle. Radii:',OBSTACLE_RADII);
