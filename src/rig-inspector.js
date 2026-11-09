import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import foxUrl from '../models/fox.glb?url';
import './rig-inspector.css';

// Inspection settings only; these are not the final idle animation.
const SWAY_DEGREES = 5;
const SWAY_SPEED = 1.6; // radians per second
const GROUPS = {
  tail: ['bone_39', 'bone_40', 'bone_41', 'bone_42', 'bone_43'],
  earA: ['bone_18', 'bone_19', 'bone_20'],
  earB: ['tripoHead_2', 'tripoHead_3', 'tripoHead_4'],
  head: ['tripoHead_0', 'tripoHead_1'],
};
const $ = id => document.getElementById(id);
const scene = new THREE.Scene();
scene.background = new THREE.Color('#edf1ed');
const camera = new THREE.PerspectiveCamera(38, 1, .01, 100);
const renderer = new THREE.WebGLRenderer({antialias:true});
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
$('view').append(renderer.domElement);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
scene.add(new THREE.HemisphereLight(0xffffff, 0x859582, 2.4));
const light = new THREE.DirectionalLight(0xfff2db, 3); light.position.set(3,5,4); scene.add(light);
const grid = new THREE.GridHelper(3, 20, 0x8caa91, 0xcdd8cb); scene.add(grid);
const marker = new THREE.Mesh(new THREE.SphereGeometry(.012,12,8),new THREE.MeshBasicMaterial({color:0xffcc22,depthTest:false}));
marker.renderOrder = 10; marker.visible = false; scene.add(marker);
let bones=[], selected, helper, root, baseline, start=performance.now(), viewCenter=new THREE.Vector3(), viewSize=1;
const rest=new Map(), labels=new Map();
const axis=new THREE.Vector3(), offset=new THREE.Quaternion(), projected=new THREE.Vector3();
function resetPose(){for(const [bone,pose] of rest){bone.position.copy(pose.position);bone.quaternion.copy(pose.quaternion);bone.scale.copy(pose.scale);}}
function resetCamera(){controls.target.copy(viewCenter);camera.position.copy(viewCenter).add(new THREE.Vector3(1,.55,1.5).multiplyScalar(viewSize*1.5));controls.update();}
function choose(){resetPose();selected=bones.find(b=>b.uuid===$('bone').value);start=performance.now();if(selected)$('detail').textContent=`${selected.name} · 父级：${selected.parent?.name || '无'} · 子骨骼：${selected.children.filter(c=>c.isBone).map(c=>c.name).join(', ')||'无'}`;}
function group(){const names=GROUPS[$('group').value];$('bone').replaceChildren();for(const b of bones.filter(b=>!names||names.includes(b.name))){const o=document.createElement('option');o.value=b.uuid;o.textContent=b.name;$('bone').append(o);}choose();}
$('group').addEventListener('change',group);$('bone').addEventListener('change',choose);
$('motion').addEventListener('change',()=>{resetPose();start=performance.now();});
$('axis').addEventListener('change',()=>{resetPose();start=performance.now();});
$('amplitude').value=SWAY_DEGREES;$('amplitude').addEventListener('input',()=>{$('amount').textContent=`${$('amplitude').value}°`;});
$('restore').addEventListener('click',()=>{$('motion').checked=false;resetPose();});$('camera').addEventListener('click',resetCamera);
new GLTFLoader().load(foxUrl,gltf=>{
 root=gltf.scene;scene.add(root);root.updateMatrixWorld(true);
 const lines=[];function walk(n,depth=0){if(n.isBone){bones.push(n);rest.set(n,{position:n.position.clone(),quaternion:n.quaternion.clone(),scale:n.scale.clone()});lines.push(`${'  '.repeat(depth)}${n.name}`);}for(const child of n.children)walk(child,depth+(n.isBone?1:0));}walk(root);
 console.group('狐狸：全部骨骼父子层级');console.log(lines.join('\n'));console.table(bones.map(b=>({name:b.name,parent:b.parent?.name,children:b.children.filter(c=>c.isBone).map(c=>c.name).join(', ')})));console.log('自带动画（未播放）',gltf.animations.map(a=>a.name));console.groupEnd();$('tree').textContent=lines.join('\n');
 helper=new THREE.SkeletonHelper(root);helper.material.depthTest=false;helper.material.transparent=true;helper.material.opacity=.85;helper.renderOrder=5;scene.add(helper);
 const box=new THREE.Box3().setFromObject(root);viewCenter=box.getCenter(new THREE.Vector3());viewSize=box.getSize(new THREE.Vector3()).length();grid.position.y=box.min.y-.003;resetCamera();
 for(const b of bones){const el=document.createElement('span');el.className='bone-label';el.textContent=b.name;$('labels').append(el);labels.set(b,el);}
 baseline=root.position.clone();$('tools').disabled=false;group();$('status').textContent=`已加载：${bones.length} 根骨骼。未播放自带动画；部位分组待确认。`;
},event=>{if(event.total)$('status').textContent=`模型下载 ${Math.round(event.loaded/event.total*100)}%`;},error=>{$('status').textContent='模型加载失败，请检查控制台和 models/fox.glb 文件。';console.error(error);});
function resize(){const {width,height}=$('view').getBoundingClientRect();renderer.setSize(width,height);camera.aspect=width/height;camera.updateProjectionMatrix();}new ResizeObserver(resize).observe($('view'));resize();
renderer.setAnimationLoop(()=>{
 if(selected){resetPose();if($('motion').checked){axis.set($('axis').value==='X'?1:0,$('axis').value==='Y'?1:0,$('axis').value==='Z'?1:0);const angle=Math.sin((performance.now()-start)/1000*SWAY_SPEED)*THREE.MathUtils.degToRad(Number($('amplitude').value));selected.quaternion.copy(rest.get(selected).quaternion).multiply(offset.setFromAxisAngle(axis,angle));}
 // Never animate the model root or run an AnimationMixer.
 root.position.copy(baseline);root.updateMatrixWorld(true);helper.visible=$('skeleton').checked;marker.visible=helper.visible;selected.getWorldPosition(marker.position);
 }
 controls.update();const w=$('view').clientWidth,h=$('view').clientHeight;const names=GROUPS[$('group').value];
 for(const [bone,el] of labels){bone.getWorldPosition(projected).project(camera);const show=$('names').checked&&(!names||names.includes(bone.name))&&projected.z>=-1&&projected.z<=1;el.hidden=!show;el.classList.toggle('selected',bone===selected);if(show){el.style.left=`${(projected.x*.5+.5)*w}px`;el.style.top=`${(-projected.y*.5+.5)*h}px`;}}
 renderer.render(scene,camera);
});
