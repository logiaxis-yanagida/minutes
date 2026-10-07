import { authorizedFetch, GoogleApiError } from './google.js';

const FILE_NAME = 'minutes-state.json';
const FILES_URL = 'https://www.googleapis.com/drive/v3/files';
const UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3/files';
const MULTIPART_BOUNDARY = 'minutes_boundary_4c8e2b';

let fileId = null;

function describe(err) {
  if (err instanceof GoogleApiError) {
    return new GoogleApiError(err.status, `Googleドライブ API エラー（${err.status}）: ${err.message}`);
  }
  return err;
}

async function findFile() {
  const params = new URLSearchParams({
    spaces: 'appDataFolder',
    q: `name='${FILE_NAME}'`,
    fields: 'files(id,modifiedTime)',
    pageSize: '10',
  });
  const res = await authorizedFetch('GET', `${FILES_URL}?${params.toString()}`);
  const files = Array.isArray(res.data?.files) ? res.data.files : [];
  if (files.length === 0) return null;
  files.sort((a, b) => ((a.modifiedTime || '') < (b.modifiedTime || '') ? 1 : -1));
  return files[0].id || null;
}

async function download(id) {
  const res = await authorizedFetch('GET', `${FILES_URL}/${encodeURIComponent(id)}?alt=media`, undefined, [404]);
  if (res.status === 404) return undefined;
  return res.data;
}

async function multipartCreate(name, json) {
  const metadata = JSON.stringify({ name, parents: ['appDataFolder'] });
  const body = [
    `--${MULTIPART_BOUNDARY}`,
    'Content-Type: application/json; charset=UTF-8',
    '',
    metadata,
    `--${MULTIPART_BOUNDARY}`,
    'Content-Type: application/json; charset=UTF-8',
    '',
    json,
    `--${MULTIPART_BOUNDARY}--`,
    '',
  ].join('\r\n');
  const res = await authorizedFetch('POST', `${UPLOAD_URL}?uploadType=multipart&fields=id`, body, [], {
    contentType: `multipart/related; boundary=${MULTIPART_BOUNDARY}`,
  });
  if (!res.data?.id) throw new GoogleApiError(res.status, 'Googleドライブへの保存結果を取得できませんでした');
  return res.data.id;
}

async function upload(id, json) {
  if (id) {
    const res = await authorizedFetch(
      'PATCH',
      `${UPLOAD_URL}/${encodeURIComponent(id)}?uploadType=media`,
      json,
      [404],
      { contentType: 'application/json; charset=UTF-8' },
    );
    if (res.status !== 404) return res.data?.id || id;
  }
  return multipartCreate(FILE_NAME, json);
}

async function pull() {
  try {
    const id = fileId || (await findFile());
    if (!id) {
      fileId = null;
      return null;
    }
    const state = await download(id);
    if (state === undefined) {
      fileId = null;
      return null;
    }
    fileId = id;
    return { fileId: id, state };
  } catch (err) {
    throw describe(err);
  }
}

async function push(state) {
  try {
    const json = JSON.stringify(state);
    const id = fileId || (await findFile());
    fileId = await upload(id, json);
  } catch (err) {
    throw describe(err);
  }
}

async function createFile(name, obj) {
  try {
    return await multipartCreate(name, JSON.stringify(obj));
  } catch (err) {
    throw describe(err);
  }
}

export const drive = { pull, push, createFile };
