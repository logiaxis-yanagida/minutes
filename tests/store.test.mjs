import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { store, DEFAULT_TEMPLATE, DEFAULT_SUMMARY_RULE, MEETING_STATUSES } from '../js/store.js';

const BASE_AT = '2026-01-01T00:00:00.000Z';

function iso(offsetMs) {
  return new Date(Date.now() + offsetMs).toISOString();
}

function meeting(id, overrides = {}) {
  return {
    id,
    title: `会議${id}`,
    start: null,
    end: null,
    location: '',
    attendees: [],
    description: '',
    calendarEventId: null,
    preChecks: [],
    agenda: [],
    freeMemo: '',
    decisions: [],
    tasks: [],
    minutes: '',
    status: '準備中',
    createdAt: BASE_AT,
    updatedAt: BASE_AT,
    ...overrides,
  };
}

function reset({ meetings = [], deleted = {}, settings = {}, settingsUpdatedAt = null } = {}) {
  store.importJSON({ version: 1, meetings, settings, deleted: {} });
  const state = store.getState();
  state.deleted = { ...deleted };
  state.settingsUpdatedAt = settingsUpdatedAt;
}

const find = (id) => store.getMeeting(id);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

describe('初期値', () => {
  beforeEach(() => reset());

  test('既定テンプレと要約ルールは元仕様どおり', () => {
    const s = store.getSettings();
    assert.deepEqual(s.template.preChecks, [
      '会議の目的・ゴール', '前回からの持ち越し事項', '事前に確認・準備すべき資料', '自分から確認したいこと',
    ]);
    assert.deepEqual(s.template.agenda, ['前回の振り返り', '本題', '決定事項の確認', '次回までのタスク・次回日程']);
    assert.equal(s.summaryRule, DEFAULT_SUMMARY_RULE);
    assert.ok(s.summaryRule.startsWith('以下の会議メモをもとに議事録を作成してください。'));
    assert.ok(s.summaryRule.endsWith('- 敬語・常体の統一：常体'));
    assert.equal(s.calendarId, 'primary');
    assert.ok(s.oauthClientId.endsWith('.apps.googleusercontent.com'));
    assert.deepEqual(s.taskappIntegration, { enabled: true, defaultCategoryId: null });
    assert.equal(DEFAULT_TEMPLATE.agenda.length, 4);
    assert.deepEqual(MEETING_STATUSES, ['準備中', '実施済', '議事録完了']);
  });
});

describe('createMeeting', () => {
  beforeEach(() => reset());

  test('テンプレを preChecks / agenda に展開する', () => {
    const m = store.createMeeting({ title: ' 定例 ' });
    assert.equal(m.title, '定例');
    assert.equal(m.status, '準備中');
    assert.deepEqual(m.preChecks.map((p) => p.text), DEFAULT_TEMPLATE.preChecks);
    assert.deepEqual(m.agenda.map((a) => a.title), DEFAULT_TEMPLATE.agenda);
    for (const p of m.preChecks) {
      assert.equal(p.checked, false);
      assert.equal(p.note, '');
      assert.ok(p.id);
    }
    for (const a of m.agenda) assert.equal(a.memo, '');
    const ids = [...m.preChecks, ...m.agenda].map((x) => x.id);
    assert.equal(new Set(ids).size, ids.length);
    assert.deepEqual(m.decisions, []);
    assert.deepEqual(m.tasks, []);
    assert.equal(m.createdAt, m.updatedAt);
    assert.equal(find(m.id), m);
  });

  test('編集後のテンプレが新しい会議に使われる', () => {
    store.updateSettings({ template: { preChecks: ['A'], agenda: ['X', 'Y'] } });
    const m = store.createMeeting({});
    assert.deepEqual(m.preChecks.map((p) => p.text), ['A']);
    assert.deepEqual(m.agenda.map((a) => a.title), ['X', 'Y']);
  });

  test('カレンダー由来の項目を受け取る', () => {
    const m = store.createMeeting({
      title: '打合せ',
      start: '2026-10-07T01:00:00.000Z',
      end: '2026-10-07T02:00:00.000Z',
      location: '会議室A',
      attendees: ['田中', '', ' 佐藤 ', 3],
      description: '説明',
      calendarEventId: 'ev1',
    });
    assert.equal(m.start, '2026-10-07T01:00:00.000Z');
    assert.equal(m.end, '2026-10-07T02:00:00.000Z');
    assert.equal(m.location, '会議室A');
    assert.deepEqual(m.attendees, ['田中', '佐藤']);
    assert.equal(m.description, '説明');
    assert.equal(m.calendarEventId, 'ev1');
  });

  test('終日予定の YMD を受け付け、不正な日時は null', () => {
    const m = store.createMeeting({ start: '2026-10-07', end: 'あとで' });
    assert.equal(m.start, '2026-10-07');
    assert.equal(m.end, null);
  });
});

describe('findByCalendarEventId', () => {
  beforeEach(() => reset());

  test('一致する会議を返し、無ければ null', () => {
    const m = store.createMeeting({ title: 'A', calendarEventId: 'ev-a' });
    store.createMeeting({ title: 'B' });
    assert.equal(store.findByCalendarEventId('ev-a').id, m.id);
    assert.equal(store.findByCalendarEventId('ev-x'), null);
    assert.equal(store.findByCalendarEventId(null), null);
    assert.equal(store.findByCalendarEventId(''), null);
  });

  test('削除した会議は見つからない', () => {
    const m = store.createMeeting({ title: 'A', calendarEventId: 'ev-a' });
    store.deleteMeeting(m.id);
    assert.equal(store.findByCalendarEventId('ev-a'), null);
  });
});

describe('updateMeeting', () => {
  beforeEach(() => reset());

  test('浅いマージで updatedAt が進み、id / createdAt は変わらない', async () => {
    const m = store.createMeeting({ title: 'A' });
    await wait(5);
    const u = store.updateMeeting(m.id, { freeMemo: 'メモ', id: 'evil', createdAt: BASE_AT });
    assert.equal(u.id, m.id);
    assert.equal(u.createdAt, m.createdAt);
    assert.equal(u.freeMemo, 'メモ');
    assert.equal(u.title, 'A');
    assert.ok(u.updatedAt > m.updatedAt);
    assert.equal(find(m.id).freeMemo, 'メモ');
  });

  test('不正な status は 準備中 に、正しい値は保持', () => {
    const m = store.createMeeting({});
    assert.equal(store.updateMeeting(m.id, { status: '議事録完了' }).status, '議事録完了');
    assert.equal(store.updateMeeting(m.id, { status: '完了' }).status, '準備中');
  });

  test('サブ項目の id が無ければ生成され、重複は振り直される', () => {
    const m = store.createMeeting({});
    const u = store.updateMeeting(m.id, {
      decisions: [{ text: '決定1' }, { id: 'd', text: '決定2' }, { id: 'd', text: '決定3' }, null, '決定4'],
      tasks: [{ title: 'T', due: '2026/10/01', assignee: 5 }],
    });
    assert.equal(u.decisions.length, 4);
    assert.equal(new Set(u.decisions.map((d) => d.id)).size, 4);
    assert.equal(u.decisions[1].id, 'd');
    assert.equal(u.decisions[3].text, '決定4');
    assert.deepEqual(
      { ...u.tasks[0], id: undefined },
      { id: undefined, title: 'T', assignee: '', due: null, done: false, sentToTaskapp: false, taskappId: null },
    );
  });

  test('存在しない id は null', () => {
    assert.equal(store.updateMeeting('nope', { title: 'x' }), null);
  });
});

describe('deleteMeeting / restoreMeeting', () => {
  beforeEach(() => reset());

  test('削除でトゥームストーンが記録され、削除した会議が返る', () => {
    const m = store.createMeeting({ title: 'A' });
    const removed = store.deleteMeeting(m.id);
    assert.equal(removed.id, m.id);
    assert.equal(find(m.id), null);
    assert.ok(store.getState().deleted[m.id]);
    assert.equal(store.deleteMeeting('nope'), null);
  });

  test('restoreMeeting でトゥームストーンが消え、updatedAt が削除時刻以上になる', async () => {
    const m = store.createMeeting({ title: 'A' });
    const removed = store.deleteMeeting(m.id);
    const deletedAt = store.getState().deleted[m.id];
    await wait(5);
    const restored = store.restoreMeeting(removed);
    assert.equal(store.getState().deleted[m.id], undefined);
    assert.ok(restored.updatedAt > deletedAt);
    assert.equal(find(m.id).title, 'A');
    assert.equal(store.getMeetings().length, 1);
  });

  test('復元した会議は remote の古いトゥームストーンで消えない', async () => {
    const m = store.createMeeting({ title: 'A' });
    const removed = store.deleteMeeting(m.id);
    const remoteDeleted = { ...store.getState().deleted };
    await wait(5);
    store.restoreMeeting(removed);
    store.mergeRemote({ version: 1, meetings: [], deleted: remoteDeleted });
    assert.ok(find(m.id));
  });
});

describe('updateSettings と共有設定', () => {
  beforeEach(() => reset());

  test('template / summaryRule の変更で settingsUpdatedAt が更新される', () => {
    assert.equal(store.getState().settingsUpdatedAt, null);
    store.updateSettings({ calendarId: 'work@example.com' });
    assert.equal(store.getState().settingsUpdatedAt, null);
    assert.equal(store.getSettings().calendarId, 'work@example.com');
    store.updateSettings({ summaryRule: '新ルール' });
    assert.ok(store.getState().settingsUpdatedAt);
  });

  test('template / taskappIntegration は部分更新できる', () => {
    store.updateSettings({ template: { agenda: ['本題のみ'] } });
    assert.deepEqual(store.getSettings().template.preChecks, [...DEFAULT_TEMPLATE.preChecks]);
    assert.deepEqual(store.getSettings().template.agenda, ['本題のみ']);
    store.updateSettings({ taskappIntegration: { defaultCategoryId: 'cat-work' } });
    assert.deepEqual(store.getSettings().taskappIntegration, { enabled: true, defaultCategoryId: 'cat-work' });
  });

  test('getSyncPayload は shared のみを含み端末ローカル設定を含まない', () => {
    store.createMeeting({ title: 'A' });
    store.updateSettings({ summaryRule: 'R', oauthClientId: 'local-id' });
    const p = store.getSyncPayload();
    assert.equal(p.version, 1);
    assert.equal(p.meetings.length, 1);
    assert.deepEqual(p.deleted, {});
    assert.equal(p.shared.summaryRule, 'R');
    assert.deepEqual(p.shared.template, store.getSettings().template);
    assert.equal(p.shared.settingsUpdatedAt, store.getState().settingsUpdatedAt);
    assert.equal('settings' in p, false);
    assert.equal(JSON.stringify(p).includes('local-id'), false);
    assert.ok(!Number.isNaN(Date.parse(p.savedAt)));
  });

  test('remote の shared が新しければ採用、端末ローカル設定は維持', () => {
    reset({ settings: { calendarId: 'mine', summaryRule: '旧' }, settingsUpdatedAt: iso(-10_000) });
    const { changed } = store.mergeRemote({
      version: 1,
      meetings: [],
      deleted: {},
      shared: { template: { preChecks: ['P'], agenda: ['A'] }, summaryRule: '新', settingsUpdatedAt: iso(-5_000) },
    });
    assert.equal(changed, true);
    assert.equal(store.getSettings().summaryRule, '新');
    assert.deepEqual(store.getSettings().template, { preChecks: ['P'], agenda: ['A'] });
    assert.equal(store.getSettings().calendarId, 'mine');
  });

  test('remote の shared が古ければ無視', () => {
    reset({ settings: { summaryRule: 'ローカル' }, settingsUpdatedAt: iso(-5_000) });
    const { changed } = store.mergeRemote({
      version: 1,
      meetings: [],
      deleted: {},
      shared: { template: { preChecks: [], agenda: [] }, summaryRule: 'リモート', settingsUpdatedAt: iso(-10_000) },
    });
    assert.equal(changed, false);
    assert.equal(store.getSettings().summaryRule, 'ローカル');
  });

  test('未編集の端末は remote の shared を採用し、settingsUpdatedAt 無しの remote は無視', () => {
    reset();
    store.mergeRemote({ version: 1, meetings: [], deleted: {}, shared: { summaryRule: 'X', settingsUpdatedAt: null } });
    assert.equal(store.getSettings().summaryRule, DEFAULT_SUMMARY_RULE);
    store.mergeRemote({ version: 1, meetings: [], deleted: {}, shared: { summaryRule: 'X', settingsUpdatedAt: BASE_AT } });
    assert.equal(store.getSettings().summaryRule, 'X');
    assert.deepEqual(store.getSettings().template.agenda, [...DEFAULT_TEMPLATE.agenda]);
  });
});

describe('mergeRemote: 会議', () => {
  beforeEach(() => reset());

  test('updatedAt が新しい remote が勝つ', () => {
    reset({ meetings: [meeting('m1', { title: 'ローカル', updatedAt: iso(-10_000) })] });
    const { changed } = store.mergeRemote({
      version: 1, meetings: [meeting('m1', { title: 'リモート', updatedAt: iso(-5_000) })], deleted: {},
    });
    assert.equal(changed, true);
    assert.equal(find('m1').title, 'リモート');
  });

  test('ローカルが新しければ変更なし', () => {
    reset({ meetings: [meeting('m1', { title: 'ローカル', updatedAt: iso(-5_000) })] });
    const { changed } = store.mergeRemote({
      version: 1, meetings: [meeting('m1', { title: 'リモート', updatedAt: iso(-10_000) })], deleted: {},
    });
    assert.equal(changed, false);
    assert.equal(find('m1').title, 'ローカル');
  });

  test('同値の updatedAt はローカルが勝つ', () => {
    reset({ meetings: [meeting('m1', { title: 'ローカル' })] });
    store.mergeRemote({ version: 1, meetings: [meeting('m1', { title: 'リモート' })], deleted: {} });
    assert.equal(find('m1').title, 'ローカル');
  });

  test('remote にだけある会議は追加される', () => {
    reset({ meetings: [meeting('m1')] });
    store.mergeRemote({ version: 1, meetings: [meeting('m1'), meeting('m2')], deleted: {} });
    assert.equal(store.getMeetings().length, 2);
    assert.ok(find('m2'));
  });

  test('同一内容なら changed=false', () => {
    reset({ meetings: [meeting('m1'), meeting('m2')] });
    const { changed } = store.mergeRemote(store.getSyncPayload());
    assert.equal(changed, false);
  });

  test('remote のトゥームストーンがローカル更新より新しければ削除', () => {
    reset({ meetings: [meeting('m1', { updatedAt: iso(-10_000) })] });
    const { changed } = store.mergeRemote({ version: 1, meetings: [], deleted: { m1: iso(-5_000) } });
    assert.equal(changed, true);
    assert.equal(find('m1'), null);
    assert.ok(store.getState().deleted.m1);
  });

  test('ローカル更新がトゥームストーンより新しければ残り、トゥームストーンは消える', () => {
    reset({ meetings: [meeting('m1', { updatedAt: iso(-5_000) })] });
    store.mergeRemote({ version: 1, meetings: [], deleted: { m1: iso(-10_000) } });
    assert.ok(find('m1'));
    assert.equal(store.getState().deleted.m1, undefined);
  });

  test('ローカルのトゥームストーンが remote の古い版の復活を防ぐ', () => {
    reset({ deleted: { m1: iso(-5_000) } });
    const { changed } = store.mergeRemote({
      version: 1, meetings: [meeting('m1', { updatedAt: iso(-10_000) })], deleted: {},
    });
    assert.equal(changed, false);
    assert.equal(find('m1'), null);
  });

  test('remote の更新がローカルのトゥームストーンより新しければ復活', () => {
    reset({ deleted: { m1: iso(-10_000) } });
    store.mergeRemote({ version: 1, meetings: [meeting('m1', { updatedAt: iso(-5_000) })], deleted: {} });
    assert.ok(find('m1'));
    assert.equal(store.getState().deleted.m1, undefined);
  });

  test('deleteMeeting 後の mergeRemote で remote の古い版が戻らない', () => {
    reset({ meetings: [meeting('m1', { updatedAt: iso(-10_000) })] });
    const remote = store.getSyncPayload();
    store.deleteMeeting('m1');
    store.mergeRemote(remote);
    assert.equal(find('m1'), null);
  });

  test('双方の deleted は新しい方で統合される', () => {
    const older = iso(-20_000);
    const newer = iso(-10_000);
    reset({ deleted: { a: older, b: newer } });
    store.mergeRemote({ version: 1, meetings: [], deleted: { a: newer, b: older, c: older } });
    const { deleted } = store.getState();
    assert.equal(deleted.a, newer);
    assert.equal(deleted.b, newer);
    assert.equal(deleted.c, older);
  });

  test('不完全な remote の会議も正規化される', () => {
    reset();
    store.mergeRemote({
      version: 1,
      meetings: [{ id: 'm9', title: 'R', updatedAt: BASE_AT, agenda: [{ title: '議題' }], status: '???' }, 'ゴミ', null],
      deleted: {},
    });
    const m = find('m9');
    assert.ok(m);
    assert.equal(store.getMeetings().length, 1);
    assert.deepEqual(m.preChecks, []);
    assert.deepEqual(m.tasks, []);
    assert.equal(m.agenda[0].title, '議題');
    assert.equal(m.agenda[0].memo, '');
    assert.ok(m.agenda[0].id);
    assert.equal(m.status, '準備中');
  });

  test('null / 非オブジェクトは何もしない', () => {
    assert.deepEqual(store.mergeRemote(null), { changed: false });
    assert.deepEqual(store.mergeRemote('x'), { changed: false });
  });
});

describe('importJSON', () => {
  beforeEach(() => reset());

  test('exportJSON → importJSON(replace) で往復できる', () => {
    store.createMeeting({ title: 'A' });
    store.updateSettings({ summaryRule: 'R' });
    const json = store.exportJSON();
    reset();
    const { count } = store.importJSON(json, { mode: 'replace' });
    assert.equal(count, 1);
    assert.equal(store.getMeetings()[0].title, 'A');
    assert.equal(store.getSettings().summaryRule, 'R');
  });

  test('replace は既存の会議を置き換え、deleted は維持される', () => {
    const m = store.createMeeting({ title: 'A' });
    store.deleteMeeting(m.id);
    store.createMeeting({ title: 'B' });
    const { count } = store.importJSON({ version: 1, meetings: [meeting('x')] }, { mode: 'replace' });
    assert.equal(count, 1);
    assert.deepEqual(store.getMeetings().map((x) => x.id), ['x']);
    assert.ok(store.getState().deleted[m.id]);
  });

  test('replace で settings を含まないデータは現在の設定を保つ', () => {
    store.updateSettings({ summaryRule: '保持' });
    store.importJSON({ version: 1, meetings: [] }, { mode: 'replace' });
    assert.equal(store.getSettings().summaryRule, '保持');
  });

  test('replace でトゥームストーン付きの会議を戻すと復活する', () => {
    const m = store.createMeeting({ title: 'A' });
    const snapshot = store.getMeeting(m.id);
    store.deleteMeeting(m.id);
    store.importJSON({ version: 1, meetings: [snapshot] }, { mode: 'replace' });
    assert.ok(find(m.id));
    assert.equal(store.getState().deleted[m.id], undefined);
  });

  test('merge は updatedAt の新しい方を採用し、新規は追加する', () => {
    reset({
      meetings: [
        meeting('m1', { title: 'ローカル新', updatedAt: iso(-5_000) }),
        meeting('m2', { title: 'ローカル旧', updatedAt: iso(-10_000) }),
      ],
    });
    const { count } = store.importJSON(
      JSON.stringify({
        version: 1,
        meetings: [
          meeting('m1', { title: '取込旧', updatedAt: iso(-10_000) }),
          meeting('m2', { title: '取込新', updatedAt: iso(-5_000) }),
          meeting('m3', { title: '取込のみ' }),
        ],
      }),
      { mode: 'merge' },
    );
    assert.equal(count, 2);
    assert.equal(find('m1').title, 'ローカル新');
    assert.equal(find('m2').title, '取込新');
    assert.equal(find('m3').title, '取込のみ');
    assert.deepEqual(store.getMeetings().map((m) => m.id), ['m1', 'm2', 'm3']);
  });

  test('merge でトゥームストーン付きの会議を戻すと復活し updatedAt が更新される', () => {
    const m = store.createMeeting({ title: 'A' });
    const snapshot = store.getMeeting(m.id);
    store.deleteMeeting(m.id);
    const deletedAt = store.getState().deleted[m.id];
    const { count } = store.importJSON({ version: 1, meetings: [snapshot] }, { mode: 'merge' });
    assert.equal(count, 1);
    const restored = find(m.id);
    assert.ok(restored);
    assert.ok(restored.updatedAt >= deletedAt);
    assert.equal(store.getState().deleted[m.id], undefined);
  });

  test('merge の共有設定は settingsUpdatedAt が新しい場合のみ採用、端末ローカル設定は維持', () => {
    reset({ settings: { summaryRule: 'ローカル', calendarId: 'mine' }, settingsUpdatedAt: iso(-5_000) });
    store.importJSON(
      { version: 1, meetings: [], settings: { summaryRule: '古い', calendarId: 'other' }, settingsUpdatedAt: iso(-10_000) },
      { mode: 'merge' },
    );
    assert.equal(store.getSettings().summaryRule, 'ローカル');
    store.importJSON(
      { version: 1, meetings: [], settings: { summaryRule: '新しい', calendarId: 'other' }, settingsUpdatedAt: iso(-1_000) },
      { mode: 'merge' },
    );
    assert.equal(store.getSettings().summaryRule, '新しい');
    assert.equal(store.getSettings().calendarId, 'mine');
  });

  test('不正な JSON・形式は例外', () => {
    assert.throws(() => store.importJSON('{bad', { mode: 'replace' }));
    assert.throws(() => store.importJSON('[]', { mode: 'merge' }));
    assert.throws(() => store.importJSON('null'));
  });

  test('90日より古いトゥームストーンは掃除される', () => {
    const oldAt = iso(-91 * 24 * 60 * 60 * 1000);
    const recentAt = iso(-1 * 24 * 60 * 60 * 1000);
    store.importJSON({ version: 1, meetings: [], deleted: { old: oldAt, recent: recentAt } });
    assert.equal(store.getState().deleted.recent, recentAt);
    assert.equal(store.getState().deleted.old, undefined);
    store.mergeRemote({ version: 1, meetings: [], deleted: { old2: oldAt } });
    assert.equal(store.getState().deleted.old2, undefined);
    assert.equal(store.getState().deleted.recent, recentAt);
  });

  test('同じ id の会議が重複していれば先頭のみ残る', () => {
    store.importJSON({ version: 1, meetings: [meeting('d', { title: '1' }), meeting('d', { title: '2' })] });
    assert.equal(store.getMeetings().length, 1);
    assert.equal(find('d').title, '1');
  });
});

describe('subscribe', () => {
  beforeEach(() => reset());

  test('commit ごとに通知され、解除後は通知されない', () => {
    const seen = [];
    const off = store.subscribe((s) => seen.push(s.meetings.length));
    const m = store.createMeeting({});
    store.updateMeeting(m.id, { title: 'x' });
    off();
    store.deleteMeeting(m.id);
    assert.deepEqual(seen, [1, 1]);
  });
});
