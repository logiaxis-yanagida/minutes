import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  newId, nowISO, todayYMD, toYMD, addDays, debounce, formatDateTimeRange, escapeHTML,
} from '../js/util.js';

function local(y, mo, d, h = 0, mi = 0) {
  return new Date(y, mo - 1, d, h, mi).toISOString();
}

describe('newId / nowISO', () => {
  test('newId は重複しない文字列を返す', () => {
    const ids = new Set(Array.from({ length: 200 }, () => newId()));
    assert.equal(ids.size, 200);
    for (const id of ids) assert.equal(typeof id, 'string');
  });

  test('nowISO は ISO 文字列', () => {
    const v = nowISO();
    assert.ok(!Number.isNaN(Date.parse(v)));
    assert.match(v, /^\d{4}-\d{2}-\d{2}T/);
  });
});

describe('日付', () => {
  test('toYMD / todayYMD', () => {
    assert.equal(toYMD(new Date(2026, 0, 5)), '2026-01-05');
    assert.equal(todayYMD(new Date(2026, 9, 7, 23, 59)), '2026-10-07');
    assert.match(todayYMD(), /^\d{4}-\d{2}-\d{2}$/);
  });

  test('addDays は月・年・うるう年をまたぐ', () => {
    assert.equal(addDays('2026-10-07', 1), '2026-10-08');
    assert.equal(addDays('2026-10-31', 1), '2026-11-01');
    assert.equal(addDays('2026-12-31', 1), '2027-01-01');
    assert.equal(addDays('2028-02-28', 1), '2028-02-29');
    assert.equal(addDays('2026-03-01', -1), '2026-02-28');
    assert.equal(addDays('2026-10-07', -7), '2026-09-30');
  });
});

describe('debounce', () => {
  test('最後の呼び出しだけが遅延実行される', async () => {
    const calls = [];
    const d = debounce((v) => calls.push(v), 20);
    d(1);
    d(2);
    d(3);
    assert.deepEqual(calls, []);
    await new Promise((r) => setTimeout(r, 50));
    assert.deepEqual(calls, [3]);
  });

  test('flush は保留中の呼び出しを即時実行し、二重実行しない', async () => {
    const calls = [];
    const d = debounce((v) => calls.push(v), 20);
    d('a');
    d.flush();
    assert.deepEqual(calls, ['a']);
    await new Promise((r) => setTimeout(r, 40));
    assert.deepEqual(calls, ['a']);
    d.flush();
    assert.deepEqual(calls, ['a']);
  });

  test('cancel は保留中の呼び出しを破棄する', async () => {
    const calls = [];
    const d = debounce(() => calls.push(1), 10);
    d();
    d.cancel();
    await new Promise((r) => setTimeout(r, 30));
    assert.deepEqual(calls, []);
    d.flush();
    assert.deepEqual(calls, []);
  });
});

describe('formatDateTimeRange', () => {
  test('同日の時間帯', () => {
    assert.equal(formatDateTimeRange(local(2026, 10, 7, 10), local(2026, 10, 7, 11)), '2026/10/07(水) 10:00–11:00');
  });

  test('日をまたぐ予定', () => {
    assert.equal(
      formatDateTimeRange(local(2026, 10, 7, 23, 30), local(2026, 10, 8, 1, 5)),
      '2026/10/07(水) 23:30–2026/10/08(木) 01:05',
    );
  });

  test('終了なし', () => {
    assert.equal(formatDateTimeRange(local(2026, 10, 11, 9, 5), null), '2026/10/11(日) 09:05');
  });

  test('終日（1日）は日付のみ', () => {
    assert.equal(formatDateTimeRange('2026-10-07', '2026-10-08'), '2026/10/07(水)');
    assert.equal(formatDateTimeRange('2026-10-07', null), '2026/10/07(水)');
  });

  test('終日（複数日）は終了日を排他的として扱う', () => {
    assert.equal(formatDateTimeRange('2026-10-07', '2026-10-10'), '2026/10/07(水)–2026/10/09(金)');
  });

  test('開始なし・不正値は空文字', () => {
    assert.equal(formatDateTimeRange(null, null), '');
    assert.equal(formatDateTimeRange('', ''), '');
    assert.equal(formatDateTimeRange('abc', null), '');
  });
});

describe('escapeHTML', () => {
  test('特殊文字をエスケープする', () => {
    assert.equal(escapeHTML(`<a href="x">'&'</a>`), '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
  });

  test('null / undefined / 数値', () => {
    assert.equal(escapeHTML(null), '');
    assert.equal(escapeHTML(undefined), '');
    assert.equal(escapeHTML(12), '12');
  });
});
