import { button, callout } from './ui.js';

/** The media query of the phone layout, the width below which the sidebar becomes the bottom bar. */
export const phoneQuery = '(max-width: 719.98px)';

/** The moments the offer turns on: a Work Item needs you, a question or tool permission waits for you, and a pull request is ready for review. */
export const offeredTriggers = Object.freeze(['needs_you', 'question', 'review']);

/** Whether this screen has the phone layout. */
export function phoneSized(scope = globalThis) {
  try { return Boolean(scope.matchMedia?.(phoneQuery).matches); } catch { return false; }
}

/**
 * How Now offers notifications on a phone, or null when it offers nothing: `push` turns Web Push on in place,
 * `settings` opens the Notifications page because this browser cannot subscribe here. Nothing is offered once the
 * person answered the offer, in the demo, while the `notifications.push` flag is off for them, once they chose any
 * channel, or when this browser already refused notifications.
 * @param {{ phone: boolean, answered: boolean, data: object|null, pushReady: boolean, permission?: string }} input
 * @returns {'push'|'settings'|null}
 */
export function pushOffer({ phone, answered, data, pushReady, permission }) {
  if (!phone || answered || !data?.enabled || data.demo) return null;
  if ((data.preferences?.channels ?? []).length) return null;
  const channels = data.channels ?? [];
  if (!channels.some(channel => channel.available)) return null;
  const push = channels.find(channel => channel.id === 'web-push');
  if (push?.available && push.publicKey && pushReady) return permission === 'denied' ? null : 'push';
  return 'settings';
}

/** The preferences after accepting the offer: Web Push added to the chosen channels and the offered moments to the chosen triggers. */
export function acceptedPreferences(preferences = {}) {
  const union = (list, extra) => [...new Set([...(list ?? []), ...extra])];
  return { channels: union(preferences.channels, ['web-push']), triggers: union(preferences.triggers, offeredTriggers), handedOff: preferences.handedOff !== false, quietHours: preferences.quietHours ?? null };
}

/** The offer as Now shows it: what it sends, in plain words, a button that does it, and **Not now**. */
export function pushOfferMarkup(kind, { busy = false } = {}) {
  if (!kind) return '';
  const accept = kind === 'push'
    ? button({ label: 'Turn on', icon: 'bell', variant: 'primary', size: 'sm', action: 'now-push-accept', busy })
    : button({ label: 'Choose how', icon: 'bell', variant: 'primary', size: 'sm', action: 'now-push-settings' });
  const how = kind === 'push' ? 'Your phone asks you to allow it after you tap Turn on.' : 'This browser cannot get notices here; the Notifications page says how to get them on this phone.';
  return `<section class="now-push-offer" aria-label="Notifications on this phone">${callout({
    tone: 'accent', icon: 'bell', title: 'Get told on this phone when something waits for you',
    body: `<p>A notice when work needs you or asks you a question, and when a pull request is ready for your review. Tapping a notice opens the Work Item or session it is about. ${how} Change it any time under Settings › Notifications.</p>`,
    actions: [accept, button({ label: 'Not now', variant: 'ghost', size: 'sm', action: 'now-push-dismiss', disabled: busy })],
  })}</section>`;
}
