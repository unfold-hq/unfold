import test from 'node:test';
import assert from 'node:assert/strict';
import { application, login, request } from './api-support.ts';
import { notificationSettings } from '../src/notify/settings.ts';

test('notifications are on by default with nothing chosen, say off once an override turns them off, and keep choices per person', async t => {
  process.env.UNFOLD_TEST_NTFY_TOKEN = 'tk_api_test';
  const app = await application('live', config => { config.notifications = notificationSettings({ ntfy: { server: 'https://ntfy.example.org', tokenEnv: 'UNFOLD_TEST_NTFY_TOKEN' } }); });
  t.after(() => { delete process.env.UNFOLD_TEST_NTFY_TOKEN; return app.close(); });
  const admin = await login(app.url);

  const fresh = await request(app.url, '/api/me/notifications', { cookie: admin.cookie });
  assert.equal(fresh.body.enabled, true, 'notifications.push defaults to on');
  assert.deepEqual(fresh.body.preferences.channels, [], 'nobody has a channel until they choose one');
  assert.deepEqual(fresh.body.preferences.triggers, []);
  assert.deepEqual(fresh.body.recent, []);
  const ntfyBefore = fresh.body.channels.find((channel: any) => channel.id === 'ntfy');
  assert.equal(ntfyBefore.topic ?? null, null, 'no ntfy topic exists before the person chooses ntfy');

  const turnedOff = await request(app.url, '/api/admin/flags/notifications.push/override', { method: 'PUT', cookie: admin.cookie, body: { variant: 'off', reason: 'Hold notifications' } });
  assert.equal(turnedOff.status, 200, turnedOff.text);
  const off = await request(app.url, '/api/me/notifications', { cookie: admin.cookie });
  assert.deepEqual(off.body, { enabled: false, demo: false });
  assert.equal((await request(app.url, '/api/me/notifications', { method: 'PUT', cookie: admin.cookie, body: { channels: ['ntfy'], triggers: ['review'] } })).body.error.code, 'notifications_off');

  const forced = await request(app.url, '/api/admin/flags/notifications.push/override', { method: 'PUT', cookie: admin.cookie, body: { variant: 'on', reason: 'Try notifications' } });
  assert.equal(forced.status, 200, forced.text);
  const view = await request(app.url, '/api/me/notifications', { cookie: admin.cookie });
  assert.equal(view.body.enabled, true);
  assert.deepEqual(view.body.channels.map((channel: any) => [channel.id, channel.available]), [['ntfy', true], ['web-push', false]]);
  assert.equal((await request(app.url, '/api/me/notifications', { method: 'PUT', cookie: admin.cookie, body: { channels: ['web-push'], triggers: [] } })).body.error.code, 'notify_channel');
  assert.equal((await request(app.url, '/api/me/notifications', { method: 'PUT', cookie: admin.cookie, body: { channels: ['ntfy'], triggers: ['review'] }, csrf: false })).status, 403);

  const saved = await request(app.url, '/api/me/notifications', { method: 'PUT', cookie: admin.cookie, body: { channels: ['ntfy'], triggers: ['review'], quietHours: { start: '22:00', end: '07:00', timeZone: 'Europe/Amsterdam' } } });
  assert.equal(saved.status, 200, saved.text);
  const ntfy = saved.body.channels.find((channel: any) => channel.id === 'ntfy');
  assert.match(ntfy.topic, /^unfold-/);
  assert.equal(ntfy.subscribeUrl, `https://ntfy.example.org/${ntfy.topic}`);
  assert.equal(JSON.stringify(saved.body).includes('tk_api_test'), false, 'the token never reaches the browser');
  assert.equal((await request(app.url, '/api/me/notifications/nothing', { method: 'POST', cookie: admin.cookie, body: {} })).status, 404);
});
