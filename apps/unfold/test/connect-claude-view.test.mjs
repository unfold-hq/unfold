import test from 'node:test';
import assert from 'node:assert/strict';
import { claudeCard } from '../public/core/connect-claude.js';
import { redirect } from '../public/core/route.js';

const fireUrl = 'https://api.anthropic.com/v1/claude_code/routines/trig_01AbCdEf/fire';
const routine = (fields = {}) => ({ team: 'delivery', fireUrl, creatorPinned: false, registeredAt: '2026-11-18T19:00:00Z', updatedAt: '2026-11-18T19:00:00Z', ...fields });
const overview = (fields = {}) => ({ demo: false, served: true, waitsFor: null, refused: null, teams: [{ team: 'delivery', routine: null }], ...fields });

test('Linked accounts shows no Claude card to a person who can do nothing with it', () => {
  const none = { 'nothing read yet': null, 'no Team runs work on a person’s own Claude': overview({ teams: [] }), 'a Ploeg without the step': overview({ served: false, teams: [] }), 'Ploeg could not be asked': overview({ served: null, teams: [] }), 'the demo': overview({ demo: true }), 'not turned on': overview({ refused: { code: 'routines_not_accepted', message: 'x' } }) };
  for (const [why, data] of Object.entries(none)) assert.equal(claudeCard(data, 'operator'), '', why);
  assert.equal(claudeCard(overview(), 'viewer'), '', 'a viewer starts no work');
});

test('an unconnected person sees what it does, where the work goes, and one open form', () => {
  const card = claudeCard(overview(), 'operator');
  assert.match(card, /Not linked/);
  assert.match(card, /The task and the repository then go to Anthropic\./);
  assert.match(card, /Other Teams do not need it\./);
  assert.match(card, /<details class="disclosure" id="claude-setup" open>/);
  assert.equal(card.match(/<form/g).length, 1);
  assert.match(card, /<input type="hidden" name="team" value="delivery">/, 'one Team needs no choice');
  assert.match(card, /Carry out the Ploeg task in the &lt;routine-fire-payload&gt; block\./);
  assert.doesNotMatch(card, /Fire URL|already connected/);
});

test('a connected Team is one line, with the form folded away and never a token on the page', () => {
  const card = claudeCard(overview({ teams: [{ team: 'delivery', routine: routine() }] }), 'operator');
  assert.match(card, /Linked/);
  assert.match(card, /Team delivery<\/h3><p class="health-detail">Connected on [^<]*2026\. No work has started with it yet\./);
  assert.match(card, /<details class="disclosure" id="claude-setup"><summary><span class="disclosure-summary">Replace the token/);
  assert.match(card, /aria-label="Disconnect your Claude from Team delivery"/);
  assert.match(card, /name="token" type="password"[^>]*autocomplete="off"/);
  assert.doesNotMatch(card, /name="token"[^>]*value=/);
  assert.match(claudeCard(overview({ teams: [{ team: 'delivery', routine: routine({ creatorPinned: true, updatedAt: '2026-11-20T19:00:00Z' }) }] }), 'operator'), /token replaced on [^<]*\. Only sessions your own Claude account starts are accepted\./);
});

test('several Teams share one form with a choice, and say which are connected', () => {
  const card = claudeCard(overview({ teams: [{ team: 'delivery', routine: routine() }, { team: 'research', routine: null }] }), 'operator');
  assert.equal(card.match(/<form/g).length, 1);
  assert.match(card, /Teams delivery and research/);
  assert.match(card, /<option value="delivery">delivery \(connected\)<\/option><option value="research" selected>research<\/option>/, 'the Team without a connection is the default, so a token is not replaced by accident');
  assert.match(card, /Connect another Team or replace a token/);
});

test('a refused connection stays in the open form with the Team and URL kept and the token empty', () => {
  const teams = [{ team: 'delivery', routine: routine() }, { team: 'research', routine: null }];
  const card = claudeCard(overview({ teams }), 'operator', { problem: 'No Role of this Team starts its Runs through a Claude routine.', team: 'research', fireUrl });
  assert.match(card, /id="claude-setup" open/);
  assert.match(card, /<div id="claude-problem" role="alert" tabindex="-1">[^]*No Role of this Team/);
  assert.match(card, /<option value="research" selected>/);
  assert.ok(card.includes(`value="${fireUrl}"`));
  assert.doesNotMatch(card, /name="token"[^>]*value=/);
});

test('a failed read and any other refusal say so on the card, with Check again', () => {
  const failed = claudeCard(null, 'operator', { error: 'Ploeg did not answer.' });
  assert.match(failed, /Could not read your Claude connection[^]*Ploeg did not answer\.[^]*Check again/);
  const refused = claudeCard(overview({ refused: { code: 'secret_store_unavailable', message: 'Ploeg’s secret store did not answer.' } }), 'operator');
  assert.match(refused, /Ploeg refused[^]*\(secret_store_unavailable\)[^]*Check again/);
  assert.doesNotMatch(refused, /<form/);
});

test('the old Connect Claude link opens Linked accounts', () => {
  assert.equal(redirect('#settings/claude'), 'settings/accounts');
});
