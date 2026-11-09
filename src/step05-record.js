import { Vector3 } from 'three';
// 开发验收辅助：仅在 ?record=1 时显示；录制真实画布；collision 模式使用标注清楚的脚本分段演示。
export function addRecordingButton(canvas, demoContext) {
  const collision = new URLSearchParams(location.search).has("collision");
  const rest = new URLSearchParams(location.search).has("rest");
  const params = new URLSearchParams(location.search);
  const jumpPose = params.has('jumpPose');
  const seconds = rest ? 35 : collision ? 15 : jumpPose ? 30 : params.has('jump') ? 11 : 16;
  const button = document.createElement('button');
  button.textContent = `录制 ${seconds} 秒演示`;
  Object.assign(button.style, { position: 'fixed', top: '24px', right: '24px', zIndex: '20' });
  document.body.append(button);
  button.onclick = async () => {
    let stopDemo;
    if(collision) { const {startCollisionDemo}=await import("./collision-demo.js");stopDemo=startCollisionDemo(demoContext()); }
    // 把脚本演示说明一起写进录像，避免 HTML 提示未被 captureStream 捕获。
    let recordingCanvas = canvas, frame;
    if (jumpPose) {
      const sheet = document.createElement('canvas');
      sheet.width = 1600; sheet.height = 400;
      const sctx = sheet.getContext('2d');
      const labels = ['蓄力', '起跳', '最高点', '落地前', '落地压扁'];
      const captured = new Set();
      const drawSheet = () => {
        const state = demoContext().controller?.state;
        if (!state || state.jumpCount !== 1) return;
        const phase = state.jumpPhase, t = state.phaseTime, pitch = state.jumpPose?.pitch ?? 0;
        let index = -1;
        if (phase === 'charge' && t >= .13) index = 0;
        else if (phase === 'air' && t >= .06 && t < .15) index = 1;
        else if (phase === 'air' && t >= .27 && t <= .34) index = 2;
        else if (phase === 'air' && t > .48) index = 3;
        else if (phase === 'land' && t >= .035 && t < .10) index = 4;
        if (index < 0 || captured.has(index)) return;
        captured.add(index);
        const w = sheet.width / 5, h = sheet.height;
        sctx.fillStyle = '#fffdf0'; sctx.fillRect(index*w,0,w,h);
        const center = new Vector3(...state.position); center.y += .65; center.project(demoContext().camera);
        const size = Math.min(canvas.width, canvas.height) * .32;
        const cx = (center.x*.5+.5)*canvas.width, cy = (-center.y*.5+.5)*canvas.height;
        sctx.drawImage(canvas,cx-size/2,cy-size/2,size,size,index*w,48,w,w);
        sctx.fillStyle = '#354c36'; sctx.font = '28px sans-serif'; sctx.fillText(labels[index],index*w+18,38);
      };
      canvas.addEventListener('record-frame', drawSheet);
      frame = () => { canvas.removeEventListener('record-frame', drawSheet); if (captured.size === 5) { const a=document.createElement('a'); a.href=sheet.toDataURL('image/png'); a.download='workshop3-jump-pose-sequence-detail.png'; a.click(); } };
    }
    if (collision || rest) {
      recordingCanvas = document.createElement('canvas');
      recordingCanvas.width = canvas.width; recordingCanvas.height = canvas.height;
      const ctx = recordingCanvas.getContext('2d');
      const draw = () => {
        ctx.drawImage(canvas, 0, 0);
        const scale = Math.max(1, canvas.width / 1440);
        ctx.font = `${24 * scale}px sans-serif`;
        ctx.fillStyle = 'rgba(255,253,240,.95)'; ctx.fillRect(20*scale,20*scale,550*scale,54*scale);
        ctx.fillStyle = '#354c36';
        ctx.fillText(rest ? `真实键鼠操作 · ${demoContext().controller?.state.restPhase ?? ''} · ${document.querySelector('#rest-prompt:not([hidden])')?.textContent ?? ''}` : document.querySelector('[data-collision-caption]')?.textContent ?? '脚本分段碰撞演示', 32*scale,56*scale);

      };
      canvas.addEventListener("record-frame", draw);
      frame = () => canvas.removeEventListener("record-frame", draw);
    }
    const stream = recordingCanvas.captureStream(30);
    const recorder = new MediaRecorder(stream, { mimeType: 'video/webm' });
    const chunks = [];
    recorder.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
    recorder.onstop = () => {
      frame?.(); stopDemo?.();
      const link = document.createElement('a');
      const url = URL.createObjectURL(new Blob(chunks, { type: 'video/webm' }));
      link.href = url; link.download = `workshop3-${rest ? 'step07-rest-keyboard' : collision ? 'step06-collision' : jumpPose ? 'step07-jump-pose-keyboard-final' : seconds === 11 ? 'step06-jump' : 'step05'}-demo.webm`; link.click();
      stream.getTracks().forEach(track => track.stop());
      button.textContent = '录屏已下载'; button.disabled = false;
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    };
    recorder.start(); button.textContent = `正在录制（${seconds} 秒）`; button.disabled = true;
    setTimeout(() => recorder.stop(), seconds * 1000);
  };
}
