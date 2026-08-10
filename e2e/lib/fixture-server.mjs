import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const fixtureRoot = path.resolve(import.meta.dirname, '..', 'fixtures');

const send = (response, status, contentType, body) => {
  response.writeHead(status, {
    'content-type': contentType,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  response.end(body);
};

export const startFixtureServer = async () => {
  const [article, player, oauthCancel] = await Promise.all([
    readFile(path.join(fixtureRoot, 'article.html')),
    readFile(path.join(fixtureRoot, 'player.html')),
    readFile(path.join(fixtureRoot, 'oauth-cancel.html')),
  ]);
  const requests = [];
  const server = createServer((request, response) => {
    const url = new URL(request.url || '/', 'http://fixture.invalid');
    requests.push({ method: request.method, pathname: url.pathname, search: url.search, at: Date.now() });
    if (url.pathname === '/article') return send(response, 200, 'text/html; charset=utf-8', article);
    if (url.pathname === '/player') return send(response, 200, 'text/html; charset=utf-8', player);
    if (url.pathname === '/oauth-cancel') return send(response, 200, 'text/html; charset=utf-8', oauthCancel);
    if (url.pathname === '/favicon.ico') return send(response, 204, 'image/x-icon', '');
    if (url.pathname === '/__requests') return send(response, 200, 'application/json; charset=utf-8', JSON.stringify(requests));
    return send(response, 404, 'text/plain; charset=utf-8', 'Controlled fixture not found.');
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  const origin = `http://127.0.0.1:${address.port}`;
  return {
    origin,
    requests,
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
};
