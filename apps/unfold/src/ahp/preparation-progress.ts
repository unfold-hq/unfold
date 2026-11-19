type Json = Record<string, any>;

/** The one title for the whole preparation: VS Code 1.147 titles its progress from the first frame and shows no later message. Unfold knows no duration, so the first frame stays at zero and carries no total. */
export const preparationTitle = 'Starting the session';

const endingEvents = new Set(['run.started', 'session.completed', 'session.failed', 'session.cancelled', 'session.paused', 'session.interrupted', 'execution.authority_lost', 'execution.reconciliation_required', 'execution.reconciliation_pending']);

type Watch<C> = { client: C; token: string };

/**
 * Native progress for a session created with a `progressToken`: `root/progress` frames to the one client that created it,
 * from its first message until a Run starts or the session stops. Frames go to that client only, never to another window.
 */
export class PreparationProgress<C> {
  private readonly provisional = new Map<string, Watch<C>>();
  private readonly preparing = new Map<string, Watch<C>>();
  private readonly send: (client: C, params: Json) => void;

  constructor(send: (client: C, params: Json) => void) { this.send = send; }

  get watching(): boolean { return this.preparing.size > 0; }

  remember(publicId: string, client: C, token: unknown): void {
    if (typeof token === 'string' && token) this.provisional.set(publicId, { client, token });
  }

  forget(publicId: string): void { this.provisional.delete(publicId); }

  begin(publicId: string, sessionId: string): void {
    const watch = this.provisional.get(publicId);
    if (!watch) return;
    this.provisional.delete(publicId);
    this.preparing.set(sessionId, watch);
    this.frame(watch, { progress: 0, message: preparationTitle });
  }

  observe(sessionId: string, eventType: string): void {
    const watch = this.preparing.get(sessionId);
    if (!watch) return;
    if (endingEvents.has(eventType)) this.end(sessionId);
  }

  end(sessionId: string): void {
    const watch = this.preparing.get(sessionId);
    if (!watch) return;
    this.preparing.delete(sessionId);
    this.frame(watch, { progress: 0, total: 0 });
  }

  private frame(watch: Watch<C>, step: Json): void {
    this.send(watch.client, { channel: 'ahp-root://', progressToken: watch.token, ...step });
  }
}
