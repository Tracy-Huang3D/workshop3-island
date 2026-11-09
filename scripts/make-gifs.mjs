import { spawnSync } from 'node:child_process';
import { readdir, mkdir, mkdtemp, stat, rm, rename } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw new Error(`${command} 失败：${result.error?.message || result.stderr}`);
  return result.stdout;
}
const output = fileURLToPath(new URL('../docs/workshop03/media/', import.meta.url));
const raw = join(output, 'raw');
const limit = 8 * 1024 * 1024;

async function main() {
  // Check tools before creating directories or processing any recordings. Never install tools.
  const check = spawnSync('ffmpeg', ['-version'], { encoding: 'utf8' });
  if (check.error || check.status !== 0) throw new Error('未找到可用的 ffmpeg，已停止。请由你决定是否安装；本脚本不会安装。');
  const probe = spawnSync('ffprobe', ['-version'], { encoding: 'utf8' });
  if (probe.error || probe.status !== 0) throw new Error('未找到可用的 ffprobe，无法验证时长和尺寸，已停止；不会自动安装。');
  await mkdir(raw, { recursive: true });
  const files = (await readdir(raw)).filter(name => name.toLowerCase().endsWith('.webm')).sort();
  if (!files.length) { console.log(`没有 WebM 文件。请把下载文件放入：\n${raw}`); return; }
  const results = [];
  let failed = false;
  for (const name of files) {
    const temp = await mkdtemp(join(tmpdir(), 'w03-gif-'));
    try {
      const source = join(raw, name);
      const palette = join(temp, 'palette.png');
      const gif = join(temp, 'result.gif');
      let fps = 12;
      const encode = (rate, width) => {
        const filter = `fps=${rate},scale=${width}:-1:flags=lanczos`;
        run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', source, '-vf', `${filter},palettegen=stats_mode=diff`, '-frames:v', '1', '-update', '1', palette]);
        run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', source, '-i', palette, '-filter_complex', `[0:v]${filter}[video];[video][1:v]paletteuse=dither=sierra2_4a`, '-an', '-loop', '0', gif]);
      };
      encode(12, 960);
      if ((await stat(gif)).size > limit) {
        console.log(`${name} 超过 8 MiB，重试 10 fps / 800 宽…`);
        fps = 10; encode(10, 800);
      }
      const info = JSON.parse(run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height:format=duration', '-of', 'json', gif]));
      const bytes = (await stat(gif)).size;
      const destination = join(output, name.replace(/\.webm$/i, '.gif'));
      // Copy into the destination filesystem, then atomically replace an older output.
      const { copyFile } = await import('node:fs/promises');
      const staged = join(output, `.${name}.tmp-${process.pid}`);
      try { await copyFile(gif, staged); await rename(staged, destination); }
      finally { await rm(staged, { force: true }); }
      results.push({ 文件: name.replace(/\.webm$/i, '.gif'), '时长(s)': Number(info.format.duration).toFixed(2), 尺寸: `${info.streams[0].width}×${info.streams[0].height}`, fps, 字节: bytes, '体积(MiB)': (bytes / 1024 / 1024).toFixed(2), 状态: bytes > limit ? '仍超过 8 MiB，请缩短录像' : '完成' });
    } catch (error) { failed = true; console.error(`${name}: ${error.message}`); }
    finally { await rm(temp, { recursive: true, force: true }); }
  }
  console.table(results);
  console.log(`输出目录：${output}`);
  if (failed) process.exitCode = 1;
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
