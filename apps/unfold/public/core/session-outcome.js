/**
 * The reviewer's Run that asked for changes, when that is why the session stopped; null for every other end. The work
 * ran as it should and the change is kept: a person decides what happens to it.
 * @param {{ status?: string, failure?: { category?: string }, runs?: { mode?: string, verdict?: string, roleName?: string, summary?: string }[] } | null | undefined} session
 * @returns {{ roleName?: string, summary?: string } | null}
 */
export function askedForChanges(session) {
  if (session?.status !== 'failed' || session.failure?.category !== 'review_incomplete') return null;
  return (session.runs ?? []).findLast(run => run.mode === 'read' && run.verdict === 'request_changes') ?? null;
}

/** The headline for a session its reviewer sent back, such as `Reviewer asked for changes`. */
export function askedForChangesTitle(run) { return `${run.roleName || 'The reviewer'} asked for changes`; }

/** What became of the change of a session its reviewer sent back: kept only when it was captured. */
export function askedForChangesFate(session) { return session?.candidate?.status === 'ready' ? 'The change is kept. Nothing was pushed or merged.' : 'Nothing was pushed or merged.'; }
