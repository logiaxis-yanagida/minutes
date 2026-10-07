import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createDictation, isVoiceSupported, toErrorMessage } from '../js/voice.js';

let instances = [];

class FakeRecognition {
  constructor() {
    this.started = false;
    instances.push(this);
  }
  start() {
    this.started = true;
  }
  stop() {
    queueMicrotask(() => this.end());
  }
  abort() {}
  end() {
    this.started = false;
    this.onend?.();
  }
  emit(resultIndex, results) {
    const list = results.map(([transcript, isFinal]) => Object.assign([{ transcript }], { isFinal }));
    this.onresult?.({ resultIndex, results: list });
  }
  error(code) {
    this.onerror?.({ error: code });
  }
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function setup(options = {}) {
  const log = { interim: [], final: [], state: [], errors: [] };
  const d = createDictation({
    onInterim: (t) => log.interim.push(t),
    onFinal: (t) => log.final.push(t),
    onStateChange: (on) => log.state.push(on),
    onError: (code, msg) => log.errors.push([code, msg]),
    isIOS: false,
    restartDelayMs: 5,
    ...options,
  });
  return { d, log };
}

beforeEach(() => {
  instances = [];
  globalThis.SpeechRecognition = FakeRecognition;
});

afterEach(() => {
  delete globalThis.SpeechRecognition;
});

test('isVoiceSupported / toErrorMessage', () => {
  assert.equal(isVoiceSupported(), true);
  assert.equal(toErrorMessage('not-allowed'), 'マイクの使用が許可されていません');
  assert.equal(toErrorMessage('xyz'), '認識エラー(xyz)');
  delete globalThis.SpeechRecognition;
  assert.equal(isVoiceSupported(), false);
});

test('確定結果は重複せず、interim は未確定分のみ', () => {
  const { d, log } = setup();
  d.start();
  const rec = instances[0];
  assert.equal(rec.lang, 'ja-JP');
  assert.equal(rec.continuous, true);
  assert.equal(rec.interimResults, true);
  rec.emit(0, [['こんにち', false]]);
  rec.emit(0, [['こんにちは', true]]);
  rec.emit(0, [['こんにちは', true], ['今日は', false]]);
  rec.emit(1, [['こんにちは', true], ['今日は晴れ', true]]);
  rec.emit(0, [['こんにちは', true], ['今日は晴れ', true]]);
  assert.deepEqual(log.final, ['こんにちは', '今日は晴れ']);
  assert.ok(log.interim.includes('こんにち'));
  assert.ok(log.interim.includes('今日は'));
  assert.equal(log.interim.at(-1), '');
  assert.deepEqual(log.state, [true]);
});

test('onend で自動再開し、stop で停止する', async () => {
  const { d, log } = setup();
  d.start();
  instances[0].emit(0, [['一つ目', true]]);
  instances[0].end();
  assert.equal(d.isListening(), true);
  await wait(20);
  assert.equal(instances.length, 2);
  assert.equal(instances[1].started, true);
  instances[1].emit(0, [['二つ目', true]]);
  assert.deepEqual(log.final, ['一つ目', '二つ目']);
  d.stop();
  await wait(20);
  assert.equal(d.isListening(), false);
  assert.equal(instances.length, 2);
  assert.deepEqual(log.state, [true, false]);
});

test('no-speech は1回だけ通知して再開し、aborted は無視する', async () => {
  const { d, log } = setup();
  d.start();
  instances[0].error('no-speech');
  instances[0].error('aborted');
  instances[0].end();
  await wait(20);
  assert.equal(instances.length, 2);
  instances[1].error('no-speech');
  instances[1].end();
  await wait(20);
  assert.equal(instances.length, 3);
  assert.deepEqual(log.errors.map((e) => e[0]), ['no-speech']);
  d.stop();
  await wait(5);
});

test('致命的エラーでは再開しない', async () => {
  const { d, log } = setup();
  d.start();
  instances[0].error('not-allowed');
  instances[0].end();
  await wait(20);
  assert.equal(instances.length, 1);
  assert.equal(d.isListening(), false);
  assert.deepEqual(log.errors, [['not-allowed', 'マイクの使用が許可されていません']]);
  assert.deepEqual(log.state, [true, false]);
});

test('結果のないまま即終了が5回続くと restart-failed で打ち切る', async () => {
  const { d, log } = setup();
  d.start();
  for (let i = 0; i < 10 && d.isListening(); i += 1) {
    instances.at(-1).end();
    await wait(15);
  }
  assert.equal(d.isListening(), false);
  assert.equal(instances.length, 5);
  assert.equal(log.errors.at(-1)[0], 'restart-failed');
  assert.deepEqual(log.state, [true, false]);
});

test('iOS では continuous=false', () => {
  const { d } = setup({ isIOS: true });
  d.start();
  assert.equal(instances[0].continuous, false);
  d.stop();
});

test('再開待ちの間に stop すると即停止', async () => {
  const { d, log } = setup({ restartDelayMs: 50 });
  d.start();
  instances[0].end();
  d.stop();
  await wait(80);
  assert.equal(instances.length, 1);
  assert.deepEqual(log.state, [true, false]);
});
