const INBOX_KEY = 'minutes.taskappInbox';
const TASKAPP_KEY = 'taskapp.v1';
const DRIVE_PREFIX = 'taskapp-inbox-';

function defaultStorage() {
  try {
    return globalThis.localStorage || null;
  } catch {
    return null;
  }
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function formatMeetingDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}/${pad2(d.getMonth() + 1)}/${pad2(d.getDate())}`;
}

export function buildMemo(meeting, task) {
  const title = String(meeting?.title || '').trim() || '（無題の会議）';
  const date = formatMeetingDate(meeting?.start || meeting?.createdAt);
  let memo = date ? `元会議：${title}（${date}）` : `元会議：${title}`;
  const assignee = String(task?.assignee || '').trim();
  if (assignee) memo += `／担当：${assignee}`;
  return memo;
}

export function toInboxItem(meeting, task, settings, createdAt = new Date().toISOString()) {
  return {
    id: task.id,
    title: String(task.title || '').trim(),
    due: task.due || null,
    memo: buildMemo(meeting, task),
    categoryId: settings?.taskappIntegration?.defaultCategoryId || null,
    source: 'minutes',
    meetingId: meeting?.id ?? null,
    createdAt,
  };
}

function readInbox(storage) {
  try {
    const raw = storage?.getItem(INBOX_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x) => x && typeof x.id === 'string') : [];
  } catch {
    return [];
  }
}

function appendToInbox(storage, items) {
  if (!storage) throw new Error('端末内ストレージを利用できません');
  const inbox = readInbox(storage);
  const index = new Map(inbox.map((item, i) => [item.id, i]));
  for (const item of items) {
    if (index.has(item.id)) inbox[index.get(item.id)] = item;
    else {
      index.set(item.id, inbox.length);
      inbox.push(item);
    }
  }
  storage.setItem(INBOX_KEY, JSON.stringify(inbox));
}

export async function sendTasks(meeting, tasks, settings, { google, drive, storage = defaultStorage() } = {}) {
  const targets = (Array.isArray(tasks) ? tasks : []).filter(
    (t) => t && t.id && !t.sentToTaskapp && String(t.title || '').trim(),
  );
  if (targets.length === 0) return { sent: [], driveOk: true };
  const createdAt = new Date().toISOString();
  const items = targets.map((t) => toInboxItem(meeting, t, settings, createdAt));
  appendToInbox(storage, items);

  let driveOk = true;
  if (google?.isSignedIn?.() && drive?.createFile) {
    for (const item of items) {
      try {
        await drive.createFile(`${DRIVE_PREFIX}${item.id}.json`, item);
      } catch (e) {
        console.error(e);
        driveOk = false;
      }
    }
  }
  return { sent: targets, driveOk };
}

export function readTaskappCategories(storage = defaultStorage()) {
  try {
    const raw = storage?.getItem(TASKAPP_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    const categories = Array.isArray(parsed?.categories) ? parsed.categories : [];
    return categories.filter((c) => c && typeof c.id === 'string');
  } catch {
    return [];
  }
}
