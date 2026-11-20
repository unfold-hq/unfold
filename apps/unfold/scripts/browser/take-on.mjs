/** Take on at phone width: opened from the bottom bar at 360px, each row with its Team, what it is and its cost, one-thumb actions of at least 44px, the approval and stop confirmations of the demo dismissed without changing anything, no horizontal scroll and no label clipped with an ellipsis. */
export async function run({ page, app, assert, screenshot }) {
  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto(`http://127.0.0.1:${app.server.address().port}/#now`);
  await page.getByRole('heading', { level: 1, name: 'Now', exact: true }).waitFor();
  await page.locator('.boot-curtain').waitFor({ state: 'detached' });
  const tabbar = page.getByRole('navigation', { name: 'Quick navigation' });
  await tabbar.getByRole('link', { name: 'Take on', exact: true }).click();
  await page.getByRole('heading', { level: 1, name: 'Take on', exact: true }).waitFor();
  assert.equal(await tabbar.getByRole('link', { name: 'Take on', exact: true }).getAttribute('aria-current'), 'page');
  await page.locator('.take-on-row').first().waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'Take on overflows horizontally at 360px');

  const proposal = page.locator('.take-on-row[data-id="107"]');
  await proposal.getByText('Team research', { exact: true }).waitFor();
  await proposal.getByText('Demo · nothing is dispatched and nothing is spent.', { exact: true }).waitFor();
  const running = page.locator('.take-on-row[data-id="102"]');
  await running.getByText('Demo · no model calls').waitFor();

  const small = await page.evaluate(() => [...document.querySelectorAll('.take-on-action, .app-tab')].filter(element => { const box = element.getBoundingClientRect(); return box.width && (box.height < 44 || box.width < 44); }).map(element => element.textContent.trim()));
  assert.deepEqual(small, [], 'every Take on action and bottom bar target is at least 44px');
  const clipped = await page.evaluate(() => [...document.querySelectorAll('.take-on *, .app-tab *')].filter(element => { const style = getComputedStyle(element); return style.textOverflow === 'ellipsis' || element.scrollWidth > element.clientWidth + 1 && style.overflowX === 'hidden'; }).map(element => `${element.tagName}.${element.className} ${element.textContent.trim()}`));
  assert.deepEqual(clipped, [], 'no Take on label is clipped');
  await screenshot('take-on-360');

  await proposal.getByRole('button', { name: 'Approve', exact: true }).click();
  const approval = page.getByRole('dialog', { name: 'Approve this proposal?' });
  await approval.getByText(/^Its Runs spend from the research Team’s budget\./).waitFor();
  await approval.getByText('Demo: approving changes only this demo’s sample data. Nothing is dispatched and nothing is spent.', { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'the approval overflows at 360px');
  await screenshot('take-on-approve-360');
  await approval.getByRole('button', { name: 'Keep it proposed', exact: true }).click();
  await approval.waitFor({ state: 'hidden' });
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'take-on-approve-107', 'focus returns to Approve');
  assert.equal(await proposal.count(), 1, 'keeping it proposed changed nothing');

  await running.getByRole('button', { name: 'Stop', exact: true }).click();
  const stop = page.getByRole('dialog', { name: 'Cancel this Work Item?' });
  await stop.getByText('Not available in the demo').waitFor();
  assert.equal(await stop.getByRole('button', { name: 'Cancel Work Item', exact: true }).isDisabled(), true, 'the demo cannot stop anything');
  await screenshot('take-on-stop-360');
  await stop.getByRole('button', { name: 'Keep it', exact: true }).click();
  await stop.waitFor({ state: 'hidden' });
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'take-on-stop-102', 'focus returns to Stop');
  await page.setViewportSize({ width: 1440, height: 1040 });
}
