import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import './style.css';
import { createYayaController } from './yaya-controller.js';
import { createCollisionWorld } from './island-collision.js';
import { measureRestActor, measureRestNest, reportRestMeasurements } from './nest-measurements.js';
import { createDayNight } from './day-night.js';

// Horizontal island expansion only; all prop positions and ground heights stay unchanged.
const ISLAND_SCALE = 1.5;
// 初始视角相对全景距离的缩放系数；数值越小，重置后镜头越靠近芽芽。
const INITIAL_ZOOM = 0.75;
// 滚轮允许的最近镜头距离；保持足够近以看清芽芽，同时避免穿入模型。
const MIN_ZOOM_DISTANCE = 3.2;
let yayaController;
let collisionWorld;
let dayNight;
// Step 07 先测量再决定是否接入休息；不影响现有操控，开发预览控制台输出。
let restActorMeasurement, restNestMeasurement;
function reportRestWhenReady() {
  if (restActorMeasurement && restNestMeasurement) {
    const result = reportRestMeasurements(restActorMeasurement, restNestMeasurement);
    if (result.fits) yayaController?.setRestNest({ ...restNestMeasurement, placement: nestPlacement, actor: restActorMeasurement });
  }
}


// Step 08G: all planned scene assets are now loaded or reused.
const viewport = document.querySelector('#viewport');
const scene = new THREE.Scene();
scene.background = new THREE.Color('#f6f1e7');
const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 120);
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ antialias: true });
} catch (error) {
  const message = document.querySelector('#error');
  message.hidden = false;
  message.textContent = '暂时无法启动 3D 画面，请使用支持 WebGL 的浏览器并开启硬件加速。';
  throw error;
}
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.18;
viewport.prepend(renderer.domElement);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.enablePan = false;
controls.minPolarAngle = 0.25;
controls.maxPolarAngle = Math.PI / 2 - 0.08;
controls.target.set(0, 0.85, 0);

const hemisphere = new THREE.HemisphereLight('#fffaf2', '#a0a989', 2.2);
scene.add(hemisphere);
const sunlight = new THREE.DirectionalLight('#fff0d8', 2.5);
sunlight.position.set(-5, 9, 6);
sunlight.castShadow = true;
sunlight.shadow.mapSize.set(2048, 2048);
sunlight.shadow.radius = 4;
Object.assign(sunlight.shadow.camera, { left: -9 * ISLAND_SCALE, right: 9 * ISLAND_SCALE, top: 9 * ISLAND_SCALE, bottom: -9 * ISLAND_SCALE, near: 0.5, far: 30 * ISLAND_SCALE });
sunlight.shadow.normalBias = 0.04;
sunlight.shadow.bias = -0.00015;
scene.add(sunlight);
dayNight = createDayNight({ scene, renderer, sunlight, hemisphere });
const mat = color => new THREE.MeshStandardMaterial({ color, roughness: 0.85 });
const materials = { grass: mat('#a2b58a'), earth: mat('#c29b74'), wood: mat('#b79572'), leaf: mat('#91a77b'), peach: mat('#e8b394'), cream: mat('#f5e4c7'), moss: mat('#b5c39b'), stone: mat('#c6bda5') };
function mesh(geometry, material, parent, position = [0,0,0], scale = [1,1,1]) {
  const object = new THREE.Mesh(geometry, material);
  object.position.set(...position); object.scale.set(...scale);
  object.castShadow = true; object.receiveShadow = true;
  parent.add(object); return object;
}
const sphere = new THREE.SphereGeometry(1, 32, 20);
const cylinder = (a,b,h) => new THREE.CylinderGeometry(a,b,h,48);

// Smooth closed spline and bevelled extrusion: shallow irregular island, no texture assets.
const outline = new THREE.CatmullRomCurve3(Array.from({length:12}, (_,i) => {
  const angle = i / 12 * Math.PI * 2;
  const radius = 1 + 0.055 * Math.sin(angle*3) + 0.035*Math.cos(angle*5);
  return new THREE.Vector3(Math.cos(angle)*4.85*radius*ISLAND_SCALE, Math.sin(angle)*3.6*radius*ISLAND_SCALE, 0);
}), true);
const shape = new THREE.Shape(outline.getPoints(96).map(p => new THREE.Vector2(p.x,p.y)));
const island = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: .28, bevelEnabled: true, bevelSegments: 4, steps: 1, bevelSize: .16, bevelThickness: .12, curveSegments: 48 }), [materials.grass, materials.earth]);
island.rotation.x = -Math.PI/2; island.position.y = .17;
island.castShadow = true; island.receiveShadow = true; scene.add(island);
const floor = mesh(new THREE.PlaneGeometry(200,200), mat('#f6f1e7'), scene, [0,0,0]);
floor.rotation.x = -Math.PI/2; floor.castShadow = false;
const surface = .59;
const labels = [];
function placeholder(name, x, z, height) {
  const group = new THREE.Group(); group.name = name; group.position.set(x, surface, z); scene.add(group);
  const element = document.createElement('span'); element.className = 'label'; element.textContent = `${name} · 占位`;
  document.querySelector('#labels').append(element);
  labels.push({ group, height, element }); return group;
}
const yaya = placeholder('芽芽', -.5, 1.05, 1.7);
mesh(new THREE.CapsuleGeometry(.42,.48,8,24), materials.cream,yaya,[0,.7,0]);
mesh(sphere,materials.peach,yaya,[0,1.4,0],[.4,.12,.4]);
const modelStatus = document.querySelector('#model-status');
const modelUrl = `${import.meta.env.BASE_URL}models/yaya-rigged.glb`;
// Flat island top = .17 + .28 + .12; .59 is the earlier placeholder clearance.
// Step 07：缩小角色，为窝内约 1.0 的安全直径留出余量；保持脚底贴地。
const modelPlacement = { height: 1.2, x: -.45, z: 1.05, yaw: .2, ground: .57, footOffset: 0 };
let modelInfo;
new GLTFLoader().load(modelUrl, gltf => {
  try {
    const model = gltf.scene;
    model.updateMatrixWorld(true);
    const original = new THREE.Box3().setFromObject(model, true);
    const size = original.getSize(new THREE.Vector3());
    if (!Number.isFinite(size.y) || size.y <= 0) throw new Error('模型包围盒高度无效');
    const root = new THREE.Group(); root.name = '芽芽 · 真实模型'; root.add(model);
    root.scale.setScalar(modelPlacement.height / size.y);
    root.rotation.y = modelPlacement.yaw;
    root.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(root, true);
    const center = bounds.getCenter(new THREE.Vector3());
    root.position.set(modelPlacement.x - center.x, modelPlacement.ground - bounds.min.y + modelPlacement.footOffset, modelPlacement.z - center.z);
    model.traverse(object => { if (object.isMesh) { object.castShadow = true; object.receiveShadow = true; } });
    {
      restActorMeasurement = measureRestActor(root);
      reportRestWhenReady();
    }
    const controller = createYayaController({ model, clips: gltf.animations, root, camera, controls, collisionWorld, dayNight, lanternPlacement });
    scene.add(root); root.updateMatrixWorld(true);
    yayaController = controller;
    reportRestWhenReady();
    scene.remove(yaya);
    const labelIndex = labels.findIndex(label => label.group === yaya);
    labels[labelIndex].element.remove(); labels.splice(labelIndex, 1);
    modelInfo = { originalBounds: { min: original.min.toArray(), max: original.max.toArray() }, scale: root.scale.toArray(), position: root.position.toArray(), yaw: root.rotation.y, worldBounds: new THREE.Box3().setFromObject(root,true), placement: modelPlacement };
    modelStatus.dataset.state = 'loaded';
    modelStatus.textContent = '芽芽已加载 · WASD 可操控';
  } catch (error) { showModelError(error); }
}, event => {
  modelStatus.textContent = event.lengthComputable && event.total > 0
    ? `芽芽正在加载 · ${Math.floor(event.loaded / event.total * 100)}%${event.loaded === event.total ? ' · 正在解析' : ''}`
    : '芽芽正在加载';
}, showModelError);
function showModelError(error) {
  modelStatus.dataset.state = 'error';
  modelStatus.textContent = `加载失败：${modelUrl} — ${error.message || error.target?.statusText || '网络请求失败，请检查文件与连接'}。保留占位，请刷新重试。`;
}
const tree = placeholder('树', -2.4,-1.05,3.8);
mesh(cylinder(.26,.43,2.3),materials.wood,tree,[0,1.15,0]);
mesh(sphere,materials.leaf,tree,[.25,2.65,0],[1.65,.82,1.15]);
const treeStatus = document.querySelector('#tree-status');
const treeUrl = `${import.meta.env.BASE_URL}models/optimized/forest-tree.glb`;
const treePlacement = { height: 3.8, x: -2.05, z: -.95, yaw: -.12, ground: .57 };
let treeInfo;
new GLTFLoader().load(treeUrl, gltf => {
  try {
    const model = gltf.scene;
    model.updateMatrixWorld(true);
    const original = new THREE.Box3().setFromObject(model, true);
    const size = original.getSize(new THREE.Vector3());
    if (!Number.isFinite(size.y) || size.y <= 0) throw new Error('树模型包围盒高度无效');
    const root = new THREE.Group(); root.name = '树 · 真实模型'; root.add(model);
    root.scale.setScalar(treePlacement.height / size.y);
    root.rotation.y = treePlacement.yaw;
    root.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(root, true);
    const center = bounds.getCenter(new THREE.Vector3());
    root.position.set(treePlacement.x-center.x, treePlacement.ground-bounds.min.y, treePlacement.z-center.z);
    model.traverse(object => { if (object.isMesh) { object.castShadow = true; object.receiveShadow = true; } });
    scene.add(root); root.updateMatrixWorld(true);
    scene.remove(tree);
    const labelIndex = labels.findIndex(label => label.group === tree);
    labels[labelIndex].element.remove(); labels.splice(labelIndex,1);
    collisionWorld.register('tree', root);
    treeInfo = { originalBounds: {min: original.min.toArray(),max: original.max.toArray()}, scale: root.scale.toArray(), position: root.position.toArray(), placement: treePlacement, worldBounds: new THREE.Box3().setFromObject(root,true) };
    treeStatus.dataset.state = 'loaded'; treeStatus.textContent = '树已加载';
  } catch (error) { showTreeError(error); }
}, event => {
  treeStatus.textContent = event.lengthComputable && event.total > 0
    ? `树正在加载 · ${Math.floor(event.loaded/event.total*100)}%${event.loaded === event.total ? ' · 正在解析' : ''}`
    : '树正在加载';
}, showTreeError);
function showTreeError(error) {
  treeStatus.dataset.state = 'error';
  treeStatus.textContent = `加载失败：${treeUrl} — ${error.message || error.target?.statusText || '网络请求失败'}。保留树占位，请刷新重试。`;
}
const nestPlacement = { width: 2.8, x: 2.4, z: -1.0, yaw: -.08, ground: .57 };
const nest = placeholder('苔藓窝',nestPlacement.x,nestPlacement.z,.65);
const ring = mesh(new THREE.TorusGeometry(.82,.18,16,48),materials.wood,nest,[0,.22,0]); ring.rotation.x = Math.PI/2;
mesh(cylinder(.7,.7,.14),materials.moss,nest,[0,.14,0]);
const nestStatus = document.querySelector('#nest-status');
const nestUrl = `${import.meta.env.BASE_URL}models/optimized/moss-rest-nest.glb`;
// Use footprint instead of height for a shallow resting nest; retain its proportions.
let nestInfo;
new GLTFLoader().load(nestUrl, gltf => {
  try {
    const model = gltf.scene;
    model.updateMatrixWorld(true);
    const original = new THREE.Box3().setFromObject(model, true);
    const size = original.getSize(new THREE.Vector3());
    if (!Number.isFinite(size.x) || size.x <= 0) throw new Error('苔藓窝包围盒宽度无效');
    const root = new THREE.Group(); root.name = '苔藓窝 · 真实模型'; root.add(model);
    root.scale.setScalar(nestPlacement.width/size.x);
    root.rotation.y = nestPlacement.yaw; root.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(root, true);
    const center = bounds.getCenter(new THREE.Vector3());
    root.position.set(nestPlacement.x-center.x,nestPlacement.ground-bounds.min.y,nestPlacement.z-center.z);
    model.traverse(object=>{if(object.isMesh){object.castShadow=true;object.receiveShadow=true;}});
    scene.add(root); root.updateMatrixWorld(true);
    scene.remove(nest);
    const index=labels.findIndex(label=>label.group===nest);
    labels[index].element.remove(); labels.splice(index,1);
    collisionWorld.register('nest', root);
    measureRestNest(root, nestPlacement).then(measurement => {
      restNestMeasurement = measurement;
      reportRestWhenReady();
    }).catch(error => console.error('[Step 07] 尺寸测量失败', error));
    nestInfo={originalBounds:{min:original.min.toArray(),max:original.max.toArray()},scale:root.scale.toArray(),position:root.position.toArray(),placement:nestPlacement,worldBounds:new THREE.Box3().setFromObject(root,true)};
    nestStatus.dataset.state='loaded'; nestStatus.textContent='苔藓窝已加载';
  } catch(error) { showNestError(error); }
},event=>{
  nestStatus.textContent=event.lengthComputable && event.total>0
    ? `苔藓窝正在加载 · ${Math.floor(event.loaded/event.total*100)}%${event.loaded===event.total?' · 正在解析':''}`
    : '苔藓窝正在加载';
},showNestError);
function showNestError(error) {
  nestStatus.dataset.state='error';
  nestStatus.textContent=`加载失败：${nestUrl} — ${error.message||error.target?.statusText||'网络请求失败'}。保留苔藓窝占位，请刷新重试。`;
}
const lanternPlacement = { height: 1.05, x: -4.3, z: 2.4, yaw: 0, ground: .57 };
const lantern = placeholder('灯笼',lanternPlacement.x,lanternPlacement.z,1.05);
mesh(new THREE.BoxGeometry(.4,.65,.4),mat('#e9c777'),lantern,[0,.4,0]);
mesh(new THREE.ConeGeometry(.4,.28,6),materials.leaf,lantern,[0,.86,0]);
const lanternStatus = document.querySelector('#lantern-status');
const lanternUrl = `${import.meta.env.BASE_URL}models/optimized/woodland-lantern.glb`;
let lanternInfo;
new GLTFLoader().load(lanternUrl, gltf => {
  try {
    const model = gltf.scene;
    model.updateMatrixWorld(true);
    const original = new THREE.Box3().setFromObject(model,true);
    const size = original.getSize(new THREE.Vector3());
    if (!Number.isFinite(size.y) || size.y <= 0) throw new Error('灯笼包围盒高度无效');
    const root = new THREE.Group(); root.name='灯笼 · 真实模型'; root.add(model);
    root.scale.setScalar(lanternPlacement.height/size.y);
    root.rotation.y=lanternPlacement.yaw; root.updateMatrixWorld(true);
    const bounds=new THREE.Box3().setFromObject(root,true);
    const center=bounds.getCenter(new THREE.Vector3());
    root.position.set(lanternPlacement.x-center.x,lanternPlacement.ground-bounds.min.y,lanternPlacement.z-center.z);
    model.traverse(object=>{if(object.isMesh){object.castShadow=true;object.receiveShadow=true;}});
    scene.add(root); root.updateMatrixWorld(true); dayNight.setLantern(root); scene.remove(lantern);
    const index=labels.findIndex(label=>label.group===lantern);
    labels[index].element.remove(); labels.splice(index,1);
    collisionWorld.register('lantern', root);
    lanternInfo={originalBounds:{min:original.min.toArray(),max:original.max.toArray()},scale:root.scale.toArray(),position:root.position.toArray(),placement:lanternPlacement,worldBounds:new THREE.Box3().setFromObject(root,true)};
    lanternStatus.dataset.state='loaded'; lanternStatus.textContent='灯笼已加载';
  } catch(error) { showLanternError(error); }
},event=>{
  lanternStatus.textContent=event.lengthComputable&&event.total>0
    ? `灯笼正在加载 · ${Math.floor(event.loaded/event.total*100)}%${event.loaded===event.total?' · 正在解析':''}`
    : '灯笼正在加载';
},showLanternError);
function showLanternError(error) {
  lanternStatus.dataset.state='error';
  lanternStatus.textContent=`加载失败：${lanternUrl} — ${error.message||error.target?.statusText||'网络请求失败'}。保留灯笼占位，请刷新重试。`;
}
const basket = placeholder('果篮',2.05,1.45,.8);
mesh(cylinder(.43,.32,.42),materials.wood,basket,[0,.21,0]);
const handle = mesh(new THREE.TorusGeometry(.34,.045,8,32,Math.PI), materials.wood,basket,[0,.4,0]);
const basketStatus = document.querySelector('#basket-status');
const basketUrl = `${import.meta.env.BASE_URL}models/optimized/fruit-basket.glb`;
const basketPlacement = { width: 1.15, x: 2.05, z: 1.45, yaw: 0, ground: .57 };
let basketInfo;
new GLTFLoader().load(basketUrl, gltf => {
  try {
    const model = gltf.scene;
    model.updateMatrixWorld(true);
    const original = new THREE.Box3().setFromObject(model,true);
    const size = original.getSize(new THREE.Vector3());
    if (!Number.isFinite(size.x) || size.x <= 0) throw new Error('果篮包围盒宽度无效');
    const root = new THREE.Group(); root.name='果篮 · 真实模型'; root.add(model);
    root.scale.setScalar(basketPlacement.width/size.x);
    root.rotation.y=basketPlacement.yaw; root.updateMatrixWorld(true);
    const bounds=new THREE.Box3().setFromObject(root,true);
    const center=bounds.getCenter(new THREE.Vector3());
    root.position.set(basketPlacement.x-center.x,basketPlacement.ground-bounds.min.y,basketPlacement.z-center.z);
    model.traverse(object=>{if(object.isMesh){object.castShadow=true;object.receiveShadow=true;}});
    scene.add(root); root.updateMatrixWorld(true); scene.remove(basket);
    const index=labels.findIndex(label=>label.group===basket);
    labels[index].element.remove(); labels.splice(index,1);
    collisionWorld.register('basket', root);
    basketInfo={originalBounds:{min:original.min.toArray(),max:original.max.toArray()},scale:root.scale.toArray(),position:root.position.toArray(),placement:basketPlacement,worldBounds:new THREE.Box3().setFromObject(root,true)};
    basketStatus.dataset.state='loaded'; basketStatus.textContent='果篮已加载';
  } catch(error) { showBasketError(error); }
},event=>{
  basketStatus.textContent=event.lengthComputable&&event.total>0
    ? `果篮正在加载 · ${Math.floor(event.loaded/event.total*100)}%${event.loaded===event.total?' · 正在解析':''}`
    : '果篮正在加载';
},showBasketError);
function showBasketError(error) {
  basketStatus.dataset.state='error';
  basketStatus.textContent=`加载失败：${basketUrl} — ${error.message||error.target?.statusText||'网络请求失败'}。保留果篮占位，请刷新重试。`;
}
const bowl = placeholder('叶形水碗',3.2,1.25,.42);
mesh(sphere,materials.leaf,bowl,[0,.13,0],[.52,.12,.32]);
const bowlStatus = document.querySelector('#bowl-status');
const bowlUrl = `${import.meta.env.BASE_URL}models/optimized/leaf-bowl.glb`;
const bowlPlacement = { width: 1.0, x: 4.0, z: 1.25, yaw: 0, ground: .57 };
let bowlInfo;
new GLTFLoader().load(bowlUrl, gltf => {
  try {
    const model = gltf.scene;
    model.updateMatrixWorld(true);
    const original = new THREE.Box3().setFromObject(model,true);
    const size = original.getSize(new THREE.Vector3());
    if (!Number.isFinite(size.x) || size.x <= 0) throw new Error('叶形水碗包围盒宽度无效');
    const root = new THREE.Group(); root.name='叶形水碗 · 真实模型'; root.add(model);
    root.scale.setScalar(bowlPlacement.width/size.x);
    root.rotation.y=bowlPlacement.yaw; root.updateMatrixWorld(true);
    const bounds=new THREE.Box3().setFromObject(root,true);
    const center=bounds.getCenter(new THREE.Vector3());
    root.position.set(bowlPlacement.x-center.x,bowlPlacement.ground-bounds.min.y,bowlPlacement.z-center.z);
    model.traverse(object=>{if(object.isMesh){object.castShadow=true;object.receiveShadow=true;}});
    scene.add(root); root.updateMatrixWorld(true); scene.remove(bowl);
    const index=labels.findIndex(label=>label.group===bowl);
    labels[index].element.remove(); labels.splice(index,1);
    collisionWorld.register('bowl', root);
    bowlInfo={originalBounds:{min:original.min.toArray(),max:original.max.toArray()},scale:root.scale.toArray(),position:root.position.toArray(),placement:bowlPlacement,worldBounds:new THREE.Box3().setFromObject(root,true)};
    bowlStatus.dataset.state='loaded'; bowlStatus.textContent='叶形水碗已加载';
  } catch(error) { showBowlError(error); }
},event=>{
  bowlStatus.textContent=event.lengthComputable&&event.total>0
    ? `叶形水碗正在加载 · ${Math.floor(event.loaded/event.total*100)}%${event.loaded===event.total?' · 正在解析':''}`
    : '叶形水碗正在加载';
},showBowlError);
function showBowlError(error) {
  bowlStatus.dataset.state='error';
  bowlStatus.textContent=`加载失败：${bowlUrl} — ${error.message||error.target?.statusText||'网络请求失败'}。保留叶形水碗占位，请刷新重试。`;
}
const stool = placeholder('蘑菇凳',-3.2,.82,.95);
mesh(cylinder(.22,.28,.5),materials.cream,stool,[0,.25,0]);
mesh(sphere,materials.peach,stool,[0,.6,0],[.58,.22,.48]);
const stoolStatus = document.querySelector('#stool-status');
const stoolUrl = `${import.meta.env.BASE_URL}models/optimized/peach-mushroom.glb`;
const stoolPlacement = { height: .95, x: -3.15, z: .85, yaw: 0, ground: .57 };
let stoolInfo;
new GLTFLoader().load(stoolUrl, gltf => {
  try {
    const model=gltf.scene; model.updateMatrixWorld(true); const original=new THREE.Box3().setFromObject(model,true); const size=original.getSize(new THREE.Vector3());
    if(!Number.isFinite(size.y)||size.y<=0) throw new Error('蘑菇凳包围盒高度无效');
    const root=new THREE.Group(); root.name='蘑菇凳 · 真实模型'; root.add(model); root.scale.setScalar(stoolPlacement.height/size.y); root.updateMatrixWorld(true);
    const bounds=new THREE.Box3().setFromObject(root,true), center=bounds.getCenter(new THREE.Vector3()); root.position.set(stoolPlacement.x-center.x,stoolPlacement.ground-bounds.min.y,stoolPlacement.z-center.z);
    model.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true;}}); scene.add(root); scene.remove(stool); const i=labels.findIndex(x=>x.group===stool); labels[i].element.remove(); labels.splice(i,1);
    collisionWorld.register('stool', root);
    stoolInfo={originalBounds:{min:original.min.toArray(),max:original.max.toArray()},scale:root.scale.toArray(),position:root.position.toArray(),placement:stoolPlacement}; stoolStatus.dataset.state='loaded'; stoolStatus.textContent='蘑菇凳已加载';
  } catch(e) { showStoolError(e); }
}, e => { stoolStatus.textContent=e.lengthComputable&&e.total>0 ? `蘑菇凳正在加载 · ${Math.floor(e.loaded/e.total*100)}%` : '蘑菇凳正在加载'; }, showStoolError);
function showStoolError(e) { stoolStatus.dataset.state='error'; stoolStatus.textContent=`加载失败：${stoolUrl} — ${e.message||'网络请求失败'}。暂时显示蘑菇凳几何回退形状，请刷新重试。`; }

// Start beside the fox, pass in front of the basket/bowl, then curve around the right half.
// Equal arc-length sampling keeps the original ~0.7-unit stepping rhythm.
const stonePath = new THREE.CatmullRomCurve3([
  [-.35, 2.72], [1.6, 3.45], [3.8, 3.15], [5.4, 1.8],
  [5.65, -.3], [4.9, -2.4], [3.1, -3.65],
].map(([x,z]) => new THREE.Vector3(x * ISLAND_SCALE / 1.5, 0, z * ISLAND_SCALE / 1.5)));
const stoneCount = Math.ceil(stonePath.getLength() / .7) + 1;
const stonePositions = stonePath.getSpacedPoints(stoneCount - 1).map((p,i) => [p.x, p.z, i % 2 ? -.18 : .12]);
// Step 10A: change this one path to models/optimized/garden-stepping-stone.glb to切回原版。
const stoneModelFile = 'models/optimized/garden-stepping-stone.glb';
const stoneUrl=`${import.meta.env.BASE_URL}${stoneModelFile}`; const stoneStatus=document.querySelector('#stone-status'); let stoneInfo;
new GLTFLoader().load(stoneUrl,gltf=>{const source=gltf.scene; source.updateMatrixWorld(true); const b=new THREE.Box3().setFromObject(source,true), size=b.getSize(new THREE.Vector3()), scale=.58/size.x; const stoneObjects=[]; stonePositions.forEach(([x,z,yaw],i)=>{const m=source.clone(true); m.name=`踏脚石 ${i+1}`; m.scale.setScalar(scale*(.88+i%2*.14)); m.rotation.y=yaw; m.updateMatrixWorld(true); const bb=new THREE.Box3().setFromObject(m,true),c=bb.getCenter(new THREE.Vector3()); m.position.set(x-c.x,.57-bb.min.y,z-c.z); m.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true;}}); scene.add(m); stoneObjects.push(m);}); dayNight.setStoneObjects(stoneObjects, new THREE.Vector3(lanternPlacement.x, 0, lanternPlacement.z)); stoneInfo={count:stonePositions.length,positions:stonePositions}; stoneStatus.dataset.state='loaded'; stoneStatus.textContent=`踏脚石已加载 · 复用${stonePositions.length}块`;},()=>{stoneStatus.textContent='踏脚石正在加载';},e=>{stoneStatus.dataset.state='error';stoneStatus.textContent=`加载失败：${stoneUrl} — ${e.message||'网络请求失败'}。保留程序化石块。`;});
const daisyUrl=`${import.meta.env.BASE_URL}models/optimized/cream-daisies.glb`; const daisyStatus=document.querySelector('#daisy-status'); let daisyInfo;
new GLTFLoader().load(daisyUrl,gltf=>{const source=gltf.scene; source.updateMatrixWorld(true); const spots=[
  [-6.15,-1.6,.8],[-6.05,.5,1.4],[-5.35,2.65,-.4],[-2.7,4.15,.5],
  [.1,4.65,-.7],[2.8,4.1,.3],[6.3,.25,-.5],[5.65,-2.5,.7],
  [1.1,-4.5,-.3],[-2.2,-4.1,.8],[-4.7,-3.1,-.6],[-4.1,3.5,.2],[-3.25,2.55,-.5],
].map(([x,z,yaw])=>[x*ISLAND_SCALE/1.5,z*ISLAND_SCALE/1.5,yaw]); spots.forEach(([x,z,yaw],i)=>{const m=source.clone(true); m.name=`花草 ${i+1}`; m.scale.setScalar(.62*(i%2?.8:1)); m.rotation.y=yaw; m.updateMatrixWorld(true); const bb=new THREE.Box3().setFromObject(m,true),c=bb.getCenter(new THREE.Vector3()); m.position.set(x-c.x,.57-bb.min.y,z-c.z); m.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true;}}); scene.add(m);}); daisyInfo={count:spots.length,spots}; daisyStatus.dataset.state='loaded'; daisyStatus.textContent=`花草已加载 · 复用${spots.length}簇`;},()=>{daisyStatus.textContent='花草正在加载';},e=>{daisyStatus.dataset.state='error';daisyStatus.textContent=`加载失败：${daisyUrl} — ${e.message||'网络请求失败'}。保留简化花草。`;});

function resetView() {
  yayaController?.reset();
  dayNight?.resetDay();
  const aspect = viewport.clientWidth / viewport.clientHeight;
  const vertical = THREE.MathUtils.degToRad(camera.fov / 2);
  const horizontal = Math.atan(Math.tan(vertical)*aspect);
  let distance = (4.8 * ISLAND_SCALE) / Math.sin(Math.min(vertical,horizontal));
  const framingTarget = new THREE.Vector3(0,.85,0);
  // Desktop: aim for 85% width, but keep the island and treetop inside the viewport.
  // A wide, shallow viewport reaches its height limit before its width limit.
  if (viewport.clientWidth > 600) {
    const direction = new THREE.Vector3(.2,.68,1).normalize();
    const right = new THREE.Vector3().crossVectors(camera.up, direction).normalize();
    const up = new THREE.Vector3().crossVectors(direction, right);
    island.updateMatrixWorld(true);
    const points = [];
    const positions = island.geometry.attributes.position;
    for (let i = 0; i < positions.count; i++) {
      points.push(new THREE.Vector3().fromBufferAttribute(positions,i).applyMatrix4(island.matrixWorld));
    }
    points.push(new THREE.Vector3(treePlacement.x,treePlacement.ground+treePlacement.height,treePlacement.z));
    const heights = points.map(point => point.clone().sub(framingTarget).dot(up));
    framingTarget.addScaledVector(up,(Math.min(...heights)+Math.max(...heights))/2);
    distance = Math.max(...points.map(point => {
      const offset = point.clone().sub(framingTarget);
      return offset.dot(direction) + Math.max(
        Math.abs(offset.dot(right)) / (Math.tan(horizontal) * .85),
        Math.abs(offset.dot(up)) / (Math.tan(vertical) * .90),
      );
    }));
  }
  controls.enableDamping = false;
  controls.reset();
  // 初始镜头向芽芽所在区域偏移；把焦点略抬高，让芽芽落在画面中间偏下。
  const yayaFocus = new THREE.Vector3(
    modelPlacement.x,
    modelPlacement.ground + modelPlacement.height * .62,
    modelPlacement.z,
  );
  framingTarget.lerp(yayaFocus, .55);
  const initialDistance = distance * INITIAL_ZOOM;
  controls.target.copy(framingTarget);
  camera.position.copy(new THREE.Vector3(.2,.68,1).normalize().multiplyScalar(initialDistance).add(controls.target));
  controls.minDistance = MIN_ZOOM_DISTANCE; controls.maxDistance = distance*1.65;
  controls.update(); controls.saveState(); controls.enableDamping = true;
}
function resize() {
  labels.forEach(({group,element}) => { element.textContent = window.innerWidth < 600 ? group.name : `${group.name} · 占位`; });
  renderer.setSize(viewport.clientWidth, viewport.clientHeight);
  camera.aspect = viewport.clientWidth / viewport.clientHeight;
  camera.updateProjectionMatrix(); resetView();
}
collisionWorld = createCollisionWorld({ outline, scene, placements: { tree: treePlacement, nest: nestPlacement, stool: stoolPlacement, lantern: lanternPlacement, basket: basketPlacement, bowl: bowlPlacement } });
document.querySelector('#reset').addEventListener('click',resetView);
window.addEventListener('resize',resize);
resize();
// Opt-in development-only inspection, never part of the production interface.
if (import.meta.env.DEV && new URLSearchParams(location.search).has('qa')) {
  window.sceneQA = { renderer, scene, camera, controls, collisionWorld, get yayaController() { return yayaController; }, get modelInfo() { return modelInfo; }, get treeInfo() { return treeInfo; }, get nestInfo() { return nestInfo; }, get lanternInfo() { return lanternInfo; }, get basketInfo() { return basketInfo; }, get bowlInfo() { return bowlInfo; }, get stoolInfo() { return stoolInfo; }, get stoneInfo() { return stoneInfo; }, get daisyInfo() { return daisyInfo; } };
}
const labelPosition = new THREE.Vector3();
let previousFrame = performance.now();
renderer.setAnimationLoop(()=>{
  const now = performance.now();
  const delta = Math.min((now - previousFrame) / 1000, 0.1);
  previousFrame = now;
  controls.update();
  yayaController?.update(delta);
  dayNight?.update(delta);
  renderer.render(scene,camera);
  if (import.meta.env.DEV) renderer.domElement.dispatchEvent(new Event("record-frame"));
  for (const {group,height,element} of labels) {
    labelPosition.copy(group.position); labelPosition.y += height;
    labelPosition.project(camera);
    element.hidden = Math.abs(labelPosition.z)>1;
    element.style.left = `${(labelPosition.x*.5+.5)*viewport.clientWidth}px`;
    element.style.top = `${(-labelPosition.y*.5+.5)*viewport.clientHeight}px`;
  }
});

if (import.meta.env.DEV && !new URLSearchParams(location.search).has('gif') && new URLSearchParams(location.search).has('record')) {
  import('./step05-record.js').then(({ addRecordingButton }) => addRecordingButton(renderer.domElement, () => ({scene, camera, controls, controller: yayaController, world: collisionWorld})));
}

// Development-only recorder: removed from production builds.
if (import.meta.env.DEV && new URLSearchParams(location.search).has('gif')) {
  import('./gif-recorder.js').then(({ addGifRecorder }) => addGifRecorder());
}
