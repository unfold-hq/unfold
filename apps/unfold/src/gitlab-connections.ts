import { PloegError, PloegOperatorRefusal } from './ploeg.ts';
import { unavailableText, type ChecklistLine, type StepId } from './onboarding.ts';
import { ForgeConnections, connectionId, forgeConnection, object, sharedFlowWords, sharedTargetWords, short, type ForgeAccount, type ForgeConnection, type ForgeOptions, type SecondForge } from './forge-connections.ts';
import type { User } from './types.ts';

/** How Ploeg connects GitLab: it creates a service account from a temporary Owner token, or keeps the token of a service account the Admin made. */
export type GitlabMethod = 'gitlab_service_account' | 'token';
/** One way of connecting GitLab as the page offers it: whether this Ploeg serves it, and whether Ploeg's configuration refused it the last time. */
export type GitlabMethodState = {
  method: GitlabMethod; served: boolean | null; text: string | null; waitsFor: { record: string; release: string | null } | null;
  refused: { code: 'method_not_allowed'; instance: string; at: string } | null;
};
/** `GET /api/onboarding/gitlab`: the GitLab address, which methods this Ploeg serves, the connections it holds and what Unfold stored. */
export type GitlabOverview = {
  demo: boolean; manage: boolean; gitlabUrl: string; instance: string; tokenPage: string; serviceAccountDocs: string;
  served: { connect: boolean | null; register: boolean | null }; methods: GitlabMethodState[];
  secondForge: SecondForge; refused: { code: string; message: string; install: string | null } | null;
  connections: ForgeConnection[]; accounts: ForgeAccount[];
};
/** The GitLab service account Ploeg created from a temporary Owner token: its username, the group it is Maintainer on, that group's top-level group, whether this call created it, and when its token expires. */
export type GitlabServiceAccount = { username: string; group: string; topGroup: string; created: boolean; tokenExpiresAt: string | null };
/** One warning Ploeg answered a connection with, such as `owner_token_not_revoked`: the person must then revoke the Owner token by hand. */
export type GitlabWarning = { code: string; message: string };
/** What connecting GitLab answers: the connection Ploeg made, the service account it created, the Integration Account Unfold stored, and Ploeg's warnings. */
export type GitlabConnected = { connection: { id: string; account: string | null; state: string; method: GitlabMethod; canMint: boolean | null }; serviceAccount: GitlabServiceAccount | null; account: string; warnings: GitlabWarning[] };
/** One thing Ploeg left at GitLab when it removed a connection (Ploeg ADR-0195 `leftAtVendor`), such as the service account, or a token it could not revoke. */
export type GitlabLeft = { kind: string; id: string; url: string | null };
type Options = ForgeOptions & { gitlabUrl: string };

/** The Unfold codes Connect GitLab answers with besides the ones it shares with Connect GitHub, with their HTTP status. */
export const gitlabRefusalTable = [
  { status: 400, code: 'connection_token_invalid' },
  { status: 400, code: 'invalid_input' },
  { status: 409, code: 'second_forge_unsupported' },
  { status: 409, code: 'method_not_allowed' },
  { status: 409, code: 'gitlab_flow_refused' },
  { status: 503, code: 'ploeg_step_unavailable' },
  { status: 503, code: 'connection_unavailable' },
  { status: 422, code: 'connections_not_accepted' },
  { status: 422, code: 'target_refused' },
  { status: 403, code: 'person_claim_required' },
  { status: 409, code: 'connection_in_use' },
] as const;

const methodsId = 'onboarding:gitlab-methods';
const connectGitlabHref = '#settings/connections/gitlab';
const tokenPattern = /^[\x21-\x7e]{20,4096}$/;
const groupPattern = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,254}(?:\/[A-Za-z0-9_.-]{1,255}){0,19}$/;
const serviceAccountDocs = 'https://docs.gitlab.com/user/profile/service_accounts/';
const steps: Record<GitlabMethod, StepId> = { gitlab_service_account: 'connect-gitlab-service-account', token: 'connect-gitlab' };
const flowWords: Record<string, string> = {
  ...sharedFlowWords,
  unknown_flow: 'Ploeg does not know this connection attempt any more. Start Connect GitLab again.',
  flow_expired: 'The connection attempt expired. Start Connect GitLab again.',
  already_connected: 'Ploeg already holds a live connection for this GitLab account.',
  kind_not_allowed: 'The installation does not allow GitLab connections from the screen: connections.allow names no GitLab forge for this instance.',
  unknown_instance: 'Ploeg has no GitLab instance by this name under connections.instances.',
  capability_missing: 'This Ploeg’s GitLab adapter cannot make connections this way yet.',
  probe_failed: 'Ploeg checked the token against GitLab and it did not work, so Ploeg stored nothing. Check that the token has the api scope and has not expired.',
  scopes_insufficient: 'The token lacks the api scope. Create it again with api ticked.',
  credential_refused: 'GitLab refused the token. Copy the whole token again, or create a new one.',
  group_not_found: 'GitLab has no such group, or the token cannot see it.',
  owner_required: 'The token does not belong to an Owner of this group. Create it as an Owner of the top-level group.',
};
const targetWords: Record<string, string> = {
  ...sharedTargetWords,
  not_granted: 'The GitLab account Ploeg connects as is not a member of this project. Give it the Maintainer role on the project or its group first.',
  grant_insufficient: 'The GitLab account needs the Maintainer role on this project: Ploeg pushes branches, opens merge requests and adds the project webhook. Give it Maintainer on the project or its group, then check again.',
  webhook_base_missing: 'Ploeg has no public webhook address (PLOEG_PUBLIC_WEBHOOK_BASE), so it cannot add the project webhook GitLab sends merge request events to. The person who installed Ploeg sets it; then check again.',
  webhook_failed: 'GitLab refused the project webhook Ploeg tried to add first, so Ploeg registered nothing. Check that the account is Maintainer on the project and that GitLab may reach Ploeg’s webhook address, then check again.',
  repository_not_found: 'GitLab has no such project, or the account Ploeg connects as cannot see it.',
  connection_unusable: 'The GitLab connection does not work right now: its token may be revoked or expired. Connect GitLab again.',
  unknown_connection: 'Ploeg holds no such GitLab connection.',
  capability_missing: 'Ploeg cannot give each Run its own GitLab credential through this connection, so it registers no GitLab project on it. A Ploeg that mints for GitLab needs a token with the api scope and Maintainer reach on the project; until then the person who installed Ploeg configures GitLab projects in Ploeg’s chart (executor.gitlab and a targets entry).',
};

/** GitLab's page for a new personal access token, filled in with the name, description and the `api` scope; GitLab offers no parameter for the expiry date. */
export function tokenPage(gitlabUrl: string): string {
  const query = [['name', 'Unfold setup'], ['description', 'Temporary: Ploeg creates its service account with it, then revokes it.'], ['scopes', 'api']].map(([key, value]) => `${key}=${encodeURIComponent(value)}`).join('&');
  return `${gitlabUrl.replace(/\/+$/, '')}/-/user_settings/personal_access_tokens?${query}`;
}

const scrub = (text: string, secret: string) => secret && text.includes(secret) ? text.split(secret).join('[redacted]') : text;

function warningsOf(answer: Record<string, unknown>, token: string): GitlabWarning[] {
  return (Array.isArray(answer.warnings) ? answer.warnings.slice(0, 10) : []).map(object).map(entry => ({ code: short(entry.code, 64) || 'warning', message: scrub(short(entry.message, 1000), token) })).filter(entry => entry.message || entry.code !== 'warning');
}

function serviceAccountOf(value: unknown): GitlabServiceAccount | null {
  const entry = object(value);
  const username = short(entry.username, 255);
  return username ? { username, group: short(entry.group, 255), topGroup: short(entry.topGroup, 255), created: entry.created === true, tokenExpiresAt: short(entry.tokenExpiresAt, 64) || null } : null;
}

/**
 * Connect GitLab and register its projects from Settings → Connections (OpenSpec change `self-serve-onboarding`;
 * system ADR-0060). Ploeg owns the connection (Ploeg ADR-0195): Unfold relays the pasted token to Ploeg's connection
 * flow once, in a request body, and keeps only the Ploeg connection id. With `gitlab_service_account` the token is a
 * temporary one of a top-level group Owner, and Ploeg makes a service account, keeps that account's token and revokes
 * the pasted one; with `token` it is the token of a service account the Admin made. Each method is admitted through
 * its own step, so a Ploeg that does not serve the service-account method is never sent the Owner's token. Picking
 * and registering projects is shared with Connect GitHub.
 */
export class GitlabConnections extends ForgeConnections {
  private readonly gitlabUrl: string;

  constructor(options: Options) {
    super(options, {
      kind: options.plan.gitlab.forge, name: options.plan.gitlab.forgeName, origin: options.gitlabUrl.replace(/\/+$/, ''),
      repository: /^[A-Za-z0-9_.-]{1,255}(?:\/[A-Za-z0-9_.-]{1,255}){1,20}$/, repositoryHint: 'group/subgroup/project',
      connect: 'connect-gitlab', register: 'register-repositories', gate: options.plan.gitlab.mint, mint: options.plan.gitlab.mint,
      flowWords, targetWords, flowRefused: { status: 409, code: 'gitlab_flow_refused' },
    });
    this.gitlabUrl = options.gitlabUrl.replace(/\/+$/, '');
  }

  private remembered(): Record<string, string> { return this.options.store.getSecret<Record<string, string>>(methodsId) ?? {}; }

  private remember(instance: string, method: GitlabMethod, refused: boolean): void {
    const held = this.remembered();
    const key = `${instance}:${method}`;
    if (refused) held[key] = this.now().toISOString(); else if (held[key]) delete held[key]; else return;
    this.options.store.setSecret(methodsId, held);
  }

  private methods(served: Record<GitlabMethod, boolean | null>, instance: string): GitlabMethodState[] {
    const held = this.remembered();
    return (['gitlab_service_account', 'token'] as const).map(method => {
      const step = this.options.plan.steps.find(entry => entry.id === steps[method])!;
      const at = held[`${instance}:${method}`];
      return { method, served: served[method], text: served[method] === false ? unavailableText(step, this.options.pinned) : null, waitsFor: served[method] === false ? { record: step.record, release: step.release } : null, refused: at ? { code: 'method_not_allowed', instance, at } : null };
    });
  }

  /** What the Connect GitLab page shows. It asks Ploeg only reads and writes nothing. */
  async overview(user: User): Promise<GitlabOverview> {
    const manage = this.options.steps.manages(user);
    const instance = this.options.plan.gitlab.instance;
    const base = { manage, gitlabUrl: this.gitlabUrl, instance, tokenPage: tokenPage(this.gitlabUrl), serviceAccountDocs, accounts: this.accounts(), refused: null };
    if (this.options.ploeg.isDemo) return { demo: true, served: { connect: false, register: false }, methods: [], secondForge: null, connections: [], ...base };
    const available = (id: StepId) => this.options.steps.available(user, id, true).then(result => result.served).catch(() => null);
    const [connect, serviceAccount, register] = await Promise.all([available('connect-gitlab'), available('connect-gitlab-service-account'), available('register-repositories')]);
    const methods = this.methods({ gitlab_service_account: serviceAccount, token: connect }, instance);
    const served = { connect, register };
    if (connect === false) return { demo: false, served, methods, secondForge: null, connections: [], ...base };
    const held = await this.held(user);
    if ('unread' in held) return { demo: false, served: { ...served, connect: connect === true ? true : null }, methods, secondForge: null, connections: [], ...base };
    if ('served' in held) return { demo: false, served: { ...served, connect: false }, methods, secondForge: null, connections: [], ...base };
    if ('refused' in held) return { demo: false, served: { ...served, connect: true }, methods, secondForge: null, connections: [], ...base, refused: held.refused };
    return { demo: false, served: { ...served, connect: true }, methods, secondForge: await this.secondForge(user), connections: held.connections, ...base, accounts: this.liveAccounts(held.connections) };
  }

  /**
   * Stage 2 of the checklist with GitLab next to GitHub: green with Connect GitLab once Ploeg holds a GitLab
   * connection made from this screen, else the GitHub line with Connect GitLab as a second action while it waits.
   */
  lines(lines: Partial<Record<StepId, ChecklistLine>>, manage: boolean): Partial<Record<StepId, ChecklistLine>> {
    const github = lines['connect-github'];
    if (!github || github.status === 'ok') return lines;
    const action = { label: 'Connect GitLab', href: connectGitlabHref, kind: 'link' as const };
    if (this.usable() > 0) return { ...lines, 'connect-github': { id: 'connect-github', stage: 2, title: 'Connect GitLab', status: 'ok', text: 'Ploeg holds a GitLab connection made from this screen. Ploeg keeps its token; Unfold keeps none.', ...(manage ? { action: { ...action, label: 'Open Connect GitLab' } } : {}) } };
    if (!manage || github.status !== 'pending') return lines;
    return { ...lines, 'connect-github': { ...github, text: `${github.text} Code on GitLab? Connect GitLab instead.`, actions: [...(github.actions ?? []), action] } };
  }

  /**
   * Connects GitLab through Ploeg with the pasted token. Refused before anything is sent for someone who is not an
   * Admin, a token or group of the wrong shape, a method this Ploeg does not serve (`503 ploeg_step_unavailable`), or
   * an installation that pushes to another forge. The token goes to Ploeg once, in the body of the completion, and is
   * never stored, logged, audited or answered; a refusal Ploeg words with it is shown without it.
   */
  async connect(user: User, input: unknown): Promise<GitlabConnected> {
    if (!this.options.steps.manages(user)) throw new PloegError(403, 'forbidden', 'Only an administrator connects accounts and adds repositories and Lists.');
    const data = object(input);
    const method: GitlabMethod | undefined = data.method === 'service_account' || data.method === 'gitlab_service_account' ? 'gitlab_service_account' : data.method === 'token' ? 'token' : undefined;
    if (!method) throw new PloegError(400, 'invalid_input', 'Send {method: "service_account", token, group} to let Ploeg create the service account, or {method: "token", token} for one you made.');
    const instance = data.instance === undefined || data.instance === '' ? this.options.plan.gitlab.instance : typeof data.instance === 'string' && connectionId.test(data.instance) ? data.instance : '';
    if (!instance) throw new PloegError(400, 'invalid_input', 'instance must name a GitLab instance of Ploeg’s connections.instances, or be left out.');
    const token = typeof data.token === 'string' ? data.token.trim() : '';
    if (!tokenPattern.test(token)) throw new PloegError(400, 'connection_token_invalid', 'That is not a GitLab personal access token. Copy the whole token again from GitLab, without spaces.');
    const group = method === 'gitlab_service_account' ? (typeof data.group === 'string' ? data.group.trim().replace(/^\/+|\/+$/g, '') : '') : undefined;
    if (group !== undefined && !groupPattern.test(group)) throw new PloegError(400, 'invalid_input', 'Name the GitLab group whose projects Ploeg may use by its path, such as acme or acme/web.');
    await this.options.steps.admit(user, steps[method]);
    await this.admitSecondForge(user);
    const label = group ? `Unfold service account for ${group}`.slice(0, 200) : 'Unfold service account';
    let started: Record<string, unknown>;
    try { started = await this.call(user, 'connection-flows', { port: 'forge', kind: this.forge.kind, instance, method, label }); }
    catch (error) { return this.refused(user, error, instance, method, token); }
    const state = short(object(started.flow).state, 512);
    if (!state) throw new PloegError(502, 'ploeg_response', 'Ploeg answered the start of the connection in a form this Unfold cannot read.');
    let answer: Record<string, unknown>;
    try { answer = await this.call(user, 'connection-flows/complete', { state, token, ...(group ? { group } : {}) }, true); }
    catch (error) {
      const adopted = await this.alreadyConnected(user, error);
      if (!adopted) return this.refused(user, error, instance, method, token);
      answer = { connection: adopted };
    }
    const connection = forgeConnection(object(answer.connection));
    if (!connection.id || connection.kind && connection.kind !== this.forge.kind) throw new PloegError(502, 'ploeg_response', 'Ploeg answered the connection in a form this Unfold cannot read.');
    this.remember(instance, method, false);
    const serviceAccount = serviceAccountOf(answer.serviceAccount);
    const warnings = warningsOf(answer, token);
    const account = this.saveAccount(user, connection, { method, instance, ...(group ? { group } : {}), ...(serviceAccount ? { serviceAccount: serviceAccount.username } : {}), ...(warnings.length ? { warnings: warnings.map(entry => entry.code).join(',') } : {}) });
    return { connection: { id: connection.id, account: connection.account, state: connection.state, method, canMint: connection.canMint }, serviceAccount, account, warnings };
  }

  /**
   * Removes a GitLab connection in Ploeg and forgets its Integration Account. Ploeg answers what it left at GitLab,
   * such as the service account or a token it could not revoke, and the page shows it. One Ploeg no longer holds is
   * forgotten as removed; one a repository or binding still uses is refused with `409 connection_in_use`.
   */
  async remove(user: User, connection: string): Promise<{ removed: string; leftAtVendor: GitlabLeft[] }> {
    if (!this.options.steps.manages(user)) throw new PloegError(403, 'forbidden', 'Only an administrator connects accounts and adds repositories and Lists.');
    if (!connectionId.test(connection)) throw new PloegError(400, 'invalid_input', 'Name a GitLab connection Ploeg holds.');
    await this.options.steps.admit(user, 'connect-gitlab');
    let answer: Record<string, unknown> = {};
    try { answer = object(await this.options.ploeg.operatorCall(user, `forge-connections/${encodeURIComponent(connection)}`, { method: 'DELETE' })); }
    catch (error) {
      if (error instanceof PloegOperatorRefusal && error.code === 'connection_in_use') throw new PloegError(409, 'connection_in_use', 'Ploeg still uses this GitLab connection for registered repositories. Remove those first, then remove the connection. (Ploeg: connection_in_use)');
      if (!(error instanceof PloegOperatorRefusal && error.status === 404)) return this.refuse(user, 'connect-gitlab', error, this.forge.flowWords, this.forge.flowRefused);
    }
    const leftAtVendor = (Array.isArray(answer.leftAtVendor) ? answer.leftAtVendor.slice(0, 50) : []).map(object).map(entry => ({ kind: short(entry.kind, 64), id: short(entry.id, 255), url: short(entry.url, 2048) || null })).filter(entry => entry.kind);
    this.forgetAccount(user, connection);
    return { removed: connection, leftAtVendor };
  }

  private async alreadyConnected(user: User, error: unknown): Promise<Record<string, unknown> | null> {
    if (!(error instanceof PloegOperatorRefusal) || error.code !== 'already_connected') return null;
    const named = typeof error.detail.connection === 'string' ? error.detail.connection : short(object(error.detail.connection).id, 128);
    if (!named) return null;
    const held = await this.held(user);
    if (!('connections' in held)) return null;
    const found = held.connections.find(entry => entry.id === named);
    return found ? { id: found.id, kind: found.kind, instance: found.instance, method: found.method, source: found.source, state: found.state, invalidReason: found.invalidReason, account: found.account ? { login: found.account } : null, ...(found.canMint === null ? {} : { canMint: found.canMint }) } : null;
  }

  private refused(user: User, error: unknown, instance: string, method: GitlabMethod, token: string): never {
    if (error instanceof Error) error.message = scrub(error.message, token);
    if (error instanceof PloegOperatorRefusal && error.code === 'method_not_allowed') {
      this.remember(instance, method, true);
      throw new PloegError(409, 'method_not_allowed', `The installation does not allow ${method === 'token' ? 'a pasted service-account token' : 'Ploeg to create the service account'} for the GitLab instance ${instance}: connections.allow does not list ${method} for it. ${method === 'token' ? 'Use the temporary Owner token instead, or ask' : 'Paste the token of a service account you made instead, or ask'} the person who installed Ploeg to add the method. (Ploeg: method_not_allowed)`);
    }
    return this.refuse(user, steps[method], error, this.forge.flowWords, this.forge.flowRefused);
  }
}
