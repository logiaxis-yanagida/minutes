const DEBOUNCE_MS = 2000;
const VISIBLE_PULL_INTERVAL_MS = 30 * 1000;

function sortById(items) {
  return [...items].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

function sortedEntries(obj) {
  return Object.entries(obj || {}).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}

function canonical(payload) {
  if (!payload || typeof payload !== 'object') return '';
  const shared = payload.shared && typeof payload.shared === 'object' ? payload.shared : {};
  return JSON.stringify({
    meetings: sortById(Array.isArray(payload.meetings) ? payload.meetings : []),
    deleted: sortedEntries(payload.deleted),
    shared: {
      template: shared.template ?? null,
      summaryRule: shared.summaryRule ?? null,
      settingsUpdatedAt: shared.settingsUpdatedAt ?? null,
    },
  });
}

function isOffline() {
  return typeof globalThis.navigator !== 'undefined' && globalThis.navigator.onLine === false;
}

export function createSync({ store, google, drive, onStatus }) {
  let status = { state: google.isSignedIn() ? 'idle' : 'signed-out', lastSyncedAt: null, message: '' };
  let applyingRemote = false;
  let inFlight = null;
  let queued = null;
  let debounceTimer = null;
  let lastPullAt = 0;
  let lastCanonical = null;
  let pendingWhileOffline = false;
  let started = false;

  function setStatus(next) {
    status = { ...status, ...next };
    if (typeof onStatus === 'function') {
      try {
        onStatus(status);
      } catch (e) {
        console.error(e);
      }
    }
  }

  async function run({ forcePush = false } = {}) {
    if (!google.isSignedIn()) {
      setStatus({ state: 'signed-out', message: '' });
      return;
    }
    if (isOffline()) {
      pendingWhileOffline = true;
      setStatus({ state: 'idle', message: 'オフラインのため同期を保留しています' });
      return;
    }
    setStatus({ state: 'syncing', message: '' });
    try {
      const remote = await drive.pull();
      lastPullAt = Date.now();
      if (remote && remote.state) {
        applyingRemote = true;
        try {
          store.mergeRemote(remote.state);
        } finally {
          applyingRemote = false;
        }
      }
      const local = store.getSyncPayload();
      const localCanonical = canonical(local);
      const remoteCanonical = remote ? canonical(remote.state) : null;
      if (forcePush || localCanonical !== remoteCanonical) {
        await drive.push(local);
      }
      lastCanonical = localCanonical;
      pendingWhileOffline = false;
      setStatus({ state: 'synced', lastSyncedAt: new Date().toISOString(), message: '' });
    } catch (err) {
      console.error(err);
      if (!google.isSignedIn()) {
        setStatus({ state: 'signed-out', message: err?.message || '' });
        return;
      }
      setStatus({ state: 'error', message: err?.message || String(err) });
    }
  }

  function schedule(options = {}) {
    if (inFlight) {
      queued = { ...(queued || {}), ...options };
      return inFlight;
    }
    inFlight = run(options).finally(() => {
      inFlight = null;
      if (queued) {
        const next = queued;
        queued = null;
        schedule(next);
      }
    });
    return inFlight;
  }

  function clearDebounce() {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
  }

  function onStoreChange() {
    if (applyingRemote) return;
    if (!google.isSignedIn()) return;
    if (lastCanonical !== null && canonical(store.getSyncPayload()) === lastCanonical) return;
    clearDebounce();
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      schedule();
    }, DEBOUNCE_MS);
  }

  function onVisibilityChange() {
    if (globalThis.document?.visibilityState !== 'visible') return;
    if (!google.isSignedIn()) return;
    if (Date.now() - lastPullAt < VISIBLE_PULL_INTERVAL_MS) return;
    schedule();
  }

  function onOnline() {
    if (!google.isSignedIn()) return;
    if (pendingWhileOffline || status.state === 'error') schedule();
  }

  function start() {
    if (started) return;
    started = true;
    store.subscribe(onStoreChange);
    google.onAuthChange((signedIn) => {
      if (signedIn) {
        schedule();
      } else {
        clearDebounce();
        lastCanonical = null;
        setStatus({ state: 'signed-out', message: '' });
      }
    });
    globalThis.document?.addEventListener?.('visibilitychange', onVisibilityChange);
    globalThis.addEventListener?.('online', onOnline);
    if (google.isSignedIn()) schedule();
    else setStatus({ state: 'signed-out', message: '' });
  }

  function pullNow() {
    clearDebounce();
    return schedule();
  }

  function pushNow() {
    clearDebounce();
    return schedule({ forcePush: true });
  }

  function getStatus() {
    return status;
  }

  return { start, pullNow, pushNow, getStatus };
}
