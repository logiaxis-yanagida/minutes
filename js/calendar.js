import { authorizedFetch } from './google.js';

const API_BASE = 'https://www.googleapis.com/calendar/v3/calendars/';

function dateOnlyToISO(ymd) {
  const [y, m, d] = String(ymd).split('-').map(Number);
  return new Date(y, m - 1, d, 0, 0, 0, 0).toISOString();
}

function toISO(point) {
  if (!point) return null;
  if (point.dateTime) return new Date(point.dateTime).toISOString();
  if (point.date) return dateOnlyToISO(point.date);
  return null;
}

function normalizeEvent(ev) {
  const allDay = Boolean(ev.start?.date && !ev.start?.dateTime);
  const attendees = Array.isArray(ev.attendees)
    ? ev.attendees.map((a) => String(a?.displayName || a?.email || '').trim()).filter(Boolean)
    : [];
  return {
    id: ev.id,
    title: String(ev.summary || '').trim() || '（無題の予定）',
    start: toISO(ev.start),
    end: toISO(ev.end),
    allDay,
    location: String(ev.location || ''),
    attendees,
    description: String(ev.description || ''),
  };
}

export async function listEvents({ calendarId = 'primary', from, to }) {
  const id = String(calendarId || '').trim() || 'primary';
  const params = new URLSearchParams({
    timeMin: new Date(from).toISOString(),
    timeMax: new Date(to).toISOString(),
    singleEvents: 'true',
    orderBy: 'startTime',
    maxResults: '250',
  });
  const res = await authorizedFetch('GET', `${API_BASE}${encodeURIComponent(id)}/events?${params.toString()}`);
  const items = Array.isArray(res.data?.items) ? res.data.items : [];
  return items.filter((ev) => ev && ev.id && ev.status !== 'cancelled').map(normalizeEvent);
}
