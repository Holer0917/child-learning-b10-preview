import { read, write, isAvailable } from '../../core/storage.js';

// 当前浏览器/地址共用的偏好，沿用 SRS 备份中的 settings.sound 字段。
const PREFERENCE_KEY = 'settings';
let soundPreference;

/** 连对只按题序统计首次作答；订正、跳过和未答不能补进连对。 */
export function consecutiveCorrect(session) {
  let count = 0;
  for (let i = session.cursor; i >= 0; i--) {
    const a = session.attempts[session.paper.questions[i].id];
    if (!a?.correct || a.skipped) break;
    count++;
  }
  return count;
}

/** 仅管理提示音，不读写成绩；所有异步失败均降级到页面原有文字反馈。 */
export function createAnswerFeedback(onChange = () => {}) {
  soundPreference ??= read(PREFERENCE_KEY, null)?.sound === true;
  let context = null, disposed = false, generation = 0, voices = [];
  let storageWarning = '', audioWarning = '';
  const state = () => ({ enabled: soundPreference, message: [storageWarning, audioWarning].filter(Boolean).join(' ') });
  const notify = () => { if (!disposed) onChange(state()); };
  function stop() {
    generation++;
    for (const { oscillator, gain } of voices) {
      try { oscillator.stop(); } catch { /* 已自然结束。 */ }
      oscillator.disconnect(); gain.disconnect();
    }
    voices = [];
  }
  function unavailable() {
    audioWarning = '提示音暂不可用，可关闭后重新开启；文字反馈和答题不受影响。';
    notify();
  }
  // 只能从开关或提交的真实交互调用；初次渲染/恢复/自动切题不创建 AudioContext。
  function prepare() {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) throw new Error('当前浏览器不支持提示音');
    context ??= new AudioContext();
    return context;
  }
  function resume(audio, success, token) {
    const requestedAt = performance.now();
    const ready = () => {
      if (disposed || !soundPreference || generation !== token || document.hidden) return;
      if (audio.state !== 'running' || performance.now() - requestedAt > 400) { unavailable(); return; }
      audioWarning = ''; notify(); success();
    };
    if (audio.state === 'running') ready();
    else Promise.resolve(audio.resume()).then(ready).catch(() => {
      if (!disposed && generation === token && soundPreference) unavailable();
    });
  }
  function setSoundEnabled(enabled) {
    stop();
    soundPreference = enabled === true;
    const previous = read(PREFERENCE_KEY, null);
    const settings = previous && typeof previous === 'object' && !Array.isArray(previous) ? previous : {};
    storageWarning = write(PREFERENCE_KEY, { ...settings, sound: soundPreference }) && isAvailable()
      ? '' : '音效设置仅在本次打开期间有效，刷新后可能恢复原设置。';
    audioWarning = ''; notify();
    if (!soundPreference || disposed || document.hidden) return;
    try { resume(prepare(), () => {}, generation); } catch { unavailable(); }
  }
  function play(correct) {
    stop();
    if (!soundPreference || disposed || document.hidden) return;
    const token = generation;
    try {
      const audio = prepare();
      resume(audio, () => {
        try {
          // 正确为轻柔上行双音，错误为单个低音；无外部音频或网络请求。
          const notes = correct ? [660, 880] : [220];
          notes.forEach((frequency, index) => {
            const oscillator = audio.createOscillator(), gain = audio.createGain();
            const start = audio.currentTime + index * 0.09, end = start + 0.08;
            oscillator.type = 'sine'; oscillator.frequency.setValueAtTime(frequency, start);
            gain.gain.setValueAtTime(0, start);
            gain.gain.linearRampToValueAtTime(0.04, start + 0.01);
            gain.gain.linearRampToValueAtTime(0, end);
            oscillator.connect(gain); gain.connect(audio.destination);
            const voice = { oscillator, gain }; voices.push(voice);
            oscillator.onended = () => {
              oscillator.disconnect(); gain.disconnect();
              voices = voices.filter(item => item !== voice);
            };
            oscillator.start(start); oscillator.stop(end);
          });
        } catch { stop(); unavailable(); }
      }, token);
    } catch { unavailable(); }
  }
  const onVisibility = () => { if (document.hidden) stop(); };
  document.addEventListener('visibilitychange', onVisibility);
  return { state, setSoundEnabled, play, stop,
    dispose() {
      disposed = true; stop(); document.removeEventListener('visibilitychange', onVisibility);
      if (context && context.state !== 'closed') {
        try { Promise.resolve(context.close()).catch(() => {}); } catch { /* 关闭失败也不影响离页。 */ }
      }
    }
  };
}
