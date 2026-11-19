export const unfoldAuthenticationId = 'unfold';
export const unfoldAuthenticationLabel = 'Unfold';

export type UnfoldAccount = { id: string; name: string };
export type UnfoldSession = { id: string; accessToken: string; account: { id: string; label: string }; scopes: readonly string[] };
export type SessionsChange = { added: UnfoldSession[]; removed: UnfoldSession[]; changed: UnfoldSession[] };
export type Disposable = { dispose(): void };

export type AuthenticationHost = {
  origin(): string | undefined;
  credential(origin: string): Promise<string | undefined>;
  account(origin: string): Promise<UnfoldAccount | 'signed-out' | 'unreachable'>;
  signIn(): Promise<void>;
  signOut(): Promise<void>;
  expired(): void;
};

export type AuthenticationApi = {
  register(id: string, label: string, provider: UnfoldAuthentication): Disposable;
  offerSignIn(id: string): Promise<unknown>;
};

type ApiHost = { authentication?: { registerAuthenticationProvider?: unknown; getSession?: unknown } };

export function authenticationApi(host: ApiHost): AuthenticationApi | undefined {
  const api = host.authentication;
  const register = api?.registerAuthenticationProvider;
  const getSession = api?.getSession;
  if (typeof register !== 'function' || typeof getSession !== 'function') return undefined;
  return {
    register: (id, label, provider) => register.call(api, id, label, provider, { supportsMultipleAccounts: false }) as Disposable,
    offerSignIn: id => Promise.resolve(getSession.call(api, id, [], { createIfNone: false })).then(undefined, () => undefined),
  };
}

export function accountLabel(name: string, origin: string): string {
  return `${name} · ${new URL(origin).host}`;
}

export class UnfoldAuthentication implements Disposable {
  private known?: UnfoldSession;
  private resolved?: { origin: string; credential: string; account: UnfoldAccount };
  private readonly listeners = new Set<(change: SessionsChange) => void>();
  private pending: Promise<void> = Promise.resolve();
  private leftOn?: string;

  private readonly host: AuthenticationHost;

  constructor(host: AuthenticationHost) { this.host = host; }

  readonly onDidChangeSessions = (listener: (change: SessionsChange) => void): Disposable => {
    this.listeners.add(listener);
    return { dispose: () => { this.listeners.delete(listener); } };
  };

  async getSessions(): Promise<UnfoldSession[]> {
    const session = await this.current();
    return session ? [session] : [];
  }

  async createSession(): Promise<UnfoldSession> {
    await this.host.signIn();
    const session = await this.current();
    await this.refresh();
    if (!session) throw new Error('The sign-in to Unfold did not complete.');
    return session;
  }

  async removeSession(id: string): Promise<void> {
    const session = await this.current();
    if (session?.id === id) await this.signOut();
    else await this.refresh();
  }

  async signOut(): Promise<void> {
    this.leftOn = this.host.origin();
    try { await this.host.signOut(); }
    finally { await this.refresh(); }
  }

  refresh(): Promise<void> {
    this.pending = this.pending.then(() => this.announce(), () => this.announce());
    return this.pending;
  }

  dispose(): void { this.listeners.clear(); }

  private async announce(): Promise<void> {
    const next = await this.current().catch(() => undefined);
    const previous = this.known;
    this.known = next;
    const change: SessionsChange = { added: [], removed: [], changed: [] };
    if (previous && (!next || previous.id !== next.id)) change.removed.push(previous);
    if (next && (!previous || previous.id !== next.id)) change.added.push(next);
    if (previous && next && previous.id === next.id && (previous.accessToken !== next.accessToken || previous.account.label !== next.account.label)) change.changed.push(next);
    if (next) this.leftOn = undefined;
    if (!change.added.length && !change.removed.length && !change.changed.length) return;
    for (const listener of [...this.listeners]) listener(change);
    if (previous && !next && this.leftOn !== previous.id) this.host.expired();
  }

  private async current(): Promise<UnfoldSession | undefined> {
    const origin = this.host.origin();
    if (!origin) return undefined;
    const credential = await this.host.credential(origin);
    if (!credential) return undefined;
    const account = await this.accountFor(origin, credential);
    if (!account) return undefined;
    return { id: origin, accessToken: credential, account: { id: `${account.id}@${origin}`, label: accountLabel(account.name, origin) }, scopes: [] };
  }

  private async accountFor(origin: string, credential: string): Promise<UnfoldAccount | undefined> {
    if (this.resolved?.origin === origin && this.resolved.credential === credential) return this.resolved.account;
    const account = await this.host.account(origin);
    if (account === 'signed-out') { this.resolved = undefined; return undefined; }
    if (account === 'unreachable') return { id: 'unknown', name: 'Unfold' };
    this.resolved = { origin, credential, account };
    return account;
  }
}
