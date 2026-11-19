type Json = Record<string, any>;

/** Whether `createMcpServer` offers the prompts below and completes their arguments; off, it answers as it did before prompts existed. */
export type McpPromptOptions = { prompts?: boolean };

/** One MCP prompt argument, and what completes it: Work Items or Teams the person may see, or nothing. */
type PromptArgument = { name: string; title: string; description: string; required: boolean; completes?: 'work_item' | 'team' };
type Prompt = { name: string; title: string; description: string; arguments: PromptArgument[]; text(args: Record<string, string>): string };

/** Thrown for a prompt name or argument the server cannot use; answered as JSON-RPC -32602. */
export class PromptRefusal extends Error {}

export const completionLimit = 20;

const confirmOnly = 'The tool asks me to confirm first. Call it once, and do nothing else on my behalf: if I decline or close the question, stop and say nothing was changed.';

const prompts: Prompt[] = [
  {
    name: 'now', title: 'What waits for me in Unfold', arguments: [],
    description: 'Ask what waits for you in Unfold right now, with the reason each Work Item waits and the fix. Only reads.',
    text: () => 'Call the unfold_now tool and tell me what waits for me in Unfold: each Work Item with its id, the reason it waits and the fix, then the running Runs and my own sessions that wait for me. Only read; change nothing.',
  },
  {
    name: 'handoff', title: 'Hand a task to a Team',
    description: 'Hand an open tracker task to a Ploeg Team with unfold_hand_off. Fills in the request; nothing is handed off until the tool asks you to confirm and you accept.',
    arguments: [
      { name: 'source', title: 'Task connection', description: 'Task connection id, as Unfold\'s Tasks page names it, such as board', required: true },
      { name: 'task', title: 'Task', description: 'Task id in that connection', required: true },
      { name: 'team', title: 'Team', description: 'The Ploeg Team to hand it to', required: true, completes: 'team' },
    ],
    text: args => `Hand tracker task ${args.source}/${args.task} to Ploeg Team ${args.team} with the unfold_hand_off tool, with source ${JSON.stringify(args.source)}, task ${JSON.stringify(args.task)} and team ${JSON.stringify(args.team)}. ${confirmOnly} Then tell me what the tool answered.`,
  },
  {
    name: 'takeover', title: 'Take control of a running Work Item',
    description: 'Take control of a Work Item a Ploeg Run is working on, with unfold_take_over. Fills in the request; nothing is taken over until the tool asks you to confirm and you accept.',
    arguments: [{ name: 'work_item', title: 'Work Item', description: 'The Work Item id, or an Unfold link ending #work/<id>', required: true, completes: 'work_item' }],
    text: args => `Take control of Unfold Work Item ${args.work_item} with the unfold_take_over tool, with id ${JSON.stringify(args.work_item)}. ${confirmOnly} Then tell me what the tool answered, including how to pick the work up once Ploeg parks it for me.`,
  },
];

const checks: Record<string, (value: string) => string | undefined> = {
  source: value => /^[a-z0-9-]{1,64}$/.test(value) ? value : undefined,
  task: value => /^[a-zA-Z0-9_-]{1,128}$/.test(value) ? value : undefined,
  team: value => /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(value) ? value : undefined,
  work_item: value => (/^(\d{1,19})(?:\s.*)?$/s.exec(value) ?? /#work\/(\d{1,19})(?:[?/]\S*)?$/.exec(value))?.[1],
};

/** The prompts as `prompts/list` answers them. */
export function promptList(): Json[] {
  return prompts.map(prompt => ({ name: prompt.name, title: prompt.title, description: prompt.description, arguments: prompt.arguments.map(({ name, title, description, required }) => ({ name, title, description, required })) }));
}

/** One prompt's messages, as `prompts/get` answers them. It reads nothing from Unfold, so it works when Unfold cannot be read. */
export function promptMessages(name: unknown, given: unknown): Json {
  const prompt = prompts.find(entry => entry.name === name);
  if (!prompt) throw new PromptRefusal(`Unknown prompt ${String(name).slice(0, 64)}; prompts/list names them.`);
  const raw = given && typeof given === 'object' && !Array.isArray(given) ? given as Json : {};
  const unknown = Object.keys(raw).filter(key => !prompt.arguments.some(argument => argument.name === key));
  if (unknown.length) throw new PromptRefusal(`Unknown argument ${unknown.slice(0, 5).join(', ').slice(0, 200)} for prompt ${prompt.name}.`);
  const args: Record<string, string> = {};
  for (const argument of prompt.arguments) {
    const value = typeof raw[argument.name] === 'string' ? raw[argument.name].trim() : '';
    if (!value) { if (argument.required) throw new PromptRefusal(`Prompt ${prompt.name} needs ${argument.name}: ${argument.description}.`); continue; }
    const checked = checks[argument.name]!(value);
    if (checked === undefined) throw new PromptRefusal(`${argument.name} is not valid: ${argument.description}.`);
    args[argument.name] = checked;
  }
  return { description: prompt.description, messages: [{ role: 'user', content: { type: 'text', text: prompt.text(args) } }] };
}

/** What a `completion/complete` request asks to complete, or a refusal for a prompt this server does not offer. */
export function completionTarget(params: Json | undefined): { completes?: 'work_item' | 'team'; typed: string; context: Json } {
  const ref = params?.ref;
  if (ref?.type !== 'ref/prompt') throw new PromptRefusal('Only prompt arguments complete here; this server offers no resources to complete.');
  const prompt = prompts.find(entry => entry.name === ref.name);
  if (!prompt) throw new PromptRefusal(`Unknown prompt ${String(ref.name).slice(0, 64)}; prompts/list names them.`);
  const argument = prompt.arguments.find(entry => entry.name === params?.argument?.name);
  const typed = typeof params?.argument?.value === 'string' ? params.argument.value.trim().slice(0, 200) : '';
  const context = params?.context?.arguments && typeof params.context.arguments === 'object' && !Array.isArray(params.context.arguments) ? params.context.arguments as Json : {};
  return { ...(argument?.completes ? { completes: argument.completes } : {}), typed, context };
}

/** The task a hand-off completion names in its other arguments, when both are valid. */
export function contextTask(context: Json): { source: string; task: string } | undefined {
  const source = typeof context.source === 'string' ? checks.source!(context.source.trim()) : undefined;
  const task = typeof context.task === 'string' ? checks.task!(context.task.trim()) : undefined;
  return source && task ? { source, task } : undefined;
}

/** A completion answer of at most `completionLimit` values, with the total and whether more match. */
export function completion(values: string[]): Json {
  return { completion: { values: values.slice(0, completionLimit), total: values.length, hasMore: values.length > completionLimit } };
}

/** Work Item choices from a `/api/ploeg/now` answer, running work first, as `<id> <title>`; prompts/get keeps only the id. */
export function workItemChoices(now: Json, typed: string): string[] {
  const seen = new Map<string, string>();
  for (const run of (Array.isArray(now?.running) ? now.running : []) as Json[]) if (/^\d{1,19}$/.test(String(run?.workItemId)) && !seen.has(String(run.workItemId))) seen.set(String(run.workItemId), oneLine(run.workItemTitle));
  for (const item of (Array.isArray(now?.waiting) ? now.waiting : []) as Json[]) if (/^\d{1,19}$/.test(String(item?.id)) && !seen.has(String(item.id))) seen.set(String(item.id), oneLine(item.title));
  const wanted = typed.toLowerCase();
  return [...seen].filter(([id, title]) => !wanted || id.startsWith(wanted) || title.toLowerCase().includes(wanted)).map(([id, title]) => title ? `${id} ${title}` : id);
}

/** Team choices from a list of Team ids, those starting with what was typed first. */
export function teamChoices(teams: unknown, typed: string): string[] {
  const wanted = typed.toLowerCase();
  const ids = [...new Set((Array.isArray(teams) ? teams : []).map(team => String(typeof team === 'object' && team ? (team as Json).id : team)).filter(id => checks.team!(id) !== undefined))];
  return ids.filter(id => id.toLowerCase().startsWith(wanted)).concat(wanted ? ids.filter(id => !id.toLowerCase().startsWith(wanted) && id.toLowerCase().includes(wanted)) : []);
}

function oneLine(value: unknown): string {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
}
