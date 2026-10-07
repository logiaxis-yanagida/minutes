import { newId, nowISO } from './util.js';
import { DEFAULT_GCAL_CLIENT_ID, DEFAULT_GCAL_CALENDAR_ID } from './config.js';

const STORAGE_KEY = 'minutes.v1';
const TOMBSTONE_TTL_MS = 90 * 24 * 60 * 60 * 1000;

export const MEETING_STATUSES = ['準備中', '実施済', '議事録完了'];

export const DEFAULT_TEMPLATE = Object.freeze({
  preChecks: Object.freeze([
    '会議の目的・ゴール',
    '前回からの持ち越し事項',
    '事前に確認・準備すべき資料',
    '自分から確認したいこと',
  ]),
  agenda: Object.freeze([
    '前回の振り返り',
    '本題',
    '決定事項の確認',
    '次回までのタスク・次回日程',
  ]),
});

export const DEFAULT_SUMMARY_RULE = `以下の会議メモをもとに議事録を作成してください。

【出力形式】
1. 会議概要（日時・場所・参加者・目的）
2. 決定事項（箇条書き）
3. 議論の要点（アジェンダごとに3行程度）
4. タスク一覧（タスク／担当／期限）
5. 保留・持ち越し事項
6. 次回予定

【ルール】
- 事実と意見を分けて書く
- メモにない内容は推測で補わない。不明な点は「要確認」と明記する
- 敬語・常体の統一：常体`;

const memoryStorage = (() => {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
  };
})();

function getStorage() {
  try {
    if (typeof globalThis.localStorage !== 'undefined' && globalThis.localStorage) {
      return globalThis.localStorage;
    }
  } catch {
    return memoryStorage;
  }
  return memoryStorage;
}

function isYMD(v) {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
}

function isISO(v) {
  return typeof v === 'string' && v.length > 0 && !Number.isNaN(Date.parse(v));
}

function str(v) {
  return typeof v === 'string' ? v : '';
}

function stringList(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.filter((s) => typeof s === 'string').map((s) => s.trim()).filter(Boolean);
}

function defaultSettings() {
  return {
    template: { preChecks: [...DEFAULT_TEMPLATE.preChecks], agenda: [...DEFAULT_TEMPLATE.agenda] },
    summaryRule: DEFAULT_SUMMARY_RULE,
    oauthClientId: DEFAULT_GCAL_CLIENT_ID,
    calendarId: DEFAULT_GCAL_CALENDAR_ID,
    taskappIntegration: { enabled: true, defaultCategoryId: null },
  };
}

function defaultState() {
  return { version: 1, meetings: [], settings: defaultSettings(), settingsUpdatedAt: null, deleted: {} };
}

function normalizeTemplate(raw) {
  const base = defaultSettings().template;
  if (!raw || typeof raw !== 'object') return base;
  return {
    preChecks: Array.isArray(raw.preChecks) ? stringList(raw.preChecks) : base.preChecks,
    agenda: Array.isArray(raw.agenda) ? stringList(raw.agenda) : base.agenda,
  };
}

function normalizeSettings(raw) {
  const base = defaultSettings();
  if (!raw || typeof raw !== 'object') return base;
  const ti = raw.taskappIntegration && typeof raw.taskappIntegration === 'object' ? raw.taskappIntegration : {};
  return {
    template: normalizeTemplate(raw.template),
    summaryRule: typeof raw.summaryRule === 'string' ? raw.summaryRule : base.summaryRule,
    oauthClientId:
      typeof raw.oauthClientId === 'string' && raw.oauthClientId.trim() ? raw.oauthClientId.trim() : base.oauthClientId,
    calendarId: typeof raw.calendarId === 'string' && raw.calendarId.trim() ? raw.calendarId.trim() : base.calendarId,
    taskappIntegration: {
      enabled: typeof ti.enabled === 'boolean' ? ti.enabled : base.taskappIntegration.enabled,
      defaultCategoryId: typeof ti.defaultCategoryId === 'string' && ti.defaultCategoryId ? ti.defaultCategoryId : null,
    },
  };
}

function normalizeItems(raw, mapper) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  const out = [];
  for (const r of raw) {
    const item = mapper(r);
    if (!item) continue;
    if (!item.id || seen.has(item.id)) item.id = newId();
    seen.add(item.id);
    out.push(item);
  }
  return out;
}

function itemId(r) {
  return r && typeof r === 'object' && typeof r.id === 'string' && r.id ? r.id : '';
}

function normalizePreCheck(r) {
  if (typeof r === 'string') return { id: '', text: r, checked: false, note: '' };
  if (!r || typeof r !== 'object') return null;
  return { id: itemId(r), text: str(r.text), checked: Boolean(r.checked), note: str(r.note) };
}

function normalizeAgendaItem(r) {
  if (typeof r === 'string') return { id: '', title: r, memo: '' };
  if (!r || typeof r !== 'object') return null;
  return { id: itemId(r), title: str(r.title), memo: str(r.memo) };
}

function normalizeDecision(r) {
  if (typeof r === 'string') return { id: '', text: r };
  if (!r || typeof r !== 'object') return null;
  return { id: itemId(r), text: str(r.text) };
}

function normalizeMeetingTask(r) {
  if (typeof r === 'string') return normalizeMeetingTask({ title: r });
  if (!r || typeof r !== 'object') return null;
  return {
    id: itemId(r),
    title: str(r.title),
    assignee: str(r.assignee),
    due: isYMD(r.due) ? r.due : null,
    done: Boolean(r.done),
    sentToTaskapp: Boolean(r.sentToTaskapp),
    taskappId: typeof r.taskappId === 'string' && r.taskappId ? r.taskappId : null,
  };
}

function normalizeMeeting(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const now = nowISO();
  const createdAt = isISO(raw.createdAt) ? raw.createdAt : now;
  const dateish = (v) => (isISO(v) || isYMD(v) ? v : null);
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : newId(),
    title: str(raw.title),
    start: dateish(raw.start),
    end: dateish(raw.end),
    location: str(raw.location),
    attendees: stringList(raw.attendees),
    description: str(raw.description),
    calendarEventId: typeof raw.calendarEventId === 'string' && raw.calendarEventId ? raw.calendarEventId : null,
    preChecks: normalizeItems(raw.preChecks, normalizePreCheck),
    agenda: normalizeItems(raw.agenda, normalizeAgendaItem),
    freeMemo: str(raw.freeMemo),
    decisions: normalizeItems(raw.decisions, normalizeDecision),
    tasks: normalizeItems(raw.tasks, normalizeMeetingTask),
    minutes: str(raw.minutes),
    status: MEETING_STATUSES.includes(raw.status) ? raw.status : MEETING_STATUSES[0],
    createdAt,
    updatedAt: isISO(raw.updatedAt) ? raw.updatedAt : createdAt,
  };
}

function normalizeMeetings(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  const out = [];
  for (const m of raw.map(normalizeMeeting).filter(Boolean)) {
    if (seen.has(m.id)) continue;
    seen.add(m.id);
    out.push(m);
  }
  return out;
}

function normalizeDeleted(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [id, at] of Object.entries(raw)) {
    if (typeof id === 'string' && id && isISO(at)) out[id] = at;
  }
  return out;
}

function pruneDeleted(deleted, now = Date.now()) {
  const out = {};
  for (const [id, at] of Object.entries(deleted)) {
    if (now - Date.parse(at) < TOMBSTONE_TTL_MS) out[id] = at;
  }
  return out;
}

function normalizeState(raw) {
  const base = defaultState();
  if (!raw || typeof raw !== 'object') return base;
  return {
    version: 1,
    meetings: normalizeMeetings(raw.meetings),
    settings: normalizeSettings(raw.settings),
    settingsUpdatedAt: isISO(raw.settingsUpdatedAt) ? raw.settingsUpdatedAt : null,
    deleted: pruneDeleted(normalizeDeleted(raw.deleted)),
  };
}

function load() {
  try {
    const json = getStorage().getItem(STORAGE_KEY);
    if (!json) return defaultState();
    return normalizeState(JSON.parse(json));
  } catch {
    return defaultState();
  }
}

let state = load();
const listeners = new Set();

function persist() {
  try {
    getStorage().setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (err) {
    console.error('保存に失敗しました', err);
  }
}

function notify() {
  for (const fn of listeners) fn(state);
}

function commit() {
  persist();
  notify();
}

if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('storage', (e) => {
    if (e.key !== STORAGE_KEY && e.key !== null) return;
    state = load();
    notify();
  });
}

function findMeeting(id) {
  return state.meetings.find((m) => m.id === id) || null;
}

function mergeDeletedMaps(a, b) {
  const out = { ...a };
  for (const [id, at] of Object.entries(b)) {
    if (!out[id] || out[id] < at) out[id] = at;
  }
  return out;
}

function isTombstoned(deleted, item) {
  const at = deleted[item.id];
  return Boolean(at) && at >= item.updatedAt;
}

function mergeCollection(localItems, remoteItems, deleted) {
  const result = [];
  const remoteById = new Map(remoteItems.map((r) => [r.id, r]));
  const seen = new Set();
  for (const local of localItems) {
    seen.add(local.id);
    const remote = remoteById.get(local.id);
    const candidate = remote && remote.updatedAt > local.updatedAt ? remote : local;
    if (isTombstoned(deleted, candidate)) continue;
    result.push(candidate);
  }
  for (const remote of remoteItems) {
    if (seen.has(remote.id)) continue;
    if (isTombstoned(deleted, remote)) continue;
    result.push(remote);
  }
  return result;
}

function reviveImported(items, deleted) {
  const now = nowISO();
  return items.map((item) => {
    if (!deleted[item.id]) return item;
    delete deleted[item.id];
    return { ...item, updatedAt: now };
  });
}

function isNewerShared(remoteAt, localAt) {
  if (!isISO(remoteAt)) return false;
  return !localAt || remoteAt > localAt;
}

function expandTemplate(template) {
  return {
    preChecks: template.preChecks.map((text) => ({ id: newId(), text, checked: false, note: '' })),
    agenda: template.agenda.map((title) => ({ id: newId(), title, memo: '' })),
  };
}

export const store = {
  getState() {
    return state;
  },
  getMeetings() {
    return state.meetings;
  },
  getMeeting(id) {
    return findMeeting(id);
  },
  getSettings() {
    return state.settings;
  },

  createMeeting(partial = {}) {
    const p = partial && typeof partial === 'object' ? partial : {};
    const now = nowISO();
    const meeting = normalizeMeeting({
      ...expandTemplate(state.settings.template),
      ...p,
      id: newId(),
      title: str(p.title).trim(),
      status: p.status ?? MEETING_STATUSES[0],
      createdAt: now,
      updatedAt: now,
    });
    state.meetings = [...state.meetings, meeting];
    commit();
    return meeting;
  },

  findByCalendarEventId(eventId) {
    if (typeof eventId !== 'string' || !eventId) return null;
    return state.meetings.find((m) => m.calendarEventId === eventId) || null;
  },

  updateMeeting(id, patch = {}) {
    const current = findMeeting(id);
    if (!current) return null;
    const merged = normalizeMeeting({
      ...current,
      ...patch,
      id: current.id,
      createdAt: current.createdAt,
      updatedAt: nowISO(),
    });
    state.meetings = state.meetings.map((m) => (m.id === id ? merged : m));
    commit();
    return merged;
  },

  deleteMeeting(id) {
    const current = findMeeting(id);
    if (!current) return null;
    state.meetings = state.meetings.filter((m) => m.id !== id);
    state.deleted = { ...state.deleted, [id]: nowISO() };
    commit();
    return current;
  },

  restoreMeeting(meeting) {
    const normalized = normalizeMeeting(meeting);
    if (!normalized) return null;
    const restored = { ...normalized, updatedAt: nowISO() };
    const deleted = { ...state.deleted };
    delete deleted[restored.id];
    state.deleted = deleted;
    state.meetings = findMeeting(restored.id)
      ? state.meetings.map((m) => (m.id === restored.id ? restored : m))
      : [...state.meetings, restored];
    commit();
    return restored;
  },

  updateSettings(patch = {}) {
    const next = normalizeSettings({
      ...state.settings,
      ...patch,
      template: patch.template ? { ...state.settings.template, ...patch.template } : state.settings.template,
      taskappIntegration: patch.taskappIntegration
        ? { ...state.settings.taskappIntegration, ...patch.taskappIntegration }
        : state.settings.taskappIntegration,
    });
    const sharedChanged =
      JSON.stringify(next.template) !== JSON.stringify(state.settings.template)
      || next.summaryRule !== state.settings.summaryRule;
    state.settings = next;
    if (sharedChanged) state.settingsUpdatedAt = nowISO();
    commit();
    return state.settings;
  },

  exportJSON() {
    return JSON.stringify(state, null, 2);
  },

  importJSON(text, { mode = 'replace' } = {}) {
    const parsed = typeof text === 'string' ? JSON.parse(text) : text;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('読み込めない形式です');
    }
    const incoming = normalizeState(parsed);
    const hasSettings = Boolean(parsed.settings && typeof parsed.settings === 'object');
    const deleted = pruneDeleted(mergeDeletedMaps(state.deleted, incoming.deleted));

    if (mode !== 'merge') {
      const meetings = reviveImported(incoming.meetings, deleted);
      state = {
        version: 1,
        meetings,
        settings: hasSettings ? incoming.settings : state.settings,
        settingsUpdatedAt: hasSettings ? incoming.settingsUpdatedAt : state.settingsUpdatedAt,
        deleted,
      };
      commit();
      return { count: meetings.length };
    }

    const byId = new Map(state.meetings.map((m) => [m.id, m]));
    let count = 0;
    for (const m of incoming.meetings) {
      const local = byId.get(m.id);
      if (deleted[m.id]) {
        const [revived] = reviveImported([m], deleted);
        byId.set(m.id, revived);
        count += 1;
      } else if (!local || m.updatedAt > local.updatedAt) {
        byId.set(m.id, m);
        count += 1;
      }
    }
    const order = [...state.meetings.map((m) => m.id), ...incoming.meetings.map((m) => m.id)];
    const meetings = [...new Set(order)].map((id) => byId.get(id)).filter(Boolean);
    let { settings, settingsUpdatedAt } = state;
    if (hasSettings && isNewerShared(incoming.settingsUpdatedAt, settingsUpdatedAt)) {
      settings = { ...settings, template: incoming.settings.template, summaryRule: incoming.settings.summaryRule };
      settingsUpdatedAt = incoming.settingsUpdatedAt;
    }
    state = { ...state, meetings, settings, settingsUpdatedAt, deleted };
    commit();
    return { count };
  },

  getSyncPayload() {
    return {
      version: 1,
      meetings: state.meetings,
      deleted: state.deleted,
      shared: {
        template: state.settings.template,
        summaryRule: state.settings.summaryRule,
        settingsUpdatedAt: state.settingsUpdatedAt,
      },
      savedAt: nowISO(),
    };
  },

  mergeRemote(remote) {
    if (!remote || typeof remote !== 'object') return { changed: false };
    const remoteMeetings = normalizeMeetings(remote.meetings);
    const deleted = pruneDeleted(mergeDeletedMaps(state.deleted, normalizeDeleted(remote.deleted)));
    const meetings = mergeCollection(state.meetings, remoteMeetings, deleted);
    for (const m of meetings) {
      if (deleted[m.id]) delete deleted[m.id];
    }

    let { settings, settingsUpdatedAt } = state;
    const shared = remote.shared && typeof remote.shared === 'object' ? remote.shared : null;
    if (shared && isNewerShared(shared.settingsUpdatedAt, settingsUpdatedAt)) {
      const normalized = normalizeSettings({ template: shared.template, summaryRule: shared.summaryRule });
      settings = { ...settings, template: normalized.template, summaryRule: normalized.summaryRule };
      settingsUpdatedAt = shared.settingsUpdatedAt;
    }

    const changed =
      JSON.stringify(meetings) !== JSON.stringify(state.meetings)
      || JSON.stringify(deleted) !== JSON.stringify(state.deleted)
      || settingsUpdatedAt !== state.settingsUpdatedAt
      || JSON.stringify(settings) !== JSON.stringify(state.settings);
    if (!changed) return { changed: false };

    state = { ...state, meetings, settings, settingsUpdatedAt, deleted };
    commit();
    return { changed: true };
  },

  subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};
