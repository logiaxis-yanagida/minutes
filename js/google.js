const TOKEN_KEY = 'minutes.google.token';
const STATE_KEY = 'minutes.google.state';
const SCOPE = 'https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/drive.appdata';
const GIS_SRC = 'https://accounts.google.com/gsi/client';
const OAUTH_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const EXPIRY_MARGIN_MS = 5 * 60 * 1000;

const GIS_ERROR_MESSAGES = {
  popup_closed: 'サインインがキャンセルされました',
  popup_failed_to_open: 'ポップアップがブロックされました。ブラウザの設定でポップアップを許可してください',
  access_denied: 'アクセスが拒否されました。OAuth 同意画面のテストユーザーに自分の Google アカウントが追加されているか確認してください',
  invalid_client: 'クライアントIDが正しくありません',
  immediate_failed: 'サインインが必要です',
  interaction_required: 'サインインが必要です',
};

export class GoogleAuthError extends Error {
  constructor(message = 'Google へのサインインが必要です') {
    super(message);
    this.name = 'GoogleAuthError';
  }
}

export class GoogleApiError extends Error {
  status;

  constructor(status, message) {
    super(message || `Google API エラー（${status}）`);
    this.name = 'GoogleApiError';
    this.status = status;
  }
}

let clientId = '';
let tokenClient = null;
let tokenClientId = '';
let gisPromise = null;
let pendingSignIn = null;
let lastSignedIn = null;
const listeners = new Set();

function notify(signedIn) {
  if (signedIn === lastSignedIn) return;
  lastSignedIn = signedIn;
  for (const fn of listeners) {
    try {
      fn(signedIn);
    } catch (e) {
      console.error(e);
    }
  }
}

function readToken() {
  try {
    const raw = globalThis.sessionStorage?.getItem(TOKEN_KEY);
    if (!raw) return null;
    const token = JSON.parse(raw);
    if (!token || typeof token.access_token !== 'string' || typeof token.expires_at !== 'number') return null;
    return token;
  } catch {
    return null;
  }
}

function writeToken(token) {
  try {
    globalThis.sessionStorage?.setItem(TOKEN_KEY, JSON.stringify(token));
  } catch (e) {
    console.error(e);
  }
}

function clearToken() {
  try {
    globalThis.sessionStorage?.removeItem(TOKEN_KEY);
  } catch {}
}

function getValidToken() {
  const token = readToken();
  if (!token) return null;
  if (token.expires_at - Date.now() <= EXPIRY_MARGIN_MS) {
    clearToken();
    notify(false);
    return null;
  }
  return token;
}

function loadGis() {
  if (globalThis.google?.accounts?.oauth2) return Promise.resolve();
  if (gisPromise) return gisPromise;
  gisPromise = new Promise((resolve, reject) => {
    const doc = globalThis.document;
    if (!doc) {
      reject(new GoogleAuthError('この環境では Google サインインを利用できません'));
      return;
    }
    const script = doc.createElement('script');
    script.src = GIS_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => {
      if (globalThis.google?.accounts?.oauth2) {
        resolve();
      } else {
        reject(new GoogleAuthError('Google 認証スクリプトの初期化に失敗しました'));
      }
    };
    script.onerror = () => reject(new GoogleAuthError('Google 認証スクリプトの読み込みに失敗しました。ネットワーク接続を確認してください'));
    doc.head.appendChild(script);
  }).catch((e) => {
    gisPromise = null;
    throw e;
  });
  return gisPromise;
}

function describeGisError(code) {
  return GIS_ERROR_MESSAGES[code] || `サインインに失敗しました（${code || 'unknown'}）`;
}

function settlePending(error) {
  const pending = pendingSignIn;
  pendingSignIn = null;
  if (!pending) return;
  if (error) pending.reject(error);
  else pending.resolve();
}

function isStandalone() {
  try {
    if (globalThis.navigator?.standalone === true) return true;
    return Boolean(globalThis.matchMedia?.('(display-mode: standalone)')?.matches);
  } catch {
    return false;
  }
}

function randomState() {
  const bytes = new Uint8Array(16);
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function redirectUri() {
  const loc = globalThis.location;
  return `${loc.origin}${loc.pathname}`;
}

function redirectSignIn() {
  const loc = globalThis.location;
  if (!loc || typeof loc.assign !== 'function') {
    throw new GoogleAuthError('この環境ではリダイレクト方式のサインインを利用できません');
  }
  const state = randomState();
  try {
    globalThis.sessionStorage?.setItem(STATE_KEY, state);
  } catch (e) {
    console.error(e);
  }
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri(),
    response_type: 'token',
    scope: SCOPE,
    include_granted_scopes: 'true',
    state,
  });
  loc.assign(`${OAUTH_AUTH_URL}?${params.toString()}`);
  return new Promise(() => {});
}

function handleRedirectResult() {
  const loc = globalThis.location;
  const hash = loc?.hash || '';
  if (!hash || hash.length < 2) return false;
  const params = new URLSearchParams(hash.slice(1));
  if (!params.has('access_token') && !params.has('error')) return false;
  let savedState = null;
  try {
    savedState = globalThis.sessionStorage?.getItem(STATE_KEY) ?? null;
    globalThis.sessionStorage?.removeItem(STATE_KEY);
  } catch {}
  try {
    globalThis.history?.replaceState(null, '', `${loc.pathname}${loc.search}`);
  } catch {}
  const error = params.get('error');
  if (error) throw new GoogleAuthError(describeGisError(error));
  if (!savedState || params.get('state') !== savedState) {
    throw new GoogleAuthError('サインインの検証に失敗しました（state 不一致）。もう一度サインインしてください');
  }
  const expiresIn = Number(params.get('expires_in')) || 3600;
  writeToken({
    access_token: params.get('access_token'),
    expires_at: Date.now() + expiresIn * 1000,
  });
  notify(true);
  return true;
}

function ensureTokenClient() {
  if (tokenClient && tokenClientId === clientId) return tokenClient;
  tokenClient = globalThis.google.accounts.oauth2.initTokenClient({
    client_id: clientId,
    scope: SCOPE,
    callback: (response) => {
      if (!response || response.error) {
        settlePending(new GoogleAuthError(describeGisError(response?.error)));
        return;
      }
      const expiresIn = Number(response.expires_in) || 3600;
      writeToken({
        access_token: response.access_token,
        expires_at: Date.now() + expiresIn * 1000,
      });
      notify(true);
      settlePending(null);
    },
    error_callback: (err) => {
      if (err?.type === 'popup_failed_to_open' && pendingSignIn && !pendingSignIn.silent) {
        try {
          redirectSignIn();
          return;
        } catch (e) {
          settlePending(e instanceof GoogleAuthError ? e : new GoogleAuthError(e?.message));
          return;
        }
      }
      settlePending(new GoogleAuthError(describeGisError(err?.type)));
    },
  });
  tokenClientId = clientId;
  return tokenClient;
}

function configure({ clientId: nextClientId } = {}) {
  const normalizedClientId = String(nextClientId ?? '').trim();
  if (normalizedClientId !== clientId) {
    clientId = normalizedClientId;
    tokenClient = null;
    tokenClientId = '';
  }
  if (clientId && globalThis.document) loadGis().catch(() => {});
}

function isConfigured() {
  return clientId !== '';
}

function isSignedIn() {
  return getValidToken() !== null;
}

async function signIn({ silent = false, redirect = false } = {}) {
  if (!isConfigured()) {
    throw new GoogleAuthError('Google OAuth クライアントIDが設定されていません');
  }
  const standalone = isStandalone();
  if (silent && standalone) {
    throw new GoogleAuthError('サインインが必要です。設定画面からサインインしてください');
  }
  if (!silent && (redirect || standalone)) {
    if (pendingSignIn) settlePending(new GoogleAuthError('前回のサインインを中断しました'));
    return redirectSignIn();
  }
  if (pendingSignIn) {
    if (silent) return pendingSignIn.promise;
    settlePending(new GoogleAuthError('前回のサインインを中断しました'));
  }
  if (!globalThis.google?.accounts?.oauth2) await loadGis();
  const client = ensureTokenClient();
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  pendingSignIn = { promise, resolve, reject, silent };
  try {
    client.requestAccessToken(silent ? { prompt: '' } : {});
  } catch (e) {
    settlePending(new GoogleAuthError(e?.message || 'サインインを開始できませんでした'));
  }
  return promise;
}

function signOut() {
  const token = readToken();
  clearToken();
  const revoke = globalThis.google?.accounts?.oauth2?.revoke;
  if (token && typeof revoke === 'function') {
    try {
      revoke(token.access_token, () => {});
    } catch {}
  }
  notify(false);
}

function onAuthChange(fn) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

async function readErrorMessage(response) {
  let message = '';
  try {
    const data = await response.json();
    message = data?.error?.message || '';
  } catch {}
  return message || response.statusText || '';
}

async function rawFetch(method, url, body, token, options = {}) {
  const headers = { Authorization: `Bearer ${token.access_token}`, ...(options.headers || {}) };
  const init = { method, headers };
  if (body !== undefined) {
    if (typeof body === 'string') {
      if (!headers['Content-Type']) headers['Content-Type'] = options.contentType || 'text/plain; charset=UTF-8';
      init.body = body;
    } else {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
  }
  return fetch(url, init);
}

async function authorizedFetch(method, url, body, allowStatuses = [], options = {}) {
  let token = getValidToken();
  if (!token) {
    await signIn({ silent: true }).catch((e) => {
      throw e instanceof GoogleAuthError ? e : new GoogleAuthError(e?.message);
    });
    token = getValidToken();
    if (!token) throw new GoogleAuthError();
  }
  let response = await rawFetch(method, url, body, token, options);
  if (response.status === 401) {
    clearToken();
    try {
      await signIn({ silent: true });
    } catch (e) {
      notify(false);
      throw e instanceof GoogleAuthError ? e : new GoogleAuthError(e?.message);
    }
    token = getValidToken();
    if (!token) {
      notify(false);
      throw new GoogleAuthError();
    }
    response = await rawFetch(method, url, body, token, options);
    if (response.status === 401) {
      clearToken();
      notify(false);
      throw new GoogleAuthError();
    }
  }
  if (response.ok) {
    if (response.status === 204) return { status: response.status, data: null };
    let data = null;
    try {
      data = await response.json();
    } catch {
      data = null;
    }
    return { status: response.status, data };
  }
  if (allowStatuses.includes(response.status)) {
    return { status: response.status, data: null };
  }
  throw new GoogleApiError(response.status, await readErrorMessage(response));
}

export { authorizedFetch };

export const google = {
  configure,
  isConfigured,
  isSignedIn,
  signIn,
  signOut,
  onAuthChange,
  handleRedirectResult,
};
