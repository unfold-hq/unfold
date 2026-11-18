import { claimFailures, PloegError, PloegOperatorRefusal, type PloegTeam } from './ploeg.ts';
import type { ChecklistLine, StepId } from './onboarding.ts';
import type { User } from './types.ts';

/** A person's own claude.ai routine for one Team as Ploeg reports it (Ploeg ADR-0197 section 7). It never carries the token. */
export type ClaudeRoutine = { team: string; fireUrl: string; creatorPinned: boolean; registeredAt: string; updatedAt: string };
/** One of the person's Teams on Connect Claude, with their routine for it or null. */
export type ClaudeRoutineTeam = { team: string; routine: ClaudeRoutine | null };
/** `GET /api/claude-routines`: whether Ploeg serves the step, what it refused, and the person's Teams with their routines. */
export type ClaudeRoutineOverview = {
  demo: boolean; served: boolean | null; waitsFor: { record: string; release: string | null } | null;
  refused: { code: string; message: string } | null; teams: ClaudeRoutineTeam[];
};
/** What firing the person's routine for a Work Item answered: the Run it started and the session Anthropic opened. */
export type RoutineFire = { run: { id: string; workItemId: string; team: string; role: string; round: number }; session: { id: string; url: string | null } };

/**
 * Ploeg's named refusals of the routine routes, each with the sentence Unfold shows the person. Ploeg's status passes
 * through; the status here is the one the error catalogue lists first.
 */
export const routineRefusalTable = [
  { status: 422, code: 'routines_not_accepted', words: 'This installation does not start Runs through a person’s own Claude routine. The person who installed Ploeg turns it on with PLOEG_CLAUDE_ROUTINES and the credential gateway (Ploeg ADR-0197).' },
  { status: 409, code: 'credential_gateway_required', words: 'Ploeg starts a Run through your routine only once its credential gateway is configured, so nothing started and the Run keeps waiting. The person who installed Ploeg configures the gateway.' },
  { status: 409, code: 'no_routine_team', words: 'No Role of this Team starts its Runs through a Claude routine, so there is nothing to connect for it.' },
  { status: 409, code: 'routine_not_registered', words: 'You have not connected your Claude routine for this Team. Connect it on Settings → Connect Claude, then start the Work Item again.' },
  { status: 429, code: 'routine_rate_limited', words: 'Your routine was started as often this hour as Anthropic allows: 30 times an hour per routine and 100 per account, and Ploeg keeps some room below that. Try again in the next hour.' },
  { status: 409, code: 'routine_token_refused', words: 'Anthropic refused your routine’s token: it was rotated, or the API trigger was deleted. Paste the current fire URL and token on Settings → Connect Claude. This Run ended stuck.' },
  { status: 409, code: 'routine_not_found', words: 'Anthropic has no routine or API trigger at the fire URL you connected. Check the routine in claude.ai and connect its current fire URL. This Run ended stuck.' },
  { status: 503, code: 'routines_unavailable', words: 'Anthropic’s routines service could not start the session. This Run ended stuck; try again later.' },
  { status: 503, code: 'routine_fire_unrecorded', words: 'Your routine started a session, but Ploeg could not record it, so that session is never tied to the Run. Stop the session in claude.ai. This Run ended stuck.' },
  { status: 503, code: 'routine_session_unrecorded', words: 'Your routine started a session, but Ploeg could not record it on the Run. Stop the session in claude.ai. This Run ended stuck.' },
  { status: 400, code: 'invalid_fire_url', words: 'Ploeg does not accept this fire URL. Copy it from the routine’s API trigger in claude.ai: it looks like https://api.anthropic.com/v1/claude_code/routines/trig_…/fire.' },
  { status: 400, code: 'invalid_token', words: 'Ploeg does not accept this token. Paste the single line of 16 to 512 characters claude.ai showed when you added the API trigger.' },
  { status: 503, code: 'secret_store_unavailable', words: 'Ploeg’s secret store did not answer, so Ploeg could not keep or read your routine’s token and nothing changed. Try again later; if it keeps failing, the person who installed Ploeg checks its secret store.' },
  { status: 403, code: 'execution_forbidden', words: 'Unfold may not start Runs in this Ploeg, so it cannot connect or start a routine. The person who installed Ploeg gives Unfold’s consumer execute.' },
] as const;
const routineWords: Readonly<Record<string, string>> = Object.fromEntries(routineRefusalTable.map(entry => [entry.code, entry.words]));

const step: StepId = 'connect-claude';
const connectClaudeHref = '#settings/claude';
const teamPattern = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;
const workItemPattern = /^[1-9][0-9]{0,18}$/;
const tokenPattern = /^[\x21-\x7e]{16,512}$/;
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const short = (value: unknown, max: number): string => typeof value === 'string' ? value.slice(0, max) : '';
const list = (items: string[]) => items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;

type PloegCalls = {
  operatorCall(user: User, path: string, options?: { method?: 'GET' | 'POST' | 'PUT' | 'DELETE'; body?: unknown; slow?: boolean; person?: boolean }): Promise<Record<string, unknown> | null>;
  teams(user: User, fresh?: boolean): Promise<PloegTeam[]>;
  detail(user: User, id: string, fresh?: boolean): Promise<unknown>;
  isDemo: boolean;
};
type Steps = {
  admitPerson(user: User, id: StepId): Promise<void>;
  available(user: User, id: StepId, fresh?: boolean): Promise<{ step: { record: string; release: string | null }; served: boolean | null }>;
};
type StateStore = { getSecret<T>(id: string): T | undefined; setSecret(id: string, value: unknown): void };
type Options = { ploeg: PloegCalls; steps: Steps; store: StateStore };

function routineOf(value: unknown): ClaudeRoutine | null {
  const entry = object(value);
  const team = short(entry.team, 128);
  if (!team) return null;
  return { team, fireUrl: short(entry.fireUrl, 2048), creatorPinned: entry.creatorPinned === true, registeredAt: short(entry.registeredAt, 64), updatedAt: short(entry.updatedAt, 64) };
}

function sessionUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 2048) return null;
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password ? url.href : null; } catch { return null; }
}

/** The fire URL a person pasted, if it can be one: an https address without credentials. Ploeg checks the rest. */
function fireUrlOf(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 2048) return null;
  try { const url = new URL(value.trim()); return url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash ? url.href : null; } catch { return null; }
}

/**
 * Connect Claude and Start with my Claude (Ploeg ADR-0197 section 7). A person connects their own claude.ai routine,
 * with an API trigger on the installation's self-hosted environment, once per Team; Unfold relays its fire URL and
 * token to Ploeg as the proven person and keeps neither the token nor anything derived from it. Unfold remembers only
 * which Teams the person connected, for the onboarding checklist. Starting a Work Item asks Ploeg to fire the routine
 * for the Run that waits for the person. Every refusal is Ploeg's, shown in plain words.
 */
export class ClaudeRoutines {
  private readonly options: Options;

  constructor(options: Options) { this.options = options; }

  private refuse(error: unknown): never {
    if (!(error instanceof PloegOperatorRefusal)) throw error;
    const words = claimFailures[error.code] ?? routineWords[error.code] ?? (error.message || 'Ploeg refused it.');
    throw new PloegError(error.status, error.code, words);
  }

  private remembered(user: User): string[] {
    const held = this.options.store.getSecret<{ teams?: unknown }>(`claude-routines:${user.id}`);
    return Array.isArray(held?.teams) ? held.teams.filter((team): team is string => typeof team === 'string') : [];
  }

  private remember(user: User, teams: string[]): void {
    this.options.store.setSecret(`claude-routines:${user.id}`, { teams: [...new Set(teams)].sort() });
  }

  /** The person's Teams with the routine Ploeg holds for each. It asks Ploeg only reads, as the proven person. */
  async overview(user: User): Promise<ClaudeRoutineOverview> {
    if (this.options.ploeg.isDemo) return { demo: true, served: false, waitsFor: null, refused: null, teams: [] };
    const { step: record, served } = await this.options.steps.available(user, step, true);
    if (served !== true) return { demo: false, served, waitsFor: served === false ? { record: record.record, release: record.release } : null, refused: null, teams: [] };
    const teams = (await this.options.ploeg.teams(user, true).catch(() => [] as PloegTeam[])).map(team => team.id);
    let routines: ClaudeRoutine[];
    try { routines = await this.read(user); }
    catch (error) {
      if (error instanceof PloegError && error.status < 500) return { demo: false, served, waitsFor: null, refused: { code: error.code, message: routineWords[error.code] ?? error.message }, teams: teams.map(team => ({ team, routine: null })) };
      throw error;
    }
    this.remember(user, routines.map(routine => routine.team));
    const byTeam = new Map(routines.map(routine => [routine.team, routine]));
    const names = [...teams, ...routines.map(routine => routine.team).filter(team => !teams.includes(team))];
    return { demo: false, served, waitsFor: null, refused: null, teams: names.map(team => ({ team, routine: byTeam.get(team) ?? null })) };
  }

  private async read(user: User): Promise<ClaudeRoutine[]> {
    const answer = object(await this.options.ploeg.operatorCall(user, 'claude-routines', { method: 'GET', person: true }));
    return (Array.isArray(answer.routines) ? answer.routines.slice(0, 500) : []).map(routineOf).filter((entry): entry is ClaudeRoutine => entry !== null);
  }

  /**
   * Sends the person's routine for `team` to Ploeg: its fire URL and token, as the proven person. The token goes into
   * the request body to Ploeg and nowhere else; the answer carries only the fire URL and dates.
   */
  async connect(user: User, team: string, input: unknown): Promise<{ routine: ClaudeRoutine }> {
    if (!teamPattern.test(team)) throw new PloegError(400, 'invalid_input', 'Name one of your Teams.');
    const data = object(input);
    const fireUrl = fireUrlOf(data.fireUrl);
    const token = typeof data.token === 'string' ? data.token.trim() : '';
    if (!fireUrl) throw new PloegError(400, 'invalid_fire_url', routineWords.invalid_fire_url);
    if (!tokenPattern.test(token)) throw new PloegError(400, 'invalid_token', routineWords.invalid_token);
    await this.options.steps.admitPerson(user, step);
    let answer: Record<string, unknown>;
    try { answer = object(await this.options.ploeg.operatorCall(user, `claude-routines/${encodeURIComponent(team)}`, { method: 'PUT', body: { fireUrl, token } })); }
    catch (error) { return this.refuse(error); }
    const routine = routineOf(answer.routine);
    if (!routine || routine.team !== team) throw new PloegError(502, 'ploeg_response', 'Ploeg answered the connection in a form this Unfold cannot read.');
    this.remember(user, [...this.remembered(user), team]);
    return { routine };
  }

  /** Asks Ploeg to delete the person's routine for `team`, with its token. */
  async remove(user: User, team: string): Promise<{ routine: ClaudeRoutine | null }> {
    if (!teamPattern.test(team)) throw new PloegError(400, 'invalid_input', 'Name one of your Teams.');
    await this.options.steps.admitPerson(user, step);
    let answer: Record<string, unknown>;
    try { answer = object(await this.options.ploeg.operatorCall(user, `claude-routines/${encodeURIComponent(team)}`, { method: 'DELETE' })); }
    catch (error) {
      if (error instanceof PloegOperatorRefusal && error.code === 'routine_not_registered') this.remember(user, this.remembered(user).filter(entry => entry !== team));
      return this.refuse(error);
    }
    this.remember(user, this.remembered(user).filter(entry => entry !== team));
    return { routine: routineOf(answer.routine) };
  }

  /**
   * Starts the Run of Work Item `id` that waits for the person by firing their routine for its Team. Ploeg claims the
   * Run, fires the routine and records the session; a refusal before the claim leaves the Run waiting.
   */
  async fire(user: User, id: string): Promise<RoutineFire> {
    if (!workItemPattern.test(id)) throw new PloegError(400, 'ploeg_id', 'A Work Item id is a whole number, such as 42.');
    await this.options.steps.admitPerson(user, step);
    await this.options.ploeg.detail(user, id, true);
    let answer: Record<string, unknown>;
    try { answer = object(await this.options.ploeg.operatorCall(user, `work-items/${id}/fire-routine`, { method: 'POST', body: {}, slow: true })); }
    catch (error) { return this.refuse(error); }
    const run = object(answer.run);
    const session = object(answer.session);
    const fired: RoutineFire = {
      run: { id: short(run.id, 20), workItemId: short(run.workItemId, 20), team: short(run.team, 128), role: short(run.role, 100), round: typeof run.round === 'number' && Number.isInteger(run.round) ? run.round : 0 },
      session: { id: short(session.id, 200), url: sessionUrl(session.url) },
    };
    if (fired.run.workItemId !== id || !fired.session.id) throw new PloegError(502, 'ploeg_response', 'Ploeg answered the start in a form this Unfold cannot read.');
    return fired;
  }

  /** The person's Connect Claude line of the onboarding checklist, once Ploeg serves the step. */
  line(user: User): ChecklistLine {
    const teams = this.remembered(user);
    const action = user.role === 'viewer' ? {} : { action: { label: teams.length ? 'Manage' : 'Connect Claude', href: connectClaudeHref, kind: 'link' as const } };
    return teams.length
      ? { id: 'connect-claude', stage: 10, title: 'Connect Claude', status: 'ok', text: `Your Claude routine is connected for ${list(teams)}. Ploeg keeps its token; Unfold keeps none.`, ...action }
      : { id: 'connect-claude', stage: 10, title: 'Connect Claude', status: 'pending', text: 'Only for Teams that start their Runs through your own Claude routine: create a routine in claude.ai with an API trigger on this installation’s self-hosted environment, then paste its fire URL and token. Ploeg keeps the token; Unfold never stores it.', ...action };
  }
}
