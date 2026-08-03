import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const extensionRoot = path.join(projectRoot, 'extension');
const read = (file) => readFile(path.join(extensionRoot, file), 'utf8');

test('Manifest V3 extension has a reachable side-panel trigger and local files', async () => {
  const manifest = JSON.parse(await read('manifest.json'));
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.minimum_chrome_version, '114');
  assert.ok(manifest.permissions.includes('sidePanel'));
  assert.ok(manifest.permissions.includes('tabs'));
  assert.ok(manifest.permissions.includes('scripting'));
  assert.ok(manifest.permissions.includes('storage'));
  assert.ok(manifest.permissions.includes('identity'));
  assert.ok(manifest.permissions.includes('alarms'));
  assert.equal(manifest.action.default_popup, undefined);
  await access(path.join(extensionRoot, manifest.background.service_worker));
  await access(path.join(extensionRoot, manifest.side_panel.default_path));
  await access(path.join(extensionRoot, manifest.options_ui.page));

  const background = await read('background.js');
  assert.match(background, /openPanelOnActionClick/);
  assert.match(background, /chrome\.action\.onClicked/);
  assert.match(background, /chrome\.alarms\.onAlarm/);
  assert.match(background, /runBackgroundTask/);
});

test('extension runtime source avoids remote-code and service-worker timer patterns', async () => {
  const files = ['background.js', 'config.js', 'options.js', 'sidepanel.js', 'storage.js', 'audio.js', 'media-draft-store.js'];
  const source = await Promise.all(files.map(read));
  const combined = source.join('\n');
  assert.doesNotMatch(combined, /\beval\s*\(/);
  assert.doesNotMatch(combined, /new\s+Function\s*\(/);
  assert.doesNotMatch(combined, /\.then\s*\(/);
  assert.doesNotMatch(await read('background.js'), /set(?:Timeout|Interval)\s*\(/);
  assert.match(await read('sidepanel.html'), /<script type="module" src="sidepanel\.js"><\/script>/);
  assert.match(await read('options.html'), /<script type="module" src="options\.js"><\/script>/);
});

test('Chrome Web Store record covers every manifest permission and the privacy gate', async () => {
  const manifest = JSON.parse(await read('manifest.json'));
  const listing = await readFile(path.join(projectRoot, 'CHROMEWEBSTORE.md'), 'utf8');
  assert.match(listing, /Chrome Web Store Listing/);
  assert.match(listing, new RegExp(`\`?${manifest.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\`?`));
  for (const permission of [...manifest.permissions, ...manifest.host_permissions]) assert.ok(listing.includes(permission), `Missing permission justification for ${permission}`);
  assert.match(listing, /Privacy Policy URL/);
  assert.match(listing, /not ready|TBD|external gate/i);
});
