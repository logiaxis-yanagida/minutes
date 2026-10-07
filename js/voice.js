const ERROR_MESSAGES = {
  'not-allowed': 'マイクの使用が許可されていません',
  'service-not-allowed': 'マイクの使用が許可されていません',
  'no-speech': '音声が検出されませんでした',
  network: 'ネットワークエラーです',
  'audio-capture': 'マイクが見つかりません',
  aborted: '中断されました',
  'not-supported': 'このブラウザは音声入力に対応していません',
  'start-failed': '音声認識を開始できませんでした',
  'restart-failed': '音声認識が繰り返し停止したため、音声入力を終了しました',
};

const FATAL_ERRORS = new Set(['not-allowed', 'service-not-allowed', 'audio-capture']);
const IGNORED_ERRORS = new Set(['no-speech', 'aborted']);
const RESTART_DELAY_MS = 250;
const QUICK_END_MS = 1000;
const MAX_FAILED_RESTARTS = 5;

function detectIOS() {
  const nav = globalThis.navigator;
  if (!nav) return false;
  return /iP(hone|ad|od)/.test(nav.userAgent || '') || (nav.platform === 'MacIntel' && nav.maxTouchPoints > 1);
}

export const IS_IOS = detectIOS();

let micGranted = false;

export async function ensureMicPermission() {
  const media = globalThis.navigator?.mediaDevices;
  if (micGranted || !media?.getUserMedia) return;
  const stream = await media.getUserMedia({ audio: true });
  stream.getTracks().forEach((t) => t.stop());
  micGranted = true;
}

function getRecognitionClass() {
  return globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition || null;
}

export function toErrorMessage(code) {
  return ERROR_MESSAGES[code] || `認識エラー(${code})`;
}

export function isVoiceSupported() {
  return getRecognitionClass() !== null;
}

export function createDictation({
  onInterim,
  onFinal,
  onStateChange,
  onError,
  lang = 'ja-JP',
  isIOS = IS_IOS,
  restartDelayMs = RESTART_DELAY_MS,
} = {}) {
  let listening = false;
  let stopRequested = false;
  let fatal = false;
  let current = null;
  let restartTimer = null;
  let failedRestarts = 0;
  let lastErrorCode = null;
  let lastInterim = '';

  const call = (fn, ...args) => {
    if (typeof fn !== 'function') return;
    try {
      fn(...args);
    } catch (e) {
      console.error(e);
    }
  };

  const emitError = (code) => call(onError, code, toErrorMessage(code));

  const emitInterim = (text) => {
    if (text === lastInterim) return;
    lastInterim = text;
    call(onInterim, text);
  };

  const finish = () => {
    if (!listening) return;
    listening = false;
    if (restartTimer) {
      clearTimeout(restartTimer);
      restartTimer = null;
    }
    const rec = current;
    current = null;
    if (rec) {
      try {
        rec.abort?.();
      } catch {}
    }
    emitInterim('');
    call(onStateChange, false);
  };

  const scheduleRestart = () => {
    if (failedRestarts >= MAX_FAILED_RESTARTS) {
      emitError('restart-failed');
      finish();
      return;
    }
    restartTimer = setTimeout(() => {
      restartTimer = null;
      if (!listening || stopRequested) return;
      launch();
    }, restartDelayMs);
  };

  function launch() {
    const Recognition = getRecognitionClass();
    if (!Recognition) {
      emitError('not-supported');
      finish();
      return;
    }
    const rec = new Recognition();
    const session = { startedAt: Date.now(), gotResult: false, nextFinalIndex: 0 };
    rec.lang = lang;
    rec.interimResults = true;
    rec.continuous = !isIOS;
    rec.maxAlternatives = 1;

    rec.onresult = (event) => {
      if (rec !== current) return;
      const results = event?.results || [];
      const from = Math.max(0, Number(event?.resultIndex) || 0);
      let interim = '';
      for (let i = from; i < results.length; i += 1) {
        const res = results[i];
        const text = res?.[0]?.transcript || '';
        if (res?.isFinal) {
          if (i >= session.nextFinalIndex) {
            session.nextFinalIndex = i + 1;
            const finalText = text.trim();
            if (finalText) {
              session.gotResult = true;
              call(onFinal, finalText);
            }
          }
        } else {
          interim += text;
        }
      }
      interim = interim.trim();
      if (interim) session.gotResult = true;
      if (session.gotResult) {
        failedRestarts = 0;
        lastErrorCode = null;
      }
      emitInterim(interim);
    };

    rec.onerror = (event) => {
      if (rec !== current) return;
      const code = event?.error || 'unknown';
      if (IGNORED_ERRORS.has(code)) return;
      if (FATAL_ERRORS.has(code)) {
        fatal = true;
        emitError(code);
        return;
      }
      if (code !== lastErrorCode) {
        lastErrorCode = code;
        emitError(code);
      }
    };

    rec.onend = () => {
      if (rec !== current) return;
      current = null;
      emitInterim('');
      if (stopRequested || fatal || !listening) {
        finish();
        return;
      }
      if (!session.gotResult && Date.now() - session.startedAt < QUICK_END_MS) failedRestarts += 1;
      else failedRestarts = 0;
      scheduleRestart();
    };

    current = rec;
    try {
      rec.start();
    } catch {
      current = null;
      failedRestarts += 1;
      scheduleRestart();
    }
  }

  return {
    start() {
      if (listening) return;
      if (!getRecognitionClass()) {
        emitError('not-supported');
        return;
      }
      listening = true;
      stopRequested = false;
      fatal = false;
      failedRestarts = 0;
      lastErrorCode = null;
      lastInterim = '';
      call(onStateChange, true);
      launch();
    },
    stop() {
      if (!listening) return;
      stopRequested = true;
      if (restartTimer) {
        clearTimeout(restartTimer);
        restartTimer = null;
      }
      const rec = current;
      if (!rec) {
        finish();
        return;
      }
      try {
        rec.stop();
      } catch {
        finish();
      }
    },
    isListening() {
      return listening;
    },
  };
}
