import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDesign } from '../../js/storage/schema.js';
import { FILE_SUFFIX, GIST_DESCRIPTION, GistClient, GistError, compareVersions } from '../../js/storage/gist.js';

const TOKEN = 'github_pat_TESTTOKEN0000000000000000';
const design = (id, name, updatedAt = '2026-10-08T09:00:00.000Z') => ({
  ...createDesign({ id, name, now: '2026-10-01T00:00:00.000Z' }),
  updatedAt,
});

// 依「方法 路徑」回應的假 fetch，並記錄每次呼叫
function fakeFetch(routes) {
  const calls = [];
  const fn = async (url, init = {}) => {
    const method = init.method ?? 'GET';
    const path = url.replace('https://api.github.com', '');
    calls.push({ method, path, url, headers: init.headers ?? {}, body: init.body ? JSON.parse(init.body) : null });
    const handler = routes[`${method} ${path}`];
    if (!handler) return new Response('not found', { status: 404 });
    if (handler instanceof Error) throw handler;
    const { status = 200, body } = typeof handler === 'function' ? handler(calls.at(-1)) : handler;
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
  };
  return { fn, calls };
}

const gistListing = (id) => [{ id: 'other', description: '別的 Gist' }, { id, description: GIST_DESCRIPTION }];
const gistFiles = (designs) => ({
  files: Object.fromEntries(designs.map((d) => [`${d.id}${FILE_SUFFIX}`, { content: JSON.stringify(d), truncated: false }])),
});

test('還沒有雲端 Gist 時 listRemote 回傳空清單，不會自動建立', async () => {
  // Arrange
  const { fn, calls } = fakeFetch({ 'GET /gists?per_page=100&page=1': { body: [] } });

  // Act
  const result = await new GistClient({ token: TOKEN, fetch: fn }).listRemote();

  // Assert
  assert.deepEqual(result, { designs: [], broken: [] });
  assert.ok(calls.every((c) => c.method === 'GET'));
});

test('第一次上傳時建立私密 Gist，檔名為方案 id', async () => {
  // Arrange
  const { fn, calls } = fakeFetch({
    'GET /gists?per_page=100&page=1': { body: [] },
    'POST /gists': { status: 201, body: { id: 'g1' } },
  });
  const d = design('d1', '方案 1');

  // Act
  await new GistClient({ token: TOKEN, fetch: fn }).upload(d);

  // Assert
  const post = calls.find((c) => c.method === 'POST');
  assert.equal(post.body.public, false);
  assert.equal(post.body.description, GIST_DESCRIPTION);
  assert.deepEqual(JSON.parse(post.body.files[`d1${FILE_SUFFIX}`].content), d);
});

test('已經有 Gist 時上傳改用 PATCH 更新該檔案', async () => {
  // Arrange
  const { fn, calls } = fakeFetch({
    'GET /gists?per_page=100&page=1': { body: gistListing('g1') },
    'PATCH /gists/g1': { body: { id: 'g1' } },
  });

  // Act
  await new GistClient({ token: TOKEN, fetch: fn }).upload(design('d1', '方案 1'));

  // Assert
  const patch = calls.find((c) => c.method === 'PATCH');
  assert.ok(patch.body.files[`d1${FILE_SUFFIX}`]);
  assert.equal(calls.filter((c) => c.method === 'POST').length, 0);
});

test('Gist 在第二頁時也找得到', async () => {
  // Arrange
  const page1 = Array.from({ length: 100 }, (_, i) => ({ id: `x${i}`, description: '別的' }));
  const { fn } = fakeFetch({
    'GET /gists?per_page=100&page=1': { body: page1 },
    'GET /gists?per_page=100&page=2': { body: gistListing('g2') },
    'GET /gists/g2': { body: gistFiles([design('d1', '方案 1')]) },
  });

  // Act
  const { designs } = await new GistClient({ token: TOKEN, fetch: fn }).listRemote();

  // Assert
  assert.deepEqual(designs.map((d) => d.id), ['d1']);
});

test('listRemote 列出雲端方案，略過非設計檔、損壞的檔案另外列出', async () => {
  // Arrange
  const files = gistFiles([design('d1', '方案 1'), design('d2', '方案 2')]);
  files.files['README.md'] = { content: 'hi', truncated: false };
  files.files[`d3${FILE_SUFFIX}`] = { content: '{壞掉', truncated: false };
  const { fn } = fakeFetch({ 'GET /gists?per_page=100&page=1': { body: gistListing('g1') }, 'GET /gists/g1': { body: files } });

  // Act
  const { designs, broken } = await new GistClient({ token: TOKEN, fetch: fn }).listRemote();

  // Assert
  assert.deepEqual(designs.map((d) => [d.id, d.name]), [['d1', '方案 1'], ['d2', '方案 2']]);
  assert.deepEqual(broken.map((b) => b.file), [`d3${FILE_SUFFIX}`]);
});

test('檔案太大被截斷時改從 raw_url 讀完整內容', async () => {
  // Arrange
  const full = design('d1', '方案 1');
  const { fn } = fakeFetch({
    'GET /gists?per_page=100&page=1': { body: gistListing('g1') },
    'GET /gists/g1': { body: { files: { [`d1${FILE_SUFFIX}`]: { content: '{"trunc', truncated: true, raw_url: 'https://api.github.com/raw/d1' } } } },
    'GET /raw/d1': { body: full },
  });

  // Act
  const result = await new GistClient({ token: TOKEN, fetch: fn }).download('d1');

  // Assert
  assert.deepEqual(result, full);
});

test('download 雲端沒有這個方案時丟出 not-found', async () => {
  // Arrange
  const { fn } = fakeFetch({ 'GET /gists?per_page=100&page=1': { body: gistListing('g1') }, 'GET /gists/g1': { body: gistFiles([]) } });

  // Act & Assert
  await assert.rejects(new GistClient({ token: TOKEN, fetch: fn }).download('ghost'), (e) => e instanceof GistError && e.kind === 'not-found');
});

for (const [name, response, kind] of [
  ['401 代表 Token 無效', { status: 401, body: { message: 'Bad credentials' } }, 'auth'],
  ['403 代表沒有 Gist 權限', { status: 403, body: { message: 'Resource not accessible' } }, 'permission'],
  ['連線失敗', new TypeError('Failed to fetch'), 'network'],
]) {
  test(`錯誤分類：${name}`, async () => {
    // Arrange
    const { fn } = fakeFetch({ 'GET /gists?per_page=100&page=1': response });

    // Act & Assert
    await assert.rejects(new GistClient({ token: TOKEN, fetch: fn }).listRemote(), (e) => e instanceof GistError && e.kind === kind);
  });
}

test('Token 只放在 Authorization 標頭，絕不出現在網址', async () => {
  // Arrange
  const { fn, calls } = fakeFetch({ 'GET /gists?per_page=100&page=1': { body: [] } });

  // Act
  await new GistClient({ token: TOKEN, fetch: fn }).listRemote();

  // Assert
  assert.equal(calls[0].headers.Authorization, `Bearer ${TOKEN}`);
  assert.ok(calls.every((c) => !c.url.includes(TOKEN)));
});

test('沒有 Token 時直接丟出 auth 錯誤，不發任何請求', async () => {
  // Arrange
  const { fn, calls } = fakeFetch({});

  // Act & Assert
  await assert.rejects(new GistClient({ token: '  ', fetch: fn }).listRemote(), (e) => e.kind === 'auth');
  assert.equal(calls.length, 0);
});

for (const [name, local, remote, expected] of [
  ['時間相同', '2026-10-08T09:00:00.000Z', '2026-10-08T09:00:00.000Z', 'same'],
  ['本機較新', '2026-10-08T10:00:00.000Z', '2026-10-08T09:00:00.000Z', 'local-newer'],
  ['雲端較新', '2026-10-08T09:00:00.000Z', '2026-10-08T10:00:00.000Z', 'remote-newer'],
]) {
  test(`compareVersions ${name}`, () => {
    // Act & Assert
    assert.equal(compareVersions({ updatedAt: local }, { updatedAt: remote }), expected);
  });
}
