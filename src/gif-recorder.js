const CLIPS = {
  'w03-s04-idle': [6, '白天全景，不碰键盘，芽芽原地摇尾巴'],
  'w03-s05-wasd': [12, '按 W 走 → 拖动镜头转一下再按 W → W+D 斜走 → 按住 Shift 跑 → 松手停下'],
  'w03-s06-jump-side': [8, '镜头转到芽芽侧面，原地跳 2 次，再边走边跳 1 次'],
  'w03-s07-nest-rest': [18, '走到苔藓窝 → 出现提示后按 E → 趴下 → 拖动镜头从侧面看 → 按 W 起身跳出'],
  'w03-s07-lantern-night': [14, '走到灯笼 → 出现提示后按 E → 停在原地看夜景 → 走两步'],
};

export function addGifRecorder() {
  if (!import.meta.env.DEV) return;
  const id = new URLSearchParams(location.search).get('gif');
  if (!Object.hasOwn(CLIPS, id) || document.querySelector('[data-gif-recorder]')) return;
  const [seconds, instructions] = CLIPS[id];
  const panel = document.createElement('div');
  panel.dataset.gifRecorder = '';
  Object.assign(panel.style, { position: 'fixed', top: '16px', right: '16px', zIndex: '10000', maxWidth: '420px', padding: '12px', borderRadius: '10px', background: '#fffdeef2', color: '#253c2b', font: '14px/1.5 sans-serif' });
  const button = document.createElement('button');
  const note = document.createElement('div');
  note.style.fontSize = '12px';
  note.textContent = `${seconds} 秒 · ${instructions}。请选择当前标签页；录制时 Esc 提前停止。`;
  const status = document.createElement('div');
  status.setAttribute('role', 'status');
  panel.append(button, note, status);
  document.body.append(panel);
  let stream, recorder, timer, countdown, pending = false;
  const reset = () => {
    clearTimeout(timer); clearInterval(countdown);
    stream?.getTracks().forEach(track => track.stop());
    stream = undefined; recorder = undefined; pending = false;
    panel.style.display = ''; button.disabled = false;
    button.textContent = `开始录制 ${id}`;
  };
  const stop = () => {
    if (recorder?.state === 'recording') {
      clearTimeout(timer);
      recorder.stop();
    } else if (pending && stream) {
      reset(); status.textContent = '已取消录制。';
    }
  };
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') stop();
  });
  window.addEventListener('pagehide', () => {
    clearTimeout(timer); clearInterval(countdown);
    stream?.getTracks().forEach(track => track.stop());
  });
  reset();
  button.onclick = async () => {
    if (recorder?.state === 'recording' || (pending && stream)) { stop(); return; }
    if (pending) return;
    pending = true; button.disabled = true; status.textContent = '';
    try {
      if (!navigator.mediaDevices?.getDisplayMedia || typeof MediaRecorder === 'undefined') {
        throw new Error('此浏览器不支持标签页录制，请使用支持屏幕共享的桌面浏览器。');
      }
      stream = await navigator.mediaDevices.getDisplayMedia({ video: true, preferCurrentTab: true });
      const track = stream.getVideoTracks()[0];
      const surface = track?.getSettings().displaySurface;
      if (!track || (surface && surface !== 'browser')) {
        throw new Error('请选择当前标签页，不要选择窗口或整个屏幕，以免录入书签栏。');
      }
      const mimeType = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find(type => MediaRecorder.isTypeSupported(type));
      if (!mimeType) throw new Error('此浏览器不能录制 WebM，请换用支持 WebM 的桌面浏览器。');
      recorder = new MediaRecorder(stream, { mimeType });
      const chunks = [];
      let recordingError;
      recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      recorder.onerror = event => { recordingError = event.error?.message || '录制器发生错误'; stop(); };
      recorder.onstop = () => {
        const blob = new Blob(chunks, { type: mimeType });
        reset();
        if (recordingError || !blob.size) { status.textContent = `未保存：${recordingError || '录像为空'}，请重试。`; return; }
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url; link.download = `${id}.webm`;
        document.body.append(link); link.click(); link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 60000);
        status.textContent = `已发起下载 ${id}.webm；请检查下载文件夹。`;
      };
      track.addEventListener('ended', stop, { once: true });
      let remaining = 3;
      button.disabled = false;
      button.textContent = `${remaining} 秒后开始（点击取消）`;
      button.blur();
      countdown = setInterval(() => {
        remaining -= 1;
        if (remaining > 0) { button.textContent = `${remaining} 秒后开始（点击取消）`; return; }
        clearInterval(countdown);
        panel.style.display = 'none';
        // Give the compositor time to remove the controls before capturing the first frame.
        timer = setTimeout(() => {
          try {
            if (track.readyState !== 'live') throw new Error('共享已经停止，请重试。');
            recorder.start(250);
            pending = false;
            timer = setTimeout(stop, seconds * 1000);
          } catch (error) { reset(); status.textContent = error.message; }
        }, 150);
      }, 1000);
    } catch (error) {
      reset();
      status.textContent = error.name === 'NotAllowedError' ? '已取消共享或未授予权限；点击可重试。' : `无法录制：${error.message}`;
    }
  };
}
