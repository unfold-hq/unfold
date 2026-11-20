import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../public/sw.js', import.meta.url), 'utf8');
const origin = 'https://unfold.example.org';

function worker({ clients = [] } = {}) {
  const listeners = {};
  const shown = [];
  const opened = [];
  const self = {
    location: { origin },
    addEventListener: (type, listener) => { listeners[type] = listener; },
    skipWaiting: () => {},
    registration: { showNotification: async (title, options) => { shown.push({ title, ...options }); } },
    clients: { claim: async () => {}, matchAll: async () => clients, openWindow: async url => { opened.push(url); return {}; } },
  };
  vm.runInNewContext(source, { self, URL });
  const fire = async (type, event) => { let work; listeners[type]({ ...event, waitUntil: promise => { work = promise; } }); await work; };
  return {
    shown, opened,
    push: data => fire('push', { data: { json: () => data } }),
    click: url => fire('notificationclick', { notification: { data: { url }, close: () => {} } }),
  };
}

function windowClient(url, navigate) {
  const client = { url, focused: false, navigated: [], focus: async () => { client.focused = true; return client; } };
  if (navigate) client.navigate = async target => { client.navigated.push(target); return navigate(target, client); };
  return client;
}

test('a pushed route opens on the worker origin, and a link to another origin falls back to no link', async () => {
  const sw = worker();
  await sw.push({ title: 'A question waits for you', body: '#7 Fix it', url: '/#work/7', tag: 'question-7' });
  await sw.push({ title: 'x', body: 'y', url: 'https://elsewhere.example/#work/7', tag: 't' });
  assert.equal(sw.shown[0].data.url, `${origin}/#work/7`);
  assert.equal(sw.shown[1].data.url, null);
});

test('a click moves an open Unfold window to the decision', async () => {
  const open = windowClient(`${origin}/#now`, (target, client) => client);
  const sw = worker({ clients: [open] });
  await sw.click(`${origin}/#work/7`);
  assert.equal(open.focused, true);
  assert.deepEqual(open.navigated, [`${origin}/#work/7`]);
  assert.deepEqual(sw.opened, []);
});

test('a click opens a new window on the decision when the open window cannot be moved', async () => {
  const refuses = windowClient(`${origin}/#now`, () => { throw new TypeError('not controlled'); });
  const sw = worker({ clients: [refuses] });
  await sw.click(`${origin}/#linked-session/session-abcdefgh`);
  assert.deepEqual(sw.opened, [`${origin}/#linked-session/session-abcdefgh`]);
  const unmovable = worker({ clients: [windowClient(`${origin}/#now`)] });
  await unmovable.click(`${origin}/#work/9`);
  assert.deepEqual(unmovable.opened, [`${origin}/#work/9`]);
  const nowhere = worker();
  await nowhere.click(`${origin}/#work/9`);
  assert.deepEqual(nowhere.opened, [`${origin}/#work/9`]);
});
