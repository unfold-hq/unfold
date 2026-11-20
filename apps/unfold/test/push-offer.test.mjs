import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { acceptedPreferences, offeredTriggers, phoneQuery, phoneSized, pushOffer, pushOfferMarkup } from '../public/core/push-offer.js';
import { createPrefs } from '../public/core/prefs.js';

const view = (extra = {}) => ({
  enabled: true, demo: false,
  preferences: { channels: [], triggers: [], quietHours: null },
  channels: [{ id: 'ntfy', available: true }, { id: 'web-push', available: true, publicKey: 'BKey' }],
  ...extra,
});
const offered = (extra = {}) => pushOffer({ phone: true, answered: false, data: view(), pushReady: true, permission: 'default', ...extra });

test('a phone that chose no channel is offered Web Push in place', () => {
  assert.equal(offered(), 'push');
  assert.equal(offered({ permission: undefined }), 'push');
});

test('nothing is offered off a phone, once answered, in the demo, with the flag off, after a channel is chosen or when the browser refused', () => {
  assert.equal(offered({ phone: false }), null);
  assert.equal(offered({ answered: true }), null);
  assert.equal(offered({ data: view({ demo: true }) }), null);
  assert.equal(offered({ data: { enabled: false, demo: false } }), null);
  assert.equal(offered({ data: null }), null);
  assert.equal(offered({ data: view({ preferences: { channels: ['ntfy'], triggers: [] } }) }), null);
  assert.equal(offered({ permission: 'denied' }), null);
  assert.equal(offered({ data: view({ channels: [{ id: 'ntfy', available: false }, { id: 'web-push', available: false }] }) }), null, 'no channel is configured on this server');
});

test('a phone that cannot subscribe here is sent to the Notifications page instead', () => {
  assert.equal(offered({ pushReady: false }), 'settings');
  assert.equal(offered({ data: view({ channels: [{ id: 'ntfy', available: true }, { id: 'web-push', available: false }] }) }), 'settings');
});

test('accepting adds Web Push and the moments that need the person, and keeps what they chose before', () => {
  assert.deepEqual(offeredTriggers, ['needs_you', 'question', 'review']);
  assert.deepEqual(acceptedPreferences({ channels: [], triggers: [], quietHours: null }), { channels: ['web-push'], triggers: ['needs_you', 'question', 'review'], handedOff: true, quietHours: null });
  const quiet = { start: '22:00', end: '07:00', timeZone: 'Europe/Amsterdam' };
  assert.deepEqual(acceptedPreferences({ channels: ['ntfy'], triggers: ['budget', 'review'], handedOff: false, quietHours: quiet }), { channels: ['ntfy', 'web-push'], triggers: ['budget', 'review', 'needs_you', 'question'], handedOff: false, quietHours: quiet });
});

test('the offer says what it sends in plain words, with a clear Not now and no dialog', () => {
  const markup = pushOfferMarkup('push');
  assert.match(markup, /work needs you or asks you a question/);
  assert.match(markup, /ready for your review/);
  assert.match(markup, /data-action="now-push-accept"/);
  assert.match(markup, />Turn on</);
  assert.match(markup, /data-action="now-push-dismiss"/);
  assert.match(markup, />Not now</);
  assert.doesNotMatch(markup, /<dialog/);
  assert.match(pushOfferMarkup('settings'), /data-action="now-push-settings"/);
  assert.equal(pushOfferMarkup(null), '');
});

test('the offer appears only on the phone layout, and a matchMedia that throws reads as not a phone', () => {
  assert.equal(phoneQuery, '(max-width: 719.98px)');
  assert.equal(phoneSized({ matchMedia: query => ({ matches: query === phoneQuery }) }), true);
  assert.equal(phoneSized({ matchMedia: () => ({ matches: false }) }), false);
  assert.equal(phoneSized({}), false);
  assert.equal(phoneSized({ matchMedia: () => { throw new Error('no'); } }), false);
});

test('the answer to the offer is remembered in this browser and refuses anything but accepted or declined', () => {
  const saved = new Map();
  const storage = { getItem: key => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value) };
  const first = createPrefs(() => storage);
  assert.equal(first.get('pushOffer'), null);
  assert.equal(first.set('pushOffer', 'later'), false);
  assert.equal(first.set('pushOffer', 'declined'), true);
  assert.equal(createPrefs(() => storage).get('pushOffer'), 'declined');
});

test('Now asks for the browser permission only from the Turn on tap, never on load', async () => {
  const now = await readFile(new URL('../public/views/now.js', import.meta.url), 'utf8');
  const push = await readFile(new URL('../public/core/push-offer.js', import.meta.url), 'utf8');
  assert.doesNotMatch(push, /requestPermission|showModal|confirm\(|alert\(/);
  assert.doesNotMatch(now, /requestPermission/);
  const accept = /async function acceptOffer\(\) \{[\s\S]*?\n\}/.exec(now)?.[0] ?? '';
  assert.match(accept, /subscribeBrowser\(/, 'the permission prompt comes from subscribeBrowser, called by the Turn on action');
  const load = /async function loadOffer\(\) \{[\s\S]*?\n\}/.exec(now)?.[0] ?? '';
  assert.doesNotMatch(load, /subscribeBrowser|Notification/);
});
