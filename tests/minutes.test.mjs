import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildMinutesPrompt } from '../js/minutes.js';

function local(y, mo, d, h = 0, mi = 0) {
  return new Date(y, mo - 1, d, h, mi).toISOString();
}

const settings = { summaryRule: '以下の会議メモをもとに議事録を作成してください。\n\n【ルール】\n- 常体' };

function fullMeeting() {
  return {
    id: 'm1',
    title: '定例MTG',
    start: local(2026, 10, 7, 10),
    end: local(2026, 10, 7, 11),
    location: '会議室A',
    attendees: ['田中', '佐藤'],
    preChecks: [
      { id: 'p1', text: '会議の目的', checked: true, note: '進捗共有' },
      { id: 'p2', text: '持ち越し事項', checked: false, note: '' },
    ],
    agenda: [
      { id: 'a1', title: '前回の振り返り', memo: '特になし\n2行目' },
      { id: 'a2', title: '本題', memo: '' },
    ],
    freeMemo: '雑談メモ',
    decisions: [{ id: 'd1', text: '来月リリース' }],
    tasks: [
      { id: 't1', title: '資料作成', assignee: '田中', due: '2026-10-10', done: false },
      { id: 't2', title: '見積|確認', assignee: '', due: null, done: true },
    ],
  };
}

function section(md, heading) {
  const start = md.indexOf(`${heading}\n`);
  assert.notEqual(start, -1, `${heading} が見つからない`);
  const rest = md.slice(start + heading.length + 1);
  const next = rest.search(/\n## /);
  return (next === -1 ? rest : rest.slice(0, next)).trim();
}

describe('buildMinutesPrompt', () => {
  test('要約ルールが先頭、続いて各セクションが順に並ぶ', () => {
    const md = buildMinutesPrompt(fullMeeting(), settings);
    assert.ok(md.startsWith(settings.summaryRule));
    const order = ['# 会議メモ', '## 会議情報', '## アジェンダ別メモ', '## 自由メモ', '## 決定事項', '## タスク'];
    let pos = -1;
    for (const h of order) {
      const i = md.indexOf(`\n${h}\n`);
      assert.ok(i > pos, `${h} の位置`);
      pos = i;
    }
    assert.ok(md.endsWith('\n'));
    assert.ok(!md.endsWith('\n\n'));
  });

  test('会議情報', () => {
    const md = buildMinutesPrompt(fullMeeting(), settings);
    assert.equal(
      section(md, '## 会議情報'),
      ['- タイトル: 定例MTG', '- 日時: 2026/10/07(水) 10:00–11:00', '- 場所: 会議室A', '- 参加者: 田中、佐藤'].join('\n'),
    );
  });

  test('事前確認事項は出力しない', () => {
    const md = buildMinutesPrompt(fullMeeting(), settings);
    assert.ok(!md.includes('事前確認事項'));
    assert.ok(!md.includes('会議の目的'));
  });

  test('アジェンダの詳細はメモの前に出力する', () => {
    const m = fullMeeting();
    m.agenda[0].detail = '前回の課題\n2点';
    const md = buildMinutesPrompt(m, settings);
    assert.ok(section(md, '## アジェンダ別メモ').startsWith('### 1. 前回の振り返り\n\n詳細: 前回の課題\n  2点\n\n特になし'));
  });

  test('アジェンダは番号付き見出し、空メモは（メモなし）', () => {
    const md = buildMinutesPrompt(fullMeeting(), settings);
    assert.equal(
      section(md, '## アジェンダ別メモ'),
      '### 1. 前回の振り返り\n\n特になし\n2行目\n\n### 2. 本題\n\n（メモなし）',
    );
  });

  test('自由メモと決定事項', () => {
    const md = buildMinutesPrompt(fullMeeting(), settings);
    assert.equal(section(md, '## 自由メモ'), '雑談メモ');
    assert.equal(section(md, '## 決定事項'), '- 来月リリース');
  });

  test('タスクは Markdown 表、| はエスケープ、空欄は未定', () => {
    const md = buildMinutesPrompt(fullMeeting(), settings);
    assert.equal(
      section(md, '## タスク'),
      [
        '| タスク | 担当 | 期限 | 状態 |',
        '| --- | --- | --- | --- |',
        '| 資料作成 | 田中 | 2026/10/10 | 未完了 |',
        '| 見積\\|確認 | 未定 | 未定 | 完了 |',
      ].join('\n'),
    );
  });

  test('空の会議は各セクションが「なし」/「未設定」', () => {
    const md = buildMinutesPrompt({ title: '' }, { summaryRule: '' });
    assert.ok(md.startsWith('# 会議メモ\n'));
    assert.equal(
      section(md, '## 会議情報'),
      ['- タイトル: （無題）', '- 日時: 未設定', '- 場所: 未設定', '- 参加者: 未設定'].join('\n'),
    );
    for (const h of ['## アジェンダ別メモ', '## 自由メモ', '## 決定事項', '## タスク']) {
      assert.equal(section(md, h), 'なし', h);
    }
  });

  test('空白だけの項目は除外される', () => {
    const md = buildMinutesPrompt(
      {
        title: 'X',
        preChecks: [{ text: '  ', checked: true }],
        agenda: [{ title: '', memo: '' }, { title: '', memo: 'メモだけ' }],
        decisions: [{ text: '' }],
        tasks: [{ title: ' ' }],
        freeMemo: '   ',
      },
      settings,
    );
    assert.equal(section(md, '## アジェンダ別メモ'), '### 1. （無題）\n\nメモだけ');
    assert.equal(section(md, '## 自由メモ'), 'なし');
    assert.equal(section(md, '## 決定事項'), 'なし');
    assert.equal(section(md, '## タスク'), 'なし');
  });

  test('settings や meeting が無くても例外にならない', () => {
    assert.ok(buildMinutesPrompt(null, null).startsWith('# 会議メモ'));
    assert.ok(buildMinutesPrompt({}, undefined).includes('## タスク\n\nなし'));
  });

  test('複数行の項目はリスト内で字下げ、表のセル内改行は <br>', () => {
    const md = buildMinutesPrompt(
      {
        title: 'X',
        decisions: [{ text: '1行目\r\n2行目' }],
        tasks: [{ title: 'A\nB', assignee: '田中', due: '2026-10-10' }],
      },
      settings,
    );
    assert.equal(section(md, '## 決定事項'), '- 1行目\n  2行目');
    assert.ok(section(md, '## タスク').includes('| A<br>B | 田中 | 2026/10/10 | 未完了 |'));
  });

  test('終日予定は日付のみ', () => {
    const md = buildMinutesPrompt({ title: 'X', start: '2026-10-07', end: '2026-10-08' }, settings);
    assert.ok(section(md, '## 会議情報').includes('- 日時: 2026/10/07(水)\n'));
  });
});
