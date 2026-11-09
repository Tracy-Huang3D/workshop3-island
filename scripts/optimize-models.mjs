import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, simplify, textureCompress, weld } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const targets = JSON.parse(fs.readFileSync(path.join(root, 'scripts/model-targets.json'), 'utf8'));
const logPath = path.join(root, 'docs/model-optimization-log.md');
const outputDir = path.join(root, 'public/models/optimized');
const args = process.argv.slice(2);
if (args.length > 1 || (args[0] && !targets.some(t => t.file === args[0]))) {
  console.error('Usage: node scripts/optimize-models.mjs [filename.glb]\nyaya-rigged.glb is intentionally excluded.');
  process.exit(1);
}
await Promise.all([MeshoptDecoder.ready, MeshoptSimplifier.ready]);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
fs.mkdirSync(outputDir, { recursive: true });
fs.mkdirSync(path.dirname(logPath), { recursive: true });
if (!fs.existsSync(logPath)) fs.writeFileSync(logPath, '# Model optimization log\n\nTriangle counts are unique mesh geometry, not scene instances or shadow passes. Sizes are exact bytes. Inputs remain untouched. Completed rows are checkpoints; default runs skip them. An explicit filename reruns that model.\n\n| File | Original triangles | New triangles | Original bytes | New bytes | Seconds | Completed UTC |\n| --- | ---: | ---: | ---: | ---: | ---: | --- |\n');
const completed = new Set([...fs.readFileSync(logPath, 'utf8').matchAll(/^\| ([^|]+\.glb) \|/gm)].map(m => m[1]));
function triangles(doc) {
  let total = 0;
  for (const mesh of doc.getRoot().listMeshes()) for (const prim of mesh.listPrimitives()) {
    const count = (prim.getIndices() ?? prim.getAttribute('POSITION')).getCount();
    const mode = prim.getMode();
    if (mode === 4) total += count / 3;
    else if (mode === 5 || mode === 6) total += Math.max(0, count - 2);
    else throw new Error(`Unsupported primitive mode ${mode}`);
  }
  return total;
}
async function validate(doc, limit) {
  const count = triangles(doc);
  if (!Number.isInteger(count) || count < 1 || count > limit) throw new Error(`Triangle target unmet: ${count} > ${limit}`);
  for (const texture of doc.getRoot().listTextures()) {
    const { width, height } = await sharp(texture.getImage()).metadata();
    if (!width || !height || width > 1024 || height > 1024) throw new Error(`Texture exceeds 1024: ${width}x${height}`);
  }
  return count;
}
for (const target of targets) {
  if (args[0] && args[0] !== target.file) continue;
  if (!args[0] && completed.has(target.file)) { console.log(`SKIP ${target.file}`); continue; }
  const input = path.join(root, 'public/models', target.file);
  const output = path.join(outputDir, target.file);
  const temporary = path.join(outputDir, `.${target.file}.pending.glb`);
  try {
    const start = performance.now();
    console.log(`START ${target.file} → <= ${target.triangles} triangles`);
    const originalBytes = fs.statSync(input).size;
    const doc = await io.read(input);
    const originalTriangles = triangles(doc);
    if (doc.getRoot().listSkins().length) throw new Error('Skinned assets require a separate workflow.');
    await doc.transform(dedup(), weld());
    for (const error of [0.001, 0.01, 0.05, 0.1, 1]) {
      const current = triangles(doc);
      if (current <= target.triangles) break;
      await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio: Math.min(1, (target.triangles - 10) / current), error }));
      console.log(`  error=${error}: ${triangles(doc)} triangles`);
    }
    await doc.transform(prune(), textureCompress({ encoder: sharp, resize: [1024, 1024] }));
    await validate(doc, target.triangles);
    await io.write(temporary, doc);
    const result = await io.read(temporary);
    const newTriangles = await validate(result, target.triangles);
    const newBytes = fs.statSync(temporary).size;
    fs.renameSync(temporary, output);
    const seconds = ((performance.now() - start) / 1000).toFixed(2);
    const row = `| ${target.file} | ${originalTriangles} | ${newTriangles} | ${originalBytes} | ${newBytes} | ${seconds} | ${new Date().toISOString()} |\n`;
    fs.appendFileSync(logPath, row);
    console.log(row.trim());
  } catch (error) {
    fs.appendFileSync(logPath, `\n<!-- FAILED ${new Date().toISOString()} ${target.file}: ${String(error.message).replaceAll('--', '—')} -->\n`);
    console.error(`STOP ${target.file}: ${error.message}. Completed checkpoints remain in ${logPath}`);
    process.exitCode = 1;
    break;
  }
}
