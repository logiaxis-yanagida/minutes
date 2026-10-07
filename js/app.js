import { store, DEFAULT_SUMMARY_RULE } from './store.js';
import { newId, todayYMD, toYMD, addDays, debounce, formatDateTimeRange } from './util.js';
import { buildMinutesPrompt } from './minutes.js';
import { isVoiceSupported, createDictation, IS_IOS, ensureMicPermission } from './voice.js';
import { google } from './google.js';
import { listEvents } from './calendar.js';
import { drive } from './drive.js';
import { createSync } from './sync.js';
import { sendTasks, readTaskappCategories } from './taskbridge.js';
import { DEFAULT_GCAL_CALENDAR_ID } from './config.js';

const SAVE_DELAY_MS = 1500;
const TABS = ['pre', 'during', 'post'];
const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;
const SUPPORTS_FIELD_SIZING = typeof CSS !== 'undefined' && CSS.supports?.('field-sizing', 'content');

const $ = (id) => document.getElementById(id);

const el = {
  syncStatus: $('sync-status'),
  settingsBtn: $('settings-btn'),
  listView: $('list-view'),
  listTabs: document.querySelectorAll('#list-tabs .tab'),
  search: $('search-input'),
  meetingList: $('meeting-list'),
  listEmpty: $('list-empty'),
  newMeetingBtn: $('new-meeting-btn'),
  detailView: $('detail-view'),
  title: $('meeting-title'),
  deleteMeetingBtn: $('delete-meeting-btn'),
  metaWhen: $('meta-when'),
  metaWhere: $('meta-where'),
  date: $('meeting-date'),
  startTime: $('meeting-start'),
  endTime: $('meeting-end'),
  location: $('meeting-location'),
  attendees: $('meeting-attendees'),
  status: $('meeting-status'),
  detailTabs: document.querySelectorAll('#detail-tabs .tab'),
  body: $('detail-body'),
  mic: $('mic-btn'),
  voiceBar: $('voice-bar'),
  qtForm: $('quick-task-form'),
  qtTitle: $('quick-task-title'),
  qtAssignee: $('quick-task-assignee'),
  qtDue: $('quick-task-due'),
  createDialog: $('create-dialog'),
  createFromCalendar: $('create-from-calendar'),
  createManual: $('create-manual'),
  calendarDialog: $('calendar-dialog'),
  calendarStatus: $('calendar-status'),
  eventGroups: $('event-groups'),
  manualDialog: $('manual-dialog'),
  manualForm: $('manual-form'),
  manualClose: $('manual-close'),
  manualTitle: $('manual-title-input'),
  manualDate: $('manual-date'),
  manualStart: $('manual-start'),
  manualEnd: $('manual-end'),
  manualLocation: $('manual-location'),
  manualAttendees: $('manual-attendees'),
  settings: $('settings-dialog'),
  tplPreChecks: $('tpl-prechecks'),
  tplAgenda: $('tpl-agenda'),
  summaryRule: $('summary-rule'),
  summaryReset: $('summary-reset-btn'),
  clientId: $('google-client-id'),
  calendarId: $('google-calendar-id'),
  signIn: $('google-signin-btn'),
  syncNow: $('drive-sync-now'),
  googleStatus: $('google-status'),
  driveStatus: $('drive-status'),
  taskappEnabled: $('taskapp-enabled'),
  taskappCategory: $('taskapp-category'),
  voiceSection: $('voice-section'),
  exportBtn: $('export-btn'),
  importBtn: $('import-btn'),
  importFile: $('import-file'),
  toasts: $('toasts'),
};

const ui = {
  view: 'list',
  filter: 'today',
  query: '',
  meetingId: null,
  tab: 'pre',
  draft: null,
  baseUpdatedAt: null,
  dirty: new Set(),
  selfCommit: 0,
  staleDetail: false,
  selectedAgendaId: null,
  lastField: null,
  lastFieldKey: null,
  voiceSupported: false,
  dictation: null,
  listening: false,
  lastSyncErrorToast: '',
};

let sync = null;

// ---------- 共通 ----------

function h(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (k in node) node[k] = v;
    else node.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children.flat()) {
    if (c !== null && c !== undefined && c !== false) node.append(c);
  }
  return node;
}

function clone(v) {
  return v === undefined ? v : JSON.parse(JSON.stringify(v));
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function errorMessage(err) {
  return err && err.message ? err.message : String(err);
}

function parseList(text) {
  return String(text || '')
    .split(/[,、，]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseLines(text) {
  return String(text || '')
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function setValue(input, value) {
  if (document.activeElement === input) return;
  if (input.value !== value) input.value = value;
}

function showToast(message, { actionLabel, onAction, duration = 5000, error = false } = {}) {
  const toast = document.createElement('div');
  toast.className = `toast${error ? ' is-error' : ''}`;
  toast.setAttribute('role', 'status');
  const msg = document.createElement('span');
  msg.className = 'msg';
  msg.textContent = message;
  toast.append(msg);
  let timer = null;
  const dismiss = () => {
    if (timer) clearTimeout(timer);
    toast.remove();
  };
  if (actionLabel && onAction) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'action';
    btn.textContent = actionLabel;
    btn.addEventListener('click', () => {
      dismiss();
      onAction();
    });
    toast.append(btn);
  }
  el.toasts.append(toast);
  raiseToasts();
  timer = setTimeout(dismiss, duration);
  return dismiss;
}

function raiseToasts() {
  if (typeof el.toasts.showPopover !== 'function') return;
  try {
    if (el.toasts.matches(':popover-open')) el.toasts.hidePopover();
    el.toasts.showPopover();
  } catch {
    el.toasts.removeAttribute('popover');
  }
}

// ---------- 日時 ----------

function fromYMD(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function meetingYMD(start) {
  if (!start) return null;
  if (YMD_RE.test(start)) return start;
  const d = new Date(start);
  return Number.isNaN(d.getTime()) ? null : toYMD(d);
}

function startTime(m) {
  if (!m.start) return null;
  const t = YMD_RE.test(m.start) ? fromYMD(m.start).getTime() : Date.parse(m.start);
  return Number.isNaN(t) ? null : t;
}

function splitPoint(value) {
  if (!value) return { date: '', time: '' };
  if (YMD_RE.test(value)) return { date: value, time: '' };
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return { date: '', time: '' };
  return { date: toYMD(d), time: `${pad2(d.getHours())}:${pad2(d.getMinutes())}` };
}

function localISO(ymd, hm) {
  const [y, mo, d] = ymd.split('-').map(Number);
  const [hh, mi] = hm.split(':').map(Number);
  return new Date(y, mo - 1, d, hh, mi).toISOString();
}

function buildRange(date, start, end) {
  if (!date) return { start: null, end: null };
  if (!start) return { start: date, end: null };
  let endISO = null;
  if (end) endISO = end < start ? localISO(addDays(date, 1), end) : localISO(date, end);
  return { start: localISO(date, start), end: endISO };
}

function formatClock(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getHours()}:${pad2(d.getMinutes())}`;
}

// ---------- 保存 ----------

function withSelfCommit(fn) {
  ui.selfCommit += 1;
  try {
    return fn();
  } finally {
    ui.selfCommit -= 1;
  }
}

function flushPending() {
  const draft = ui.draft;
  if (!draft || ui.dirty.size === 0) return;
  const patch = {};
  for (const key of ui.dirty) patch[key] = clone(draft[key]);
  ui.dirty.clear();
  if (!store.getMeeting(draft.id)) return;
  const saved = withSelfCommit(() => store.updateMeeting(draft.id, patch));
  if (saved) ui.baseUpdatedAt = saved.updatedAt;
}

const saveLater = debounce(flushPending, SAVE_DELAY_MS);

function markDirty(...keys) {
  for (const k of keys) ui.dirty.add(k);
  saveLater();
}

function saveNow(...keys) {
  for (const k of keys) ui.dirty.add(k);
  saveLater.cancel();
  flushPending();
}

function flushAll() {
  saveLater.cancel();
  flushPending();
}

function findItem(listKey, id) {
  return ui.draft?.[listKey]?.find((x) => x.id === id) || null;
}

function editItem(listKey, id, fn) {
  const item = findItem(listKey, id);
  if (!item) return;
  fn(item);
  markDirty(listKey);
}

function isEditingInDetail() {
  const a = document.activeElement;
  return Boolean(a && el.detailView.contains(a) && a.matches('input, textarea, select'));
}

function onStoreChange() {
  if (ui.view === 'list') renderList();
  else if (ui.selfCommit === 0) onExternalChange();
  if (el.settings.open) renderSettings();
}

function onExternalChange() {
  if (!ui.draft) return;
  const fresh = store.getMeeting(ui.draft.id);
  if (!fresh) {
    ui.draft = null;
    ui.dirty.clear();
    saveLater.cancel();
    showToast('この会議は削除されました');
    location.replace('#/');
    return;
  }
  if (fresh.updatedAt === ui.baseUpdatedAt) return;
  if (isEditingInDetail()) {
    ui.staleDetail = true;
    return;
  }
  applyFresh(fresh);
}

function applyFresh(fresh) {
  const pending = {};
  for (const k of ui.dirty) pending[k] = ui.draft[k];
  ui.draft = { ...clone(fresh), ...pending };
  ui.baseUpdatedAt = fresh.updatedAt;
  ui.staleDetail = false;
  renderDetailHeader();
  renderBody();
}

// ---------- ルーティング ----------

function meetingHash(id, tab) {
  return `#/m/${encodeURIComponent(id)}/${tab}`;
}

function parseRoute() {
  const m = /^#\/m\/([^/]+)(?:\/(pre|during|post))?\/?$/.exec(location.hash);
  if (m) return { view: 'detail', id: decodeURIComponent(m[1]), tab: m[2] || null };
  return { view: 'list' };
}

function defaultTab(meeting) {
  if (meeting.status === '実施済' || meeting.status === '議事録完了') return 'post';
  return meetingYMD(meeting.start) === todayYMD() ? 'during' : 'pre';
}

function onRoute() {
  flushAll();
  const route = parseRoute();
  if (route.view !== 'detail') {
    showList();
    return;
  }
  const meeting = store.getMeeting(route.id);
  if (!meeting) {
    showToast('会議が見つかりません', { error: true });
    location.replace('#/');
    return;
  }
  const tab = route.tab || defaultTab(meeting);
  if (!route.tab) history.replaceState(null, '', meetingHash(meeting.id, tab));
  openDetail(meeting, tab);
}

function showList() {
  stopDictation();
  ui.view = 'list';
  ui.draft = null;
  ui.meetingId = null;
  ui.dirty.clear();
  ui.lastField = null;
  ui.lastFieldKey = null;
  el.detailView.hidden = true;
  el.listView.hidden = false;
  document.title = '議事録';
  updateMicVisibility();
  renderList();
}

function openDetail(meeting, tab) {
  const same = ui.draft && ui.draft.id === meeting.id;
  ui.draft = clone(meeting);
  ui.baseUpdatedAt = meeting.updatedAt;
  ui.dirty.clear();
  ui.staleDetail = false;
  if (!same) {
    ui.selectedAgendaId = null;
    ui.lastField = null;
    ui.lastFieldKey = null;
    el.body.replaceChildren();
  }
  ui.view = 'detail';
  ui.meetingId = meeting.id;
  ui.tab = tab;
  el.listView.hidden = true;
  el.detailView.hidden = false;
  renderDetailHeader();
  renderDetailTabs();
  renderBody();
  updateMicVisibility();
  window.scrollTo(0, 0);
}

// ---------- 一覧 ----------

function searchableText(m) {
  return [
    m.title,
    m.location,
    m.attendees.join(' '),
    m.freeMemo,
    m.minutes,
    ...m.agenda.map((a) => `${a.title} ${a.memo}`),
    ...m.preChecks.map((p) => `${p.text} ${p.note}`),
    ...m.decisions.map((d) => d.text),
    ...m.tasks.map((t) => `${t.title} ${t.assignee}`),
  ]
    .join('\n')
    .toLowerCase();
}

function compareAsc(a, b) {
  const ta = startTime(a);
  const tb = startTime(b);
  if (ta === tb) return a.createdAt < b.createdAt ? -1 : 1;
  if (ta === null) return 1;
  if (tb === null) return -1;
  return ta - tb;
}

function compareDesc(a, b) {
  const ta = startTime(a);
  const tb = startTime(b);
  if (ta === tb) return a.createdAt < b.createdAt ? 1 : -1;
  if (ta === null) return -1;
  if (tb === null) return 1;
  return tb - ta;
}

function filteredMeetings() {
  const today = todayYMD();
  const terms = ui.query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  let list = store.getMeetings().filter((m) => {
    const ymd = meetingYMD(m.start);
    switch (ui.filter) {
      case 'today':
        return ymd === today;
      case 'upcoming':
        return !ymd || ymd > today;
      case 'past':
        return Boolean(ymd) && ymd < today;
      default:
        return true;
    }
  });
  if (terms.length) {
    list = list.filter((m) => {
      const text = searchableText(m);
      return terms.every((t) => text.includes(t));
    });
  }
  return [...list].sort(ui.filter === 'past' || ui.filter === 'all' ? compareDesc : compareAsc);
}

function meetingCard(m) {
  const openTasks = m.tasks.filter((t) => !t.done).length;
  const metaItems = [
    h('span', {}, formatDateTimeRange(m.start, m.end) || '日時未設定'),
    m.location ? h('span', {}, m.location) : null,
    openTasks > 0 ? h('span', { class: 'card-tasks' }, `未完了タスク ${openTasks}件`) : null,
  ];
  return h(
    'li',
    {},
    h(
      'a',
      { class: 'meeting-card', href: meetingHash(m.id, defaultTab(m)) },
      h(
        'div',
        { class: 'card-top' },
        h('h2', { class: 'card-title' }, m.title || '（無題の会議）'),
        h('span', { class: 'badge', dataset: { status: m.status } }, m.status),
      ),
      h('div', { class: 'card-meta' }, metaItems),
    ),
  );
}

const EMPTY_TEXT = {
  today: '今日の会議はありません',
  upcoming: '予定している会議はありません',
  past: '過去の会議はありません',
  all: '会議はありません',
};

function renderList() {
  const meetings = filteredMeetings();
  el.meetingList.replaceChildren(...meetings.map(meetingCard));
  el.listEmpty.hidden = meetings.length > 0;
  if (meetings.length === 0) {
    el.listEmpty.textContent = store.getMeetings().length === 0
      ? '会議がありません。右下の「新規会議」から作成してください'
      : ui.query.trim()
        ? '該当する会議はありません'
        : EMPTY_TEXT[ui.filter];
  }
}

function setFilter(filter) {
  ui.filter = filter;
  for (const tab of el.listTabs) {
    const active = tab.dataset.filter === filter;
    tab.classList.toggle('is-active', active);
    tab.setAttribute('aria-pressed', String(active));
  }
  renderList();
}

// ---------- 詳細ヘッダ ----------

function updateMetaSummary() {
  const m = ui.draft;
  el.metaWhen.textContent = formatDateTimeRange(m.start, m.end) || '日時未設定';
  el.metaWhere.textContent = [m.location, m.attendees.join('、')].filter(Boolean).join(' ／ ');
}

function renderDetailHeader() {
  const m = ui.draft;
  if (!m) return;
  setValue(el.title, m.title);
  const s = splitPoint(m.start);
  const e = YMD_RE.test(m.end || '') ? { time: '' } : splitPoint(m.end);
  setValue(el.date, s.date);
  setValue(el.startTime, s.time);
  setValue(el.endTime, e.time);
  setValue(el.location, m.location);
  if (document.activeElement !== el.attendees && parseList(el.attendees.value).join('\u0000') !== m.attendees.join('\u0000')) {
    el.attendees.value = m.attendees.join(', ');
  }
  el.status.value = m.status;
  updateMetaSummary();
  document.title = m.title ? `${m.title} - 議事録` : '議事録';
}

function renderDetailTabs() {
  for (const tab of el.detailTabs) {
    const active = tab.dataset.tab === ui.tab;
    tab.classList.toggle('is-active', active);
    tab.setAttribute('aria-pressed', String(active));
  }
}

function onMetaTimeChange() {
  if (!ui.draft) return;
  const r = buildRange(el.date.value, el.startTime.value, el.endTime.value);
  ui.draft.start = r.start;
  ui.draft.end = r.end;
  saveNow('start', 'end');
  updateMetaSummary();
}

function setStatus(status) {
  if (!ui.draft) return;
  ui.draft.status = status;
  el.status.value = status;
  saveNow('status');
}

function deleteMeeting() {
  const m = ui.draft;
  if (!m) return;
  if (!window.confirm(`「${m.title || '無題の会議'}」を削除しますか？`)) return;
  flushAll();
  const snapshot = clone(store.getMeeting(m.id));
  ui.draft = null;
  ui.dirty.clear();
  withSelfCommit(() => store.deleteMeeting(m.id));
  location.hash = '#/';
  if (!snapshot) return;
  showToast('会議を削除しました', {
    actionLabel: '元に戻す',
    duration: 8000,
    onAction: () => {
      store.restoreMeeting(snapshot);
      showToast('元に戻しました', { duration: 2000 });
    },
  });
}

// ---------- 詳細本文 ----------

function autogrow(ta) {
  if (SUPPORTS_FIELD_SIZING) return;
  ta.style.setProperty('--auto-h', 'auto');
  ta.style.setProperty('--auto-h', `${ta.scrollHeight + 2}px`);
}

function autogrowAll() {
  if (SUPPORTS_FIELD_SIZING) return;
  for (const ta of el.detailView.querySelectorAll('textarea.autogrow')) autogrow(ta);
}

function panel(title, { note, headExtra, className = '' } = {}, ...children) {
  return h(
    'section',
    { class: `panel ${className}`.trim() },
    h('div', { class: 'panel-head' }, h('h2', {}, title, note ? h('span', { class: 'panel-note' }, `　${note}`) : null), headExtra || null),
    children,
  );
}

function iconBtn(label, glyph, key, onclick, { disabled = false, className = '' } = {}) {
  return h('button', {
    type: 'button',
    class: `icon-btn ${className}`.trim(),
    'aria-label': label,
    title: label,
    disabled,
    dataset: { key },
    onclick,
  }, glyph);
}

function moveItem(listKey, id, dir, focusKey) {
  const arr = ui.draft?.[listKey];
  if (!arr) return;
  const i = arr.findIndex((x) => x.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= arr.length) return;
  [arr[i], arr[j]] = [arr[j], arr[i]];
  saveNow(listKey);
  renderBody({ focusKey });
}

function removeItem(listKey, id, { confirmText } = {}) {
  const arr = ui.draft?.[listKey];
  if (!arr) return;
  const i = arr.findIndex((x) => x.id === id);
  if (i < 0) return;
  if (confirmText && !window.confirm(confirmText)) return;
  const [removed] = arr.splice(i, 1);
  saveNow(listKey);
  renderBody();
  return { removed, index: i };
}

function itemActions(listKey, id, index, length, prefix, removeOpts) {
  return h(
    'div',
    { class: 'item-actions' },
    iconBtn('上へ', '↑', `${prefix}-up-${id}`, () => moveItem(listKey, id, -1, `${prefix}-up-${id}`), { disabled: index === 0 }),
    iconBtn('下へ', '↓', `${prefix}-down-${id}`, () => moveItem(listKey, id, 1, `${prefix}-down-${id}`), { disabled: index === length - 1 }),
    iconBtn('削除', '×', `${prefix}-del-${id}`, () => removeItem(listKey, id, removeOpts ? removeOpts() : {}), { className: 'delete' }),
  );
}

function preCheckRow(item, index, length) {
  const id = item.id;
  const li = h('li', { class: `item-row${item.checked ? ' is-checked' : ''}` });
  const cb = h('input', {
    type: 'checkbox',
    checked: item.checked,
    'aria-label': '確認済み',
    dataset: { key: `pc-check-${id}` },
    onchange: () => {
      li.classList.toggle('is-checked', cb.checked);
      editItem('preChecks', id, (x) => {
        x.checked = cb.checked;
      });
    },
  });
  const text = h('input', {
    type: 'text',
    value: item.text,
    placeholder: '確認事項',
    'aria-label': '確認事項',
    dataset: { key: `pc-text-${id}` },
    oninput: () => editItem('preChecks', id, (x) => {
      x.text = text.value;
    }),
  });
  const note = h('input', {
    type: 'text',
    class: 'note',
    value: item.note,
    placeholder: 'メモ',
    'aria-label': `${item.text || '確認事項'}のメモ`,
    dataset: { key: `pc-note-${id}` },
    oninput: () => editItem('preChecks', id, (x) => {
      x.note = note.value;
    }),
  });
  li.append(
    h('label', { class: 'check-box' }, cb),
    h('div', { class: 'item-fields' }, text, note),
    itemActions('preChecks', id, index, length, 'pc'),
  );
  return li;
}

function agendaEditRow(item, index, length) {
  const id = item.id;
  const title = h('input', {
    type: 'text',
    value: item.title,
    placeholder: 'アジェンダ',
    'aria-label': `アジェンダ${index + 1}`,
    dataset: { key: `ag-title-${id}` },
    oninput: () => editItem('agenda', id, (x) => {
      x.title = title.value;
    }),
  });
  return h(
    'li',
    { class: 'item-row no-check' },
    h('span', { class: 'item-num' }, `${index + 1}.`),
    h('div', { class: 'item-fields' }, title),
    itemActions('agenda', id, index, length, 'ag', () => {
      const a = findItem('agenda', id);
      return a && a.memo.trim() ? { confirmText: `「${a.title || '無題'}」を削除しますか？ メモも削除されます` } : {};
    }),
  );
}

function addItem(listKey, item, focusKey) {
  if (!ui.draft) return;
  ui.draft[listKey].push(item);
  saveNow(listKey);
  renderBody({ focusKey });
}

function buildPre() {
  const m = ui.draft;
  const checks = h('ul', { class: 'item-list' }, m.preChecks.map((x, i) => preCheckRow(x, i, m.preChecks.length)));
  const agenda = h('ol', { class: 'item-list' }, m.agenda.map((x, i) => agendaEditRow(x, i, m.agenda.length)));
  const out = [
    panel(
      '事前確認事項',
      {},
      m.preChecks.length ? checks : h('p', { class: 'hint' }, '確認事項はありません'),
      h('button', {
        type: 'button',
        class: 'btn small',
        dataset: { key: 'pc-add' },
        onclick: () => {
          const id = newId();
          addItem('preChecks', { id, text: '', checked: false, note: '' }, `pc-text-${id}`);
        },
      }, '項目を追加'),
    ),
    panel(
      'アジェンダ',
      {},
      m.agenda.length ? agenda : h('p', { class: 'hint' }, 'アジェンダはありません'),
      h('button', {
        type: 'button',
        class: 'btn small',
        dataset: { key: 'ag-add' },
        onclick: () => {
          const id = newId();
          addItem('agenda', { id, title: '', memo: '' }, `ag-title-${id}`);
        },
      }, 'アジェンダを追加'),
    ),
  ];
  if (m.description && m.description.trim()) {
    out.push(panel('カレンダーの説明', { note: '参考' }, h('p', { class: 'description' }, m.description)));
  }
  return out;
}

function selectAgenda(id, { scroll = false } = {}) {
  ui.selectedAgendaId = id;
  for (const btn of el.body.querySelectorAll('.agenda-nav-btn')) {
    btn.classList.toggle('is-selected', btn.dataset.agendaId === id);
  }
  for (const art of el.body.querySelectorAll('.agenda-memo')) {
    art.classList.toggle('is-selected', art.dataset.agendaId === id);
  }
  if (!scroll) return;
  const art = el.body.querySelector(`.agenda-memo[data-agenda-id="${CSS.escape(id)}"]`);
  if (!art) return;
  art.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const ta = art.querySelector('textarea');
  if (ta) ta.focus({ preventScroll: true });
}

function agendaMemo(item, index) {
  const id = item.id;
  const ta = h('textarea', {
    class: 'memo-area autogrow',
    value: item.memo,
    placeholder: 'メモ',
    'aria-label': `${item.title || 'アジェンダ'}のメモ`,
    dataset: { key: `ag-memo-${id}` },
    oninput: () => {
      editItem('agenda', id, (x) => {
        x.memo = ta.value;
      });
      autogrow(ta);
      const nav = el.body.querySelector(`.agenda-nav-btn[data-agenda-id="${CSS.escape(id)}"]`);
      if (nav) nav.classList.toggle('has-memo', Boolean(ta.value.trim()));
    },
    onfocus: () => selectAgenda(id),
  });
  return h(
    'article',
    {
      class: `panel agenda-memo${ui.selectedAgendaId === id ? ' is-selected' : ''}`,
      dataset: { agendaId: id },
    },
    h('h3', { class: 'panel-title' }, `${index + 1}. ${item.title || '（無題）'}`),
    ta,
  );
}

function memoPanel(title, key, field, placeholder) {
  const ta = h('textarea', {
    class: 'memo-area small autogrow',
    value: ui.draft[field],
    placeholder,
    'aria-label': title,
    dataset: { key },
    oninput: () => {
      if (!ui.draft) return;
      ui.draft[field] = ta.value;
      markDirty(field);
      autogrow(ta);
    },
  });
  return panel(title, {}, ta);
}

function buildDecisions() {
  const m = ui.draft;
  const list = h(
    'ol',
    { class: 'item-list' },
    m.decisions.map((d, i) => {
      const input = h('input', {
        type: 'text',
        value: d.text,
        'aria-label': `決定事項${i + 1}`,
        dataset: { key: `dec-${d.id}` },
        oninput: () => editItem('decisions', d.id, (x) => {
          x.text = input.value;
        }),
      });
      return h(
        'li',
        { class: 'item-row no-check' },
        h('span', { class: 'item-num' }, `${i + 1}.`),
        h('div', { class: 'item-fields' }, input),
        h('div', { class: 'item-actions' }, iconBtn('削除', '×', `dec-del-${d.id}`, () => removeItem('decisions', d.id), { className: 'delete' })),
      );
    }),
  );
  const newInput = h('input', {
    type: 'text',
    placeholder: '決定事項を追加',
    'aria-label': '決定事項を追加',
    enterKeyHint: 'done',
    dataset: { key: 'dec-new' },
  });
  const add = () => {
    const text = newInput.value.trim();
    if (!text) {
      newInput.focus();
      return;
    }
    addItem('decisions', { id: newId(), text }, 'dec-new');
  };
  newInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.isComposing) {
      e.preventDefault();
      add();
    }
  });
  return panel(
    '決定事項',
    {},
    m.decisions.length ? list : null,
    h('div', { class: 'add-row' }, newInput, h('button', { type: 'button', class: 'btn', dataset: { key: 'dec-add' }, onclick: add }, '追加')),
  );
}

function taskappEnabled() {
  return Boolean(store.getSettings().taskappIntegration?.enabled);
}

function taskRow(t, withSend) {
  const id = t.id;
  const li = h('li', { class: `task-row${t.done ? ' is-done' : ''}` });
  const cb = h('input', {
    type: 'checkbox',
    checked: t.done,
    'aria-label': '完了',
    dataset: { key: `task-done-${id}` },
    onchange: () => {
      li.classList.toggle('is-done', cb.checked);
      editItem('tasks', id, (x) => {
        x.done = cb.checked;
      });
    },
  });
  const title = h('input', {
    type: 'text',
    class: 'task-title',
    value: t.title,
    placeholder: 'タスク名',
    'aria-label': 'タスク名',
    dataset: { key: `task-title-${id}` },
    oninput: () => editItem('tasks', id, (x) => {
      x.title = title.value;
    }),
  });
  const assignee = h('input', {
    type: 'text',
    value: t.assignee,
    placeholder: '担当',
    'aria-label': '担当',
    dataset: { key: `task-assignee-${id}` },
    oninput: () => editItem('tasks', id, (x) => {
      x.assignee = assignee.value;
    }),
  });
  const due = h('input', {
    type: 'date',
    value: t.due || '',
    'aria-label': '期限',
    dataset: { key: `task-due-${id}` },
    onchange: () => editItem('tasks', id, (x) => {
      x.due = due.value || null;
    }),
  });
  const side = h('div', { class: 'task-side' });
  if (t.sentToTaskapp) side.append(h('span', { class: 'badge sent' }, '送信済'));
  else if (withSend && taskappEnabled()) {
    side.append(h('button', {
      type: 'button',
      class: 'btn small',
      dataset: { key: `task-send-${id}` },
      onclick: () => sendToTaskapp([id]),
    }, 'taskappへ送信'));
  }
  side.append(iconBtn('タスクを削除', '×', `task-del-${id}`, () => deleteTask(id), { className: 'delete' }));
  li.append(h('label', { class: 'check-box' }, cb), h('div', { class: 'task-fields' }, title, assignee, due), side);
  return li;
}

function deleteTask(id) {
  const result = removeItem('tasks', id);
  if (!result) return;
  const meetingId = ui.draft?.id;
  showToast('タスクを削除しました', {
    actionLabel: '元に戻す',
    onAction: () => {
      if (!ui.draft || ui.draft.id !== meetingId) {
        const m = store.getMeeting(meetingId);
        if (!m) return;
        const tasks = [...m.tasks];
        tasks.splice(Math.min(result.index, tasks.length), 0, result.removed);
        store.updateMeeting(meetingId, { tasks });
        return;
      }
      ui.draft.tasks.splice(Math.min(result.index, ui.draft.tasks.length), 0, result.removed);
      saveNow('tasks');
      renderBody();
    },
  });
}

function buildTasksPanel({ withSend = false } = {}) {
  const tasks = ui.draft.tasks;
  let headExtra = null;
  const extra = [];
  if (withSend) {
    const unsent = tasks.filter((t) => !t.sentToTaskapp && t.title.trim()).length;
    const enabled = taskappEnabled();
    headExtra = h('button', {
      type: 'button',
      class: 'btn small primary',
      disabled: !enabled || unsent === 0,
      dataset: { key: 'task-send-all' },
      onclick: () => sendToTaskapp(null),
    }, unsent > 0 ? `未送信${unsent}件を一括送信` : '一括送信');
    if (!enabled) extra.push(h('p', { class: 'hint' }, 'taskapp 連携は設定で有効にできます'));
  }
  return panel(
    'タスク',
    { headExtra },
    tasks.length
      ? h('ul', { class: 'item-list' }, tasks.map((t) => taskRow(t, withSend)))
      : h('p', { class: 'hint' }, '画面下の入力欄からタスクを追加できます'),
    extra,
  );
}

function buildDuring() {
  const m = ui.draft;
  const out = [];
  if (m.status === '準備中') {
    out.push(h(
      'div',
      { class: 'banner' },
      h('span', {}, 'ステータスは「準備中」です'),
      h('button', {
        type: 'button',
        class: 'btn small',
        dataset: { key: 'mark-done' },
        onclick: () => {
          setStatus('実施済');
          renderBody();
        },
      }, '実施済にする'),
    ));
  }
  const nav = h(
    'nav',
    { class: 'agenda-nav', 'aria-label': 'アジェンダ一覧' },
    h(
      'ol',
      {},
      m.agenda.map((a, i) => h('li', {}, h('button', {
        type: 'button',
        class: `agenda-nav-btn${ui.selectedAgendaId === a.id ? ' is-selected' : ''}${a.memo.trim() ? ' has-memo' : ''}`,
        dataset: { agendaId: a.id, key: `ag-nav-${a.id}` },
        onclick: () => selectAgenda(a.id, { scroll: true }),
      }, `${i + 1}. ${a.title || '（無題）'}`))),
    ),
    h('p', { class: 'hint' }, '自由メモ・決定事項・タスクは下にあります'),
  );
  const main = h('div', { class: 'during-main' });
  if (m.agenda.length) main.append(...m.agenda.map(agendaMemo));
  else {
    main.append(panel('アジェンダ', {}, h('p', { class: 'hint' }, 'アジェンダはありません。「事前」タブで追加できます')));
  }
  main.append(memoPanel('自由メモ', 'free-memo', 'freeMemo', 'アジェンダ以外のメモ'), buildDecisions(), buildTasksPanel());
  out.push(h('div', { class: 'during-layout' }, nav, main));
  return out;
}

async function copyText(text) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {}
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.className = 'copy-buffer';
  document.body.append(ta);
  ta.select();
  ta.setSelectionRange(0, text.length);
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  ta.remove();
  return ok;
}

function currentPrompt() {
  return buildMinutesPrompt(ui.draft, store.getSettings());
}

function buildPost() {
  const preview = h('pre', {});
  const details = h(
    'details',
    {
      class: 'preview',
      ontoggle: () => {
        if (details.open && ui.draft) preview.textContent = currentPrompt();
      },
    },
    h('summary', {}, 'プレビュー'),
    preview,
  );
  const copyBtn = h('button', {
    type: 'button',
    class: 'btn primary',
    dataset: { key: 'copy-prompt' },
    onclick: async () => {
      if (!ui.draft) return;
      const text = currentPrompt();
      const ok = await copyText(text);
      if (ok) {
        showToast('議事録化用のテキストをコピーしました。Claudeに貼り付けてください');
      } else {
        preview.textContent = text;
        details.open = true;
        showToast('コピーできませんでした。プレビューから手動でコピーしてください', { error: true });
      }
    },
  }, '議事録化用にコピー');

  const minutes = h('textarea', {
    class: 'memo-area autogrow',
    value: ui.draft.minutes,
    placeholder: '生成した議事録を貼り付け',
    'aria-label': '最終議事録',
    dataset: { key: 'minutes' },
    oninput: () => {
      if (!ui.draft) return;
      ui.draft.minutes = minutes.value;
      markDirty('minutes');
      autogrow(minutes);
    },
  });
  const saveBtn = h('button', {
    type: 'button',
    class: 'btn primary',
    dataset: { key: 'minutes-save' },
    onclick: () => {
      if (!ui.draft) return;
      if (!minutes.value.trim()) {
        showToast('最終議事録を貼り付けてください', { error: true });
        minutes.focus();
        return;
      }
      ui.draft.minutes = minutes.value;
      ui.draft.status = '議事録完了';
      el.status.value = '議事録完了';
      saveNow('minutes', 'status');
      showToast('最終議事録を保存しました（ステータス: 議事録完了）');
    },
  }, '保存');

  return [
    panel(
      '議事録化',
      {},
      h('p', { class: 'hint' }, '要約ルールと会議メモをまとめたテキストをコピーします'),
      h('div', { class: 'minutes-actions' }, copyBtn),
      details,
    ),
    panel(
      '最終議事録',
      {},
      h('p', { class: 'hint' }, 'Claudeに貼り付けて生成した議事録をここに貼り戻してください'),
      minutes,
      h('div', { class: 'btn-row' }, saveBtn),
    ),
    buildTasksPanel({ withSend: true }),
  ];
}

function renderBody({ focusKey = null } = {}) {
  if (!ui.draft) return;
  const active = document.activeElement;
  const activeInBody = active && el.body.contains(active);
  const key = focusKey || (activeInBody ? active.dataset.key : null);
  let selection = null;
  if (!focusKey && activeInBody && typeof active.selectionStart === 'number') {
    selection = [active.selectionStart, active.selectionEnd];
  }
  let nodes;
  if (ui.tab === 'during') nodes = buildDuring();
  else if (ui.tab === 'post') nodes = buildPost();
  else nodes = buildPre();
  el.body.replaceChildren(...nodes);
  autogrowAll();
  if (key) {
    const target = el.body.querySelector(`[data-key="${CSS.escape(key)}"]`);
    if (target && !target.disabled) {
      target.focus({ preventScroll: true });
      if (selection && typeof target.setSelectionRange === 'function') {
        try {
          target.setSelectionRange(selection[0], selection[1]);
        } catch {}
      }
    }
  }
}

// ---------- タスク ----------

function addQuickTask(e) {
  e.preventDefault();
  if (!ui.draft) return;
  const title = el.qtTitle.value.trim();
  if (!title) {
    el.qtTitle.focus();
    return;
  }
  ui.draft.tasks.push({
    id: newId(),
    title,
    assignee: el.qtAssignee.value.trim(),
    due: el.qtDue.value || null,
    done: false,
    sentToTaskapp: false,
    taskappId: null,
  });
  saveNow('tasks');
  el.qtTitle.value = '';
  el.qtAssignee.value = '';
  el.qtDue.value = '';
  el.qtTitle.focus();
  if (ui.tab !== 'pre') renderBody();
  showToast(ui.tab === 'pre' ? 'タスクを追加しました（会議中・事後タブに表示されます）' : 'タスクを追加しました', { duration: 2000 });
}

async function sendToTaskapp(ids) {
  const settings = store.getSettings();
  if (!settings.taskappIntegration?.enabled) {
    showToast('設定で taskapp 連携を有効にしてください', { error: true });
    return;
  }
  flushAll();
  const meetingId = ui.draft?.id;
  const meeting = meetingId ? store.getMeeting(meetingId) : null;
  if (!meeting) return;
  const targets = meeting.tasks.filter((t) => !t.sentToTaskapp && t.title.trim() && (!ids || ids.includes(t.id)));
  if (targets.length === 0) {
    showToast('送信するタスクはありません');
    return;
  }
  let result;
  try {
    result = await sendTasks(meeting, targets, settings, { google, drive });
  } catch (err) {
    console.error(err);
    showToast(`taskapp への送信に失敗しました: ${errorMessage(err)}`, { error: true });
    return;
  }
  const sentIds = new Set(result.sent.map((t) => t.id));
  if (sentIds.size === 0) {
    showToast('送信するタスクはありません');
    return;
  }
  const mark = (t) => (sentIds.has(t.id) ? { ...t, sentToTaskapp: true, taskappId: t.id } : t);
  if (ui.draft && ui.draft.id === meetingId) {
    ui.draft.tasks = ui.draft.tasks.map(mark);
    saveNow('tasks');
    renderBody();
  } else {
    const latest = store.getMeeting(meetingId);
    if (latest) store.updateMeeting(meetingId, { tasks: latest.tasks.map(mark) });
  }
  const n = sentIds.size;
  if (!google.isSignedIn()) {
    showToast(`${n}件を端末内のみ送信（同じ端末でtaskappを開くと取り込まれます）`, { duration: 8000 });
  } else if (result.driveOk) {
    showToast(`${n}件のタスクを taskapp へ送信しました`);
  } else {
    showToast(`${n}件を端末内に送信しました。ドライブへの送信に失敗したため、他の端末の taskapp には届きません`, { error: true, duration: 8000 });
  }
}

// ---------- 音声入力 ----------

function trackField(e) {
  const t = e.target;
  if (!(t instanceof HTMLElement) || !el.detailView.contains(t)) return;
  if (t.matches('textarea, input[type="text"]')) {
    ui.lastField = t;
    ui.lastFieldKey = t.dataset.key || null;
  }
}

function resolveLastField() {
  const f = ui.lastField;
  if (f && f.isConnected && el.detailView.contains(f) && !f.disabled) return f;
  if (ui.lastFieldKey) {
    const found = el.detailView.querySelector(`[data-key="${CSS.escape(ui.lastFieldKey)}"]`);
    if (found) {
      ui.lastField = found;
      return found;
    }
  }
  return null;
}

function insertAtCaret(field, text) {
  const len = field.value.length;
  const start = typeof field.selectionStart === 'number' ? field.selectionStart : len;
  const end = typeof field.selectionEnd === 'number' ? field.selectionEnd : start;
  field.setRangeText(text, start, end, 'end');
  field.dispatchEvent(new Event('input', { bubbles: true }));
}

function insertDictation(text) {
  if (!text || ui.view !== 'detail' || !ui.draft) return;
  const field = resolveLastField()
    || el.body.querySelector('.agenda-memo textarea')
    || el.body.querySelector('[data-key="free-memo"]');
  if (field) {
    insertAtCaret(field, text);
    return;
  }
  ui.draft.freeMemo = ui.draft.freeMemo ? `${ui.draft.freeMemo}\n${text}` : text;
  markDirty('freeMemo');
  showToast('自由メモに追記しました', { duration: 2000 });
}

function setListening(on) {
  ui.listening = on;
  el.mic.classList.toggle('is-listening', on);
  el.mic.setAttribute('aria-pressed', String(on));
  el.mic.setAttribute('aria-label', on ? '音声入力を停止' : '音声入力');
  el.mic.title = on ? '音声入力を停止' : '音声入力';
  el.voiceBar.hidden = !on;
  el.voiceBar.textContent = on ? '聞き取り中…（もう一度押すと停止）' : '';
}

function showInterim(text) {
  if (!ui.listening) return;
  el.voiceBar.textContent = text || '聞き取り中…（もう一度押すと停止）';
}

function showKeyboardDictationHint() {
  const f = resolveLastField();
  if (f) f.focus();
  showToast('このブラウザでは音声認識を開始できませんでした。入力欄をタップし、キーボードのマイクボタンで話すと同じように入力できます', {
    error: true,
    duration: 12000,
  });
}

function onVoiceError(code, message) {
  if (IS_IOS && (code === 'not-allowed' || code === 'service-not-allowed' || code === 'not-supported')) {
    showKeyboardDictationHint();
    return;
  }
  showToast(message || `音声入力エラー（${code}）`, { error: true });
}

async function onMicClick() {
  if (!ui.dictation) return;
  if (ui.dictation.isListening()) {
    ui.dictation.stop();
    return;
  }
  if (IS_IOS) {
    try {
      await ensureMicPermission();
    } catch (err) {
      if (err && (err.name === 'NotAllowedError' || err.name === 'SecurityError')) {
        showToast(
          'Safariのマイクが拒否されています。アドレスバー左の「ぁあ」→「Webサイトの設定」→「マイク」を「許可」にし、iPhoneの「設定 → アプリ → Safari → マイク」も「確認」か「許可」にして再読み込みしてください。代わりにキーボードのマイクボタンでも入力できます',
          { error: true, duration: 15000 },
        );
        const f = resolveLastField();
        if (f) f.focus();
        return;
      }
      showKeyboardDictationHint();
      return;
    }
  }
  try {
    ui.dictation.start();
  } catch (err) {
    setListening(false);
    showToast(`音声入力を開始できません: ${errorMessage(err)}`, { error: true });
  }
}

function stopDictation() {
  if (ui.dictation && ui.dictation.isListening()) ui.dictation.stop();
}

function updateMicVisibility() {
  el.mic.hidden = !(ui.voiceSupported && ui.view === 'detail');
}

function initVoice() {
  if (!isVoiceSupported()) {
    el.mic.hidden = true;
    el.voiceSection.hidden = false;
    return;
  }
  ui.voiceSupported = true;
  ui.dictation = createDictation({
    onInterim: showInterim,
    onFinal: insertDictation,
    onStateChange: setListening,
    onError: onVoiceError,
  });
}

// ---------- 会議作成 ----------

function openCreate() {
  el.createDialog.showModal();
}

function openManual() {
  el.createDialog.close();
  el.manualForm.reset();
  el.manualDate.value = todayYMD();
  el.manualDialog.showModal();
  el.manualTitle.focus();
}

function createManual(e) {
  e.preventDefault();
  const title = el.manualTitle.value.trim();
  if (!title) {
    el.manualTitle.focus();
    return;
  }
  const { start, end } = buildRange(el.manualDate.value, el.manualStart.value, el.manualEnd.value);
  const meeting = store.createMeeting({
    title,
    start,
    end,
    location: el.manualLocation.value.trim(),
    attendees: parseList(el.manualAttendees.value),
  });
  el.manualDialog.close();
  location.hash = meetingHash(meeting.id, 'pre');
  showToast('会議を作成しました', { duration: 2000 });
}

function eventTimeLabel(ev) {
  if (ev.allDay) return '終日';
  const s = splitPoint(ev.start).time;
  const e = splitPoint(ev.end).time;
  return e ? `${s}–${e}` : s;
}

function renderEvents(events) {
  const today = todayYMD();
  const groups = new Map();
  for (const ev of events) {
    const ymd = meetingYMD(ev.start);
    if (!ymd) continue;
    if (!groups.has(ymd)) groups.set(ymd, []);
    groups.get(ymd).push(ev);
  }
  const nodes = [];
  for (const [ymd, items] of [...groups.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
    nodes.push(h(
      'section',
      { class: 'event-group' },
      h('h3', { class: ymd === today ? 'is-today' : '' }, `${formatDateTimeRange(ymd, null)}${ymd === today ? '　今日' : ''}`),
      h('ul', { class: 'event-list' }, items.map((ev) => {
        const existing = store.findByCalendarEventId(ev.id);
        return h('li', {}, h(
          'button',
          { type: 'button', class: 'event-btn', onclick: () => pickEvent(ev) },
          h('span', { class: 'event-time' }, eventTimeLabel(ev)),
          h('span', { class: 'event-title' }, ev.title, ev.location ? h('span', { class: 'event-sub' }, ev.location) : null),
          existing ? h('span', { class: 'badge sent' }, '作成済') : null,
        ));
      })),
    ));
  }
  el.eventGroups.replaceChildren(...nodes);
  if (nodes.length === 0) {
    el.calendarStatus.textContent = '前後の期間に予定はありません';
    return;
  }
  el.calendarStatus.textContent = '予定を選ぶと会議を作成します（作成済みの予定は既存の会議を開きます）';
  const todayHeading = el.eventGroups.querySelector('h3.is-today');
  if (todayHeading) todayHeading.scrollIntoView({ block: 'start' });
}

function calendarRetryButton(label) {
  return h('div', { class: 'btn-row' }, h('button', { type: 'button', class: 'btn', onclick: loadCalendarEvents }, label));
}

async function loadCalendarEvents() {
  el.eventGroups.replaceChildren();
  if (!google.isSignedIn()) {
    el.calendarStatus.textContent = 'サインインしています…';
    try {
      await google.signIn();
    } catch (err) {
      el.calendarStatus.textContent = `サインインに失敗しました: ${errorMessage(err)}`;
      el.eventGroups.replaceChildren(calendarRetryButton('サインイン'));
      return;
    }
  }
  el.calendarStatus.textContent = '予定を読み込んでいます…';
  const today = todayYMD();
  const s = store.getSettings();
  try {
    const events = await listEvents({
      calendarId: s.calendarId || DEFAULT_GCAL_CALENDAR_ID,
      from: fromYMD(addDays(today, -3)),
      to: fromYMD(addDays(today, 8)),
    });
    if (!el.calendarDialog.open) return;
    renderEvents(events);
  } catch (err) {
    console.error(err);
    el.calendarStatus.textContent = `予定を読み込めませんでした: ${errorMessage(err)}`;
    el.eventGroups.replaceChildren(calendarRetryButton('再読み込み'));
  }
}

function openCalendarPicker() {
  el.createDialog.close();
  if (!google.isConfigured()) {
    showToast('設定で Google の OAuth クライアントIDを入力してください', { error: true });
    openSettings();
    return;
  }
  el.calendarStatus.textContent = '';
  el.eventGroups.replaceChildren();
  el.calendarDialog.showModal();
  loadCalendarEvents();
}

function toAllDayYMD(iso) {
  if (!iso) return null;
  return meetingYMD(iso);
}

function pickEvent(ev) {
  el.calendarDialog.close();
  const existing = store.findByCalendarEventId(ev.id);
  if (existing) {
    location.hash = meetingHash(existing.id, defaultTab(existing));
    showToast('この予定の会議は作成済みのため、既存の会議を開きました');
    return;
  }
  const meeting = store.createMeeting({
    title: ev.title,
    start: ev.allDay ? toAllDayYMD(ev.start) : ev.start,
    end: ev.allDay ? toAllDayYMD(ev.end) : ev.end,
    location: ev.location || '',
    attendees: Array.isArray(ev.attendees) ? ev.attendees : [],
    description: ev.description || '',
    calendarEventId: ev.id,
  });
  location.hash = meetingHash(meeting.id, 'pre');
  showToast('カレンダーの予定から会議を作成しました', { duration: 2500 });
}

// ---------- 設定・同期 ----------

function renderCategoryOptions() {
  const s = store.getSettings();
  const current = s.taskappIntegration?.defaultCategoryId || '';
  const cats = readTaskappCategories();
  const options = [h('option', { value: '' }, '未分類')];
  for (const c of cats) options.push(h('option', { value: c.id }, c.name || '（名称なし）'));
  if (current && !cats.some((c) => c.id === current)) {
    options.push(h('option', { value: current }, '（この端末の taskapp にないカテゴリ）'));
  }
  el.taskappCategory.replaceChildren(...options);
  el.taskappCategory.value = current;
}

function renderGoogleStatus() {
  const configured = google.isConfigured();
  const signedIn = configured && google.isSignedIn();
  el.signIn.textContent = signedIn ? 'サインアウト' : 'サインイン';
  el.signIn.disabled = !configured;
  el.googleStatus.textContent = !configured
    ? 'クライアントIDを入力すると、カレンダーからの作成とドライブ同期が使えます'
    : signedIn
      ? 'サインイン済み'
      : '未サインイン（カレンダーからの作成・ドライブ同期にはサインインが必要です）';
}

function driveStatusText(status) {
  if (!google.isConfigured()) return 'クライアントIDを設定してサインインすると、PC とスマホで会議メモが共有されます';
  switch (status?.state) {
    case 'syncing':
      return '同期中…';
    case 'synced':
      return `同期済み（${formatClock(status.lastSyncedAt)}）`;
    case 'error':
      return `エラー: ${status.message || '同期に失敗しました'}`;
    case 'idle':
      return status.message || '同期待ち';
    default:
      return '未サインイン（サインインすると PC とスマホで会議メモが共有されます）';
  }
}

function headerStatusText(status) {
  switch (status?.state) {
    case 'syncing':
      return '同期中…';
    case 'synced':
      return `同期済み ${formatClock(status.lastSyncedAt)}`;
    case 'error':
      return '同期エラー';
    case 'idle':
      return status.message ? '同期保留中' : '同期待ち';
    default:
      return '端末内に保存';
  }
}

function renderSyncStatus(status = sync ? sync.getStatus() : null) {
  el.syncStatus.textContent = headerStatusText(status);
  el.syncStatus.title = driveStatusText(status);
  el.driveStatus.textContent = driveStatusText(status);
  el.syncNow.disabled = !google.isConfigured() || status?.state === 'syncing';
}

function onSyncStatus(status) {
  renderSyncStatus(status);
  if (status.state === 'error' && status.message && status.message !== ui.lastSyncErrorToast) {
    ui.lastSyncErrorToast = status.message;
    showToast(`データ同期に失敗しました: ${status.message}`, { error: true });
  }
  if (status.state === 'synced') ui.lastSyncErrorToast = '';
}

function renderSettings() {
  const s = store.getSettings();
  setValue(el.tplPreChecks, s.template.preChecks.join('\n'));
  setValue(el.tplAgenda, s.template.agenda.join('\n'));
  setValue(el.summaryRule, s.summaryRule);
  setValue(el.clientId, s.oauthClientId || '');
  setValue(el.calendarId, s.calendarId || DEFAULT_GCAL_CALENDAR_ID);
  el.taskappEnabled.checked = Boolean(s.taskappIntegration?.enabled);
  if (document.activeElement !== el.taskappCategory) renderCategoryOptions();
  renderGoogleStatus();
  renderSyncStatus();
}

function openSettings() {
  renderSettings();
  el.settings.showModal();
}

function configureGoogle() {
  const s = store.getSettings();
  try {
    google.configure({ clientId: (s.oauthClientId || '').trim() });
  } catch (err) {
    console.error(err);
    showToast(`Google 設定に失敗しました: ${errorMessage(err)}`, { error: true });
  }
  renderGoogleStatus();
}

async function ensureSignedIn() {
  if (!google.isConfigured()) {
    showToast('クライアントIDを設定してください', { error: true });
    return false;
  }
  if (google.isSignedIn()) return true;
  try {
    await google.signIn();
    renderGoogleStatus();
    return true;
  } catch (err) {
    showToast(`サインインに失敗しました: ${errorMessage(err)}`, { error: true });
    return false;
  }
}

async function syncNow() {
  if (!(await ensureSignedIn()) || !sync) return;
  await sync.pullNow();
  if (sync.getStatus().state === 'synced') showToast('同期しました', { duration: 2000 });
}

function downloadJSON() {
  flushAll();
  const blob = new Blob([store.exportJSON()], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `minutes-${todayYMD().replaceAll('-', '')}.json`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function importFromFile(file) {
  if (!file) return;
  const mode = (el.settings.querySelector('input[name="import-mode"]:checked') || {}).value || 'replace';
  try {
    if (mode === 'replace' && store.getMeetings().length > 0) {
      if (!window.confirm('現在の会議データをすべて置き換えます。よろしいですか？')) return;
    }
    flushAll();
    const text = await file.text();
    const { count } = store.importJSON(text, { mode });
    configureGoogle();
    showToast(`${count}件の会議をインポートしました`);
  } catch (err) {
    console.error(err);
    showToast(`インポートに失敗しました: ${errorMessage(err)}`, { error: true });
  } finally {
    el.importFile.value = '';
  }
}

// ---------- イベント ----------

function bindEvents() {
  window.addEventListener('hashchange', onRoute);

  for (const tab of el.listTabs) tab.addEventListener('click', () => setFilter(tab.dataset.filter));
  el.search.addEventListener('input', () => {
    ui.query = el.search.value;
    renderList();
  });
  el.newMeetingBtn.addEventListener('click', openCreate);
  el.createFromCalendar.addEventListener('click', openCalendarPicker);
  el.createManual.addEventListener('click', openManual);
  el.manualForm.addEventListener('submit', createManual);
  el.manualClose.addEventListener('click', () => el.manualDialog.close());

  for (const tab of el.detailTabs) {
    tab.addEventListener('click', () => {
      if (!ui.draft || !TABS.includes(tab.dataset.tab)) return;
      location.replace(meetingHash(ui.draft.id, tab.dataset.tab));
    });
  }

  el.title.addEventListener('input', () => {
    if (!ui.draft) return;
    ui.draft.title = el.title.value;
    markDirty('title');
    document.title = el.title.value ? `${el.title.value} - 議事録` : '議事録';
  });
  el.location.addEventListener('input', () => {
    if (!ui.draft) return;
    ui.draft.location = el.location.value;
    markDirty('location');
    updateMetaSummary();
  });
  el.attendees.addEventListener('input', () => {
    if (!ui.draft) return;
    ui.draft.attendees = parseList(el.attendees.value);
    markDirty('attendees');
    updateMetaSummary();
  });
  for (const input of [el.date, el.startTime, el.endTime]) input.addEventListener('change', onMetaTimeChange);
  el.status.addEventListener('change', () => {
    setStatus(el.status.value);
    if (ui.tab === 'during') renderBody();
  });
  el.deleteMeetingBtn.addEventListener('click', deleteMeeting);
  el.qtForm.addEventListener('submit', addQuickTask);

  el.detailView.addEventListener('focusin', trackField);
  el.detailView.addEventListener('focusout', () => {
    setTimeout(() => {
      if (!ui.staleDetail || !ui.draft || isEditingInDetail()) return;
      const fresh = store.getMeeting(ui.draft.id);
      if (fresh) applyFresh(fresh);
    }, 0);
  });

  el.mic.addEventListener('mousedown', (e) => e.preventDefault());
  el.mic.addEventListener('click', onMicClick);

  el.settingsBtn.addEventListener('click', openSettings);
  el.tplPreChecks.addEventListener('change', () => {
    store.updateSettings({ template: { preChecks: parseLines(el.tplPreChecks.value) } });
  });
  el.tplAgenda.addEventListener('change', () => {
    store.updateSettings({ template: { agenda: parseLines(el.tplAgenda.value) } });
  });
  el.summaryRule.addEventListener('change', () => {
    store.updateSettings({ summaryRule: el.summaryRule.value });
  });
  el.summaryReset.addEventListener('click', () => {
    if (!window.confirm('要約ルールを初期値に戻しますか？')) return;
    store.updateSettings({ summaryRule: DEFAULT_SUMMARY_RULE });
    el.summaryRule.value = DEFAULT_SUMMARY_RULE;
    showToast('要約ルールを初期値に戻しました', { duration: 2000 });
  });
  el.clientId.addEventListener('change', () => {
    store.updateSettings({ oauthClientId: el.clientId.value.trim() });
    el.clientId.value = store.getSettings().oauthClientId || '';
    configureGoogle();
    renderSyncStatus();
  });
  el.calendarId.addEventListener('change', () => {
    store.updateSettings({ calendarId: el.calendarId.value.trim() || DEFAULT_GCAL_CALENDAR_ID });
    el.calendarId.value = store.getSettings().calendarId || DEFAULT_GCAL_CALENDAR_ID;
  });
  el.signIn.addEventListener('click', async () => {
    try {
      if (google.isSignedIn()) {
        await google.signOut();
        showToast('サインアウトしました');
      } else {
        await google.signIn();
        showToast('サインインしました');
      }
    } catch (err) {
      console.error(err);
      showToast(`サインインに失敗しました: ${errorMessage(err)}`, { error: true });
    }
    renderGoogleStatus();
    renderSyncStatus();
  });
  el.syncNow.addEventListener('click', async () => {
    el.syncNow.disabled = true;
    try {
      await syncNow();
    } finally {
      renderSyncStatus();
    }
  });
  el.taskappEnabled.addEventListener('change', () => {
    store.updateSettings({ taskappIntegration: { enabled: el.taskappEnabled.checked } });
    if (ui.view === 'detail' && ui.tab === 'post') renderBody();
  });
  el.taskappCategory.addEventListener('change', () => {
    store.updateSettings({ taskappIntegration: { defaultCategoryId: el.taskappCategory.value || null } });
  });
  el.exportBtn.addEventListener('click', downloadJSON);
  el.importBtn.addEventListener('click', () => el.importFile.click());
  el.importFile.addEventListener('change', () => importFromFile(el.importFile.files[0]));

  window.addEventListener('pagehide', flushAll);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      flushAll();
      return;
    }
    if (ui.view === 'list') renderList();
  });
  window.addEventListener('resize', debounce(autogrowAll, 200));
}

function initGoogle() {
  configureGoogle();
  try {
    if (google.handleRedirectResult()) showToast('サインインしました');
  } catch (err) {
    console.error(err);
    showToast(`サインインに失敗しました: ${errorMessage(err)}`, { error: true });
  }
  try {
    google.onAuthChange(() => {
      renderGoogleStatus();
      renderSyncStatus();
    });
  } catch (err) {
    console.error(err);
  }
}

function init() {
  initGoogle();
  initVoice();
  bindEvents();
  store.subscribe(onStoreChange);
  sync = createSync({ store, google, drive, onStatus: onSyncStatus });
  sync.start();
  renderSyncStatus();
  onRoute();
}

init();
