import * as THREE from 'three';

// 萤火虫参数：数量、颜色、大小、漂浮速度和闪烁周期集中在这里调整。
export const FIREFLY_COUNT = 50;
export const FIREFLY_COLOR = '#e8f59a';
export const FIREFLY_SIZE = 0.22; // 提高可见度，仍保持小光点效果
export const FIREFLY_DRIFT_SPEED = 0.28;
export const FIREFLY_DRIFT_AMPLITUDE = 0.08;
export const FIREFLY_BLINK_MIN_SECONDS = 2;
export const FIREFLY_BLINK_MAX_SECONDS = 4;
const ZONES = [
  { center: [-4.3, 2.4], radius: 1.8, count: 18 }, // 灯笼周围
  { center: [-2.4, -1.05], radius: 1.5, count: 12 }, // 树下
  { center: [2.4, -1.0], radius: 1.55, count: 20 }, // 苔藓窝边：增加密度并扩大环绕范围
];
const UP = new THREE.Vector3(0, 1, 0);

function createGlowTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const context = canvas.getContext('2d');
  const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, 'rgba(255,255,220,1)');
  gradient.addColorStop(0.22, 'rgba(232,245,154,.9)');
  gradient.addColorStop(1, 'rgba(232,245,154,0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, 64, 64);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function randomBetween(random, min, max) { return min + (max - min) * random(); }

export function createFireflies(scene) {
  let seed = 0x1f2e3d;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0x100000000;
  };
  const positions = new Float32Array(FIREFLY_COUNT * 3);
  const basePositions = new Float32Array(FIREFLY_COUNT * 3);
  const phases = new Float32Array(FIREFLY_COUNT);
  const blinkSpeeds = new Float32Array(FIREFLY_COUNT);
  const sizes = new Float32Array(FIREFLY_COUNT);
  let index = 0;
  for (const zone of ZONES) {
    for (let i = 0; i < zone.count && index < FIREFLY_COUNT; i += 1, index += 1) {
      const angle = random() * Math.PI * 2;
      const radius = Math.sqrt(random()) * zone.radius;
      const offset = index * 3;
      basePositions[offset] = zone.center[0] + Math.cos(angle) * radius;
      basePositions[offset + 1] = randomBetween(random, 0.3, 2.0);
      basePositions[offset + 2] = zone.center[1] + Math.sin(angle) * radius;
      positions[offset] = basePositions[offset];
      positions[offset + 1] = basePositions[offset + 1];
      positions[offset + 2] = basePositions[offset + 2];
      phases[index] = random() * Math.PI * 2;
      blinkSpeeds[index] = (Math.PI * 2) / randomBetween(random, FIREFLY_BLINK_MIN_SECONDS, FIREFLY_BLINK_MAX_SECONDS);
      sizes[index] = randomBetween(random, 0.7, 1.3);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
  geometry.setAttribute('aBlink', new THREE.BufferAttribute(new Float32Array(FIREFLY_COUNT), 1));
  const material = new THREE.ShaderMaterial({
    uniforms: { map: { value: createGlowTexture() }, color: { value: new THREE.Color(FIREFLY_COLOR) }, nightOpacity: { value: 0 } },
    vertexShader: `
      attribute float aSize;
      attribute float aBlink;
      varying float vBlink;
      void main() {
        vBlink = aBlink;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = aSize * ${FIREFLY_SIZE.toFixed(3)} * 280.0 / max(1.0, -mvPosition.z);
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: `
      uniform sampler2D map;
      uniform vec3 color;
      uniform float nightOpacity;
      varying float vBlink;
      void main() {
        vec4 sprite = texture2D(map, gl_PointCoord);
        float alpha = sprite.a * nightOpacity * vBlink;
        gl_FragColor = vec4(color * (1.15 + 0.85 * vBlink), alpha);
      }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: true,
  });
  const points = new THREE.Points(geometry, material);
  points.name = '夜景 · 萤火虫';
  points.frustumCulled = false;
  scene.add(points);
  const blink = geometry.getAttribute('aBlink');
  let time = 0;
  function update(delta, nightProgress) {
    time += delta;
    material.uniforms.nightOpacity.value = nightProgress;
    for (let i = 0; i < FIREFLY_COUNT; i += 1) {
      const offset = i * 3;
      const phase = phases[i] + time * FIREFLY_DRIFT_SPEED;
      positions[offset] = basePositions[offset] + Math.sin(phase * 0.73) * FIREFLY_DRIFT_AMPLITUDE;
      positions[offset + 1] = basePositions[offset + 1] + Math.sin(phase) * FIREFLY_DRIFT_AMPLITUDE * 0.7;
      positions[offset + 2] = basePositions[offset + 2] + Math.cos(phase * 0.61) * FIREFLY_DRIFT_AMPLITUDE;
      blink.setX(i, 0.18 + 0.82 * (0.5 + 0.5 * Math.sin(phases[i] + time * blinkSpeeds[i])));
    }
    geometry.attributes.position.needsUpdate = true;
    blink.needsUpdate = true;
  }
  function dispose() {
    scene.remove(points);
    geometry.dispose();
    material.uniforms.map.value.dispose();
    material.dispose();
  }
  return { points, update, dispose };
}
