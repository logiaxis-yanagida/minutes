import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sendTasks, readTaskappCategories, buildMemo } from '../js/taskbridge.js';

function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, String(v)),
    removeItem: (k) => data.delete(k),
  };
}

const meeting = {
  id: 'm1',
  title: '定例MTG',
  start: new Date(2026, 9, 7, 10, 0).toISOString(),
};
const settings = { taskappIntegration: { enabled: true, defaultCategoryId: 'cat-1' } };

test('buildMemo: 担当ありなし', () => {
  assert.equal(buildMemo(meeting, { assignee: '田中' }), '元会議：定例MTG（2026/10/07）／担当：田中');
  assert.equal(buildMemo(meeting, { assignee: '' }), '元会議：定例MTG（2026/10/07）');
});

test('sendTasks: 未送信のみ inbox に追記し、Drive 未サインインならファイルを作らない', async () => {
  const storage = memoryStorage();
  const created = [];
  const drive = { createFile: async (name, obj) => created.push({ name, obj }) };
  const google = { isSignedIn: () => false };
  const tasks = [
    { id: 't1', title: '資料作成', assignee: '田中', due: '2026-10-10', sentToTaskapp: false },
    { id: 't2', title: '送信済み', assignee: '', due: null, sentToTaskapp: true },
  ];
  const res = await sendTasks(meeting, tasks, settings, { google, drive, storage });
  assert.deepEqual(res.sent.map((t) => t.id), ['t1']);
  assert.equal(res.driveOk, true);
  assert.equal(created.length, 0);
  const inbox = JSON.parse(storage.getItem('minutes.taskappInbox'));
  assert.equal(inbox.length, 1);
  const item = inbox[0];
  assert.equal(item.id, 't1');
  assert.equal(item.title, '資料作成');
  assert.equal(item.due, '2026-10-10');
  assert.equal(item.memo, '元会議：定例MTG（2026/10/07）／担当：田中');
  assert.equal(item.categoryId, 'cat-1');
  assert.equal(item.source, 'minutes');
  assert.equal(item.meetingId, 'm1');
  assert.equal(typeof item.createdAt, 'string');
});

test('sendTasks: 同じ id は重複しない', async () => {
  const storage = memoryStorage();
  const task = { id: 't1', title: 'A', assignee: '', due: null, sentToTaskapp: false };
  await sendTasks(meeting, [task], settings, { google: null, drive: null, storage });
  await sendTasks(meeting, [{ ...task, title: 'A2' }], settings, { google: null, drive: null, storage });
  const inbox = JSON.parse(storage.getItem('minutes.taskappInbox'));
  assert.equal(inbox.length, 1);
  assert.equal(inbox[0].title, 'A2');
});

test('sendTasks: サインイン済みなら1タスク1ファイルを作成、失敗時は driveOk=false だが inbox は書く', async () => {
  const storage = memoryStorage();
  const created = [];
  const drive = {
    createFile: async (name, obj) => {
      if (obj.id === 't2') throw new Error('fail');
      created.push({ name, obj });
      return 'fid';
    },
  };
  const google = { isSignedIn: () => true };
  const tasks = [
    { id: 't1', title: 'A', assignee: '', due: null, sentToTaskapp: false },
    { id: 't2', title: 'B', assignee: '', due: null, sentToTaskapp: false },
  ];
  const origError = console.error;
  console.error = () => {};
  let res;
  try {
    res = await sendTasks(meeting, tasks, { taskappIntegration: { defaultCategoryId: null } }, { google, drive, storage });
  } finally {
    console.error = origError;
  }
  assert.equal(res.driveOk, false);
  assert.equal(res.sent.length, 2);
  assert.deepEqual(created.map((c) => c.name), ['taskapp-inbox-t1.json']);
  assert.equal(created[0].obj.categoryId, null);
  assert.equal(JSON.parse(storage.getItem('minutes.taskappInbox')).length, 2);
});

test('readTaskappCategories: taskapp.v1 から読み取り、壊れていれば空', () => {
  const cats = [{ id: 'c1', name: '仕事', color: '#000000' }];
  assert.deepEqual(readTaskappCategories(memoryStorage({ 'taskapp.v1': JSON.stringify({ categories: cats }) })), cats);
  assert.deepEqual(readTaskappCategories(memoryStorage({ 'taskapp.v1': '{bad' })), []);
  assert.deepEqual(readTaskappCategories(memoryStorage()), []);
});
