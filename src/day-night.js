import * as THREE from 'three';
import { createFireflies } from './fireflies.js';
export const DAY_NIGHT_CONFIG = {
  duration: 1.5,
  day: { background: '#f6f1e7', sunlight: '#fff0d8', sunlightIntensity: 2.5, hemisphereSky: '#fffaf2', hemisphereGround: '#a0a989', hemisphereIntensity: 2.2, exposure: 1.18 },
  night: { background: '#2b3350', sunlight: '#9bbcff', sunlightIntensity: 0.4, hemisphereSky: '#4b5578', hemisphereGround: '#263044', hemisphereIntensity: 0.6, exposure: 0.92, lantern: '#ffb35c', lanternIntensity: 2.2, lanternDistance: 5.2, stone: '#c98a4a', stoneIntensity: 0.25, stoneFarIntensity: 0.08 },
  stoneDelay: 0.05,
};
const a = new THREE.Color(), b = new THREE.Color();
export function createDayNight({scene, renderer, sunlight, hemisphere}) {
  let progress=0, target=0, lanternLight, lanternGlow, lanternRoot, stoneEntries=[];
  const fireflies = createFireflies(scene);
  function setStoneObjects(objects, lanternPosition) {
    const ordered = lanternPosition ? [...objects].sort((left, right) => {
      const ld = left.position.distanceToSquared(lanternPosition);
      const rd = right.position.distanceToSquared(lanternPosition);
      return ld - rd;
    }) : objects;
    stoneEntries=ordered.map((object,index)=>({object,index,materials:[]}));
    for(const entry of stoneEntries) entry.object.traverse(node=>{ if(!node.isMesh) return; const isArray=Array.isArray(node.material); const old=isArray?node.material:[node.material]; const copies=old.map(material=>{const copy=material.clone(); entry.materials.push(copy); return copy;}); node.material=isArray?copies:copies[0]; });
    apply();
  }
  function setLantern(root) {
    lanternRoot=root;
    lanternLight=new THREE.PointLight(DAY_NIGHT_CONFIG.night.lantern,0,DAY_NIGHT_CONFIG.night.lanternDistance,2); lanternLight.position.set(0,.58,0); root.add(lanternLight);
    lanternGlow=new THREE.Mesh(new THREE.SphereGeometry(.075,12,8),new THREE.MeshBasicMaterial({color:DAY_NIGHT_CONFIG.night.lantern,transparent:true,opacity:0})); lanternGlow.position.set(0,.53,0); lanternGlow.name='Lantern glow'; root.add(lanternGlow);
    root.traverse(node=>{if(!node.isMesh)return; const isArray=Array.isArray(node.material); const old=isArray?node.material:[node.material]; const copies=old.map(material=>{const copy=material.clone(); if('emissive' in copy)copy.emissive.set(DAY_NIGHT_CONFIG.night.lantern); if('emissiveIntensity' in copy)copy.emissiveIntensity=0; return copy;}); node.material=isArray?copies:copies[0];}); apply();
  }
  function apply() {
    const t=progress;
    scene.background.copy(a.set(DAY_NIGHT_CONFIG.day.background).lerp(b.set(DAY_NIGHT_CONFIG.night.background),t));
    sunlight.color.copy(a.set(DAY_NIGHT_CONFIG.day.sunlight).lerp(b.set(DAY_NIGHT_CONFIG.night.sunlight),t)); sunlight.intensity=THREE.MathUtils.lerp(DAY_NIGHT_CONFIG.day.sunlightIntensity,DAY_NIGHT_CONFIG.night.sunlightIntensity,t);
    hemisphere.color.copy(a.set(DAY_NIGHT_CONFIG.day.hemisphereSky).lerp(b.set(DAY_NIGHT_CONFIG.night.hemisphereSky),t)); hemisphere.groundColor.copy(a.set(DAY_NIGHT_CONFIG.day.hemisphereGround).lerp(b.set(DAY_NIGHT_CONFIG.night.hemisphereGround),t)); hemisphere.intensity=THREE.MathUtils.lerp(DAY_NIGHT_CONFIG.day.hemisphereIntensity,DAY_NIGHT_CONFIG.night.hemisphereIntensity,t);
    renderer.toneMappingExposure=THREE.MathUtils.lerp(DAY_NIGHT_CONFIG.day.exposure,DAY_NIGHT_CONFIG.night.exposure,t);
    if(lanternLight)lanternLight.intensity=DAY_NIGHT_CONFIG.night.lanternIntensity*t; if(lanternGlow)lanternGlow.material.opacity=.95*t;
    if(lanternRoot)lanternRoot.traverse(node=>{if(!node.isMesh||!node.material)return; const mats=Array.isArray(node.material)?node.material:[node.material]; mats.forEach(material=>{if('emissiveIntensity' in material)material.emissiveIntensity=.8*t;});});
    for(const entry of stoneEntries){const stoneT=THREE.MathUtils.clamp((progress*DAY_NIGHT_CONFIG.duration-entry.index*DAY_NIGHT_CONFIG.stoneDelay)/.28,0,1);
      const farT = stoneEntries.length <= 1 ? 0 : entry.index / (stoneEntries.length - 1);
      const stoneIntensity = THREE.MathUtils.lerp(DAY_NIGHT_CONFIG.night.stoneIntensity, DAY_NIGHT_CONFIG.night.stoneFarIntensity, farT);
      for(const material of entry.materials){if('emissive' in material)material.emissive.set(DAY_NIGHT_CONFIG.night.stone); if('emissiveIntensity' in material)material.emissiveIntensity=stoneT*stoneIntensity;}}
  }
  function toggle(){target=target>.5?0:1;}
  function update(delta){progress=THREE.MathUtils.damp(progress,target,6/DAY_NIGHT_CONFIG.duration,delta); if(Math.abs(progress-target)<.001)progress=target; apply(); fireflies.update(delta, progress);}
  function resetDay(){target=progress=0;apply(); fireflies.update(0, 0);}
  return {toggle,update,resetDay,setLantern,setStoneObjects,get progress(){return progress;},get isNight(){return target>.5||progress>.5;},get isTransitioning(){return Math.abs(progress-target)>.001;}};
}
