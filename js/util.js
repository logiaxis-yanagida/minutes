const WEEKDAY_SHORT = ['日', '月', '火', '水', '木', '金', '土'];
const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

function pad2(n) {
  return String(n).padStart(2, '0');
}

export function newId() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 10)}-${Math.random().toString(16).slice(2, 10)}`;
}

export function nowISO() {
  return new Date().toISOString();
}

export function toYMD(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

export function todayYMD(date = new Date()) {
  return toYMD(date);
}

function fromYMD(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, m - 1, d, 0, 0, 0, 0);
}

export function addDays(ymd, n) {
  const d = fromYMD(ymd);
  d.setDate(d.getDate() + n);
  return toYMD(d);
}

export function debounce(fn, ms) {
  let timer = null;
  let pendingArgs = null;
  function debounced(...args) {
    pendingArgs = args;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      const a = pendingArgs;
      pendingArgs = null;
      fn(...a);
    }, ms);
  }
  debounced.flush = () => {
    if (!timer) return;
    clearTimeout(timer);
    timer = null;
    const a = pendingArgs;
    pendingArgs = null;
    fn(...a);
  };
  debounced.cancel = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    pendingArgs = null;
  };
  return debounced;
}

function parseDateish(v) {
  if (typeof v !== 'string' || !v) return null;
  if (YMD_RE.test(v)) return { date: fromYMD(v), allDay: true };
  const t = Date.parse(v);
  if (Number.isNaN(t)) return null;
  return { date: new Date(t), allDay: false };
}

function formatDate(d) {
  return `${d.getFullYear()}/${pad2(d.getMonth() + 1)}/${pad2(d.getDate())}(${WEEKDAY_SHORT[d.getDay()]})`;
}

function formatTime(d) {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

export function formatDateTimeRange(startISO, endISO) {
  const start = parseDateish(startISO);
  if (!start) return '';
  const end = parseDateish(endISO);
  if (start.allDay) {
    if (!end || !end.allDay) return formatDate(start.date);
    // Google カレンダーの終日予定は終了日が翌日（排他的）
    const lastDay = fromYMD(addDays(toYMD(end.date), -1));
    if (lastDay <= start.date) return formatDate(start.date);
    return `${formatDate(start.date)}–${formatDate(lastDay)}`;
  }
  const head = `${formatDate(start.date)} ${formatTime(start.date)}`;
  if (!end || end.allDay) return head;
  if (toYMD(end.date) === toYMD(start.date)) return `${head}–${formatTime(end.date)}`;
  return `${head}–${formatDate(end.date)} ${formatTime(end.date)}`;
}

export function escapeHTML(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
