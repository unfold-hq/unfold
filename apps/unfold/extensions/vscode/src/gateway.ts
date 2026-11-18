import type { GatewayHeaders } from './client.js';

export type GatewayClient = { readonly origin: string; gatewayHeaders(): Promise<GatewayHeaders>; setGatewayHeaders(headers: GatewayHeaders): Promise<void> };
export type GatewayChoice = { label: string; description?: string; detail?: string; action: 'add' | 'remove' | 'clear'; name?: string };
export type GatewayUi = {
  pick(choices: GatewayChoice[], title: string, placeholder: string): Promise<GatewayChoice | undefined>;
  name(): Promise<string | undefined>;
  value(name: string): Promise<string | undefined>;
};

/** The message an input box shows while what is typed does not pass `check`, or undefined once it does. */
export function inputProblem(check: (value: string) => string): (value: string) => string | undefined {
  return value => { try { check(value); return undefined; } catch (error) { return (error as Error).message; } };
}

/** What the list offers for the stored headers. It shows names only; a value never leaves SecretStorage for the screen. */
export function gatewayChoices(headers: GatewayHeaders): GatewayChoice[] {
  const names = Object.keys(headers);
  const choices: GatewayChoice[] = [{ label: '$(add) Add a header', detail: 'A name and a value the access gateway accepts, such as the two halves of a service token.', action: 'add' }];
  for (const name of names) choices.push({ label: `$(trash) Remove ${name}`, description: 'value hidden', action: 'remove', name });
  if (names.length > 1) choices.push({ label: '$(clear-all) Remove all', action: 'clear' });
  return choices;
}

/**
 * Shows the access gateway headers of one workbench until the person closes the list, storing each addition and removal as it
 * is made. A header added under a stored name, whatever its case, replaces it. Answers whether anything changed.
 */
export async function manageGatewayHeaders(client: GatewayClient, ui: GatewayUi): Promise<boolean> {
  const host = new URL(client.origin).host;
  let changed = false;
  while (true) {
    const headers = await client.gatewayHeaders();
    const count = Object.keys(headers).length;
    const choice = await ui.pick(gatewayChoices(headers), `Access gateway headers for ${host}`, count ? `${count} stored and sent with every request to ${host}. Escape closes this list.` : `None stored. Add the headers the access gateway in front of ${host} accepts.`);
    if (!choice) return changed;
    if (choice.action === 'clear') { await client.setGatewayHeaders({}); changed = true; continue; }
    if (choice.action === 'remove') {
      await client.setGatewayHeaders(Object.fromEntries(Object.entries(headers).filter(([name]) => name !== choice.name)));
      changed = true;
      continue;
    }
    const name = (await ui.name())?.trim();
    if (!name) continue;
    const value = await ui.value(name);
    if (!value) continue;
    await client.setGatewayHeaders({ ...headers, [name]: value });
    changed = true;
  }
}
