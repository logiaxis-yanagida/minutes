import { formatDateTimeRange } from './util.js';

const NONE = 'なし';
const UNSET = '未設定';

function text(v) {
  return typeof v === 'string' ? v.trim() : '';
}

function list(v) {
  return Array.isArray(v) ? v : [];
}

function indentContinuation(s) {
  return s.replace(/\r\n?/g, '\n').split('\n').join('\n  ');
}

function normalizeBlock(s) {
  return s.replace(/\r\n?/g, '\n');
}

function tableCell(s) {
  return s.replace(/\r\n?/g, '\n').replace(/\|/g, '\\|').split('\n').join('<br>');
}

function formatDue(ymd) {
  if (typeof ymd !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return '未定';
  return ymd.replace(/-/g, '/');
}

function infoSection(meeting) {
  const attendees = list(meeting.attendees).map(text).filter(Boolean);
  return [
    '## 会議情報',
    '',
    `- タイトル: ${text(meeting.title) || '（無題）'}`,
    `- 日時: ${formatDateTimeRange(meeting.start, meeting.end) || UNSET}`,
    `- 場所: ${text(meeting.location) || UNSET}`,
    `- 参加者: ${attendees.length ? attendees.join('、') : UNSET}`,
  ].join('\n');
}

function agendaSection(meeting) {
  const items = list(meeting.agenda).filter((a) => a && (text(a.title) || text(a.detail) || text(a.memo)));
  if (!items.length) return ['## アジェンダ別メモ', '', NONE].join('\n');
  const blocks = items.map((a, i) => {
    const memo = text(a.memo);
    const detail = text(a.detail);
    const head = [`### ${i + 1}. ${text(a.title) || '（無題）'}`, ''];
    if (detail) head.push(`詳細: ${indentContinuation(detail)}`, '');
    return [...head, memo ? normalizeBlock(memo) : '（メモなし）'].join('\n');
  });
  return ['## アジェンダ別メモ', '', blocks.join('\n\n')].join('\n');
}

function freeMemoSection(meeting) {
  const memo = text(meeting.freeMemo);
  return ['## 自由メモ', '', memo ? normalizeBlock(memo) : NONE].join('\n');
}

function decisionSection(meeting) {
  const items = list(meeting.decisions).filter((d) => d && text(d.text));
  const lines = items.map((d) => `- ${indentContinuation(text(d.text))}`);
  return ['## 決定事項', '', lines.length ? lines.join('\n') : NONE].join('\n');
}

function taskSection(meeting) {
  const items = list(meeting.tasks).filter((t) => t && text(t.title));
  if (!items.length) return ['## タスク', '', NONE].join('\n');
  const rows = items.map((t) => {
    const cells = [
      tableCell(text(t.title)),
      tableCell(text(t.assignee) || '未定'),
      formatDue(t.due),
      t.done ? '完了' : '未完了',
    ];
    return `| ${cells.join(' | ')} |`;
  });
  return ['## タスク', '', '| タスク | 担当 | 期限 | 状態 |', '| --- | --- | --- | --- |', ...rows].join('\n');
}

export function buildMinutesPrompt(meeting, settings) {
  const m = meeting && typeof meeting === 'object' ? meeting : {};
  const rule = text(settings && settings.summaryRule);
  const sections = [
    '# 会議メモ',
    infoSection(m),
    agendaSection(m),
    freeMemoSection(m),
    decisionSection(m),
    taskSection(m),
  ];
  if (rule) sections.unshift(normalizeBlock(rule));
  return `${sections.join('\n\n')}\n`;
}
