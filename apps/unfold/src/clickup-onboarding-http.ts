import { PloegError, PloegOperatorRefusal } from './ploeg.ts';
import { TaskError } from './task-providers/shared.ts';
import type { ClickUpOnboarding } from './clickup-onboarding.ts';
import type { User } from './types.ts';

/** One request to Connect ClickUp, as the HTTP server hands it over. */
export type ClickUpRequest = { method: string; path: string; user: User; signIn: string | undefined; query: URLSearchParams; body: () => Promise<Record<string, unknown>> };
/** The answer: JSON with a status, or a redirect back to the page after ClickUp's OAuth callback. */
export type ClickUpAnswer = { status: number; body: unknown } | { redirect: string };

const prefix = '/api/onboarding/clickup';
const detailed = new Set(['conflicts_with_static', 'probe_failed', 'binding_exists', 'already_connected', 'connection_in_use']);
const shownDetail = (code: string, detail: Record<string, unknown>) => detailed.has(code) ? Object.fromEntries(Object.entries(detail).filter(([key]) => ['checks', 'staticEntry', 'entry', 'team', 'destination', 'binding', 'connection', 'bindings'].includes(key))) : {};
const page = (query: string) => `/?${query}#settings/connect-clickup`;

/** Whether `path` belongs to Connect ClickUp. */
export function isClickUpRoute(path: string): boolean { return path === prefix || path.startsWith(`${prefix}/`); }

/**
 * Connect ClickUp's routes (OpenSpec change `self-serve-onboarding`, slice S5). A refusal carries Ploeg's own code
 * and, for a binding, each check and the static entry that routes the List, never a token, code or `state`.
 */
export async function clickUpRoute(service: ClickUpOnboarding, request: ClickUpRequest): Promise<ClickUpAnswer | undefined> {
  const { method, path, user, signIn, query, body } = request;
  if (method === 'GET' && path === '/api/onboarding/clickup/callback') {
    const denied = query.get('error');
    if (denied) return { redirect: page(`clickup_error=${encodeURIComponent(denied.replace(/[^a-z_]/gi, '').slice(0, 40) || 'denied')}`) };
    try { await service.completeOAuth(user, signIn, query.get('code') ?? '', query.get('state') ?? ''); return { redirect: page('clickup=connected') }; }
    catch (error) { if (error instanceof PloegError || error instanceof TaskError) return { redirect: page(`clickup_error=${encodeURIComponent(error.code.slice(0, 40))}`) }; throw error; }
  }
  try {
    if (path === '/api/onboarding/clickup' && method === 'GET') return { status: 200, body: await service.view(user) };
    if (path === '/api/onboarding/clickup/token' && method === 'POST') return { status: 201, body: { connection: await service.connectWithToken(user, await body()) } };
    if (path === '/api/onboarding/clickup/oauth' && method === 'POST') return { status: 200, body: await service.startOAuth(user, signIn) };
    if (path === '/api/onboarding/clickup/map' && method === 'GET') return { status: 200, body: await service.mapOptions(user) };
    if (path === '/api/onboarding/clickup/bindings' && method === 'POST') return { status: 200, body: await service.bind(user, await body()) };
    const connection = path.match(/^\/api\/onboarding\/clickup\/connections\/(tc-[a-f0-9]{12})(?:\/(lists))?$/);
    if (connection && !connection[2] && method === 'DELETE') return { status: 200, body: await service.removeConnection(user, connection[1]) };
    if (connection && connection[2] && method === 'GET') return { status: 200, body: await service.lists(user, connection[1], query.get('parent') ?? undefined, query.get('after') ?? undefined) };
    const orphan = path.match(/^\/api\/onboarding\/clickup\/unrecorded\/([A-Za-z0-9][A-Za-z0-9_.:-]{0,127})(?:\/(adopt))?$/);
    if (orphan && orphan[2] && method === 'POST') return { status: 201, body: { connection: await service.adopt(user, orphan[1]) } };
    if (orphan && !orphan[2] && method === 'DELETE') return { status: 200, body: await service.removeUnrecorded(user, orphan[1]) };
    const binding = path.match(/^\/api\/onboarding\/clickup\/bindings\/([a-z0-9][a-z0-9-]{0,63})(?:\/(check))?$/);
    if (binding && binding[2] && method === 'POST') return { status: 200, body: { source: await service.check(user, binding[1]) } };
    if (binding && !binding[2] && method === 'DELETE') return { status: 200, body: await service.unbind(user, binding[1]) };
  } catch (error) {
    if (error instanceof PloegOperatorRefusal) return { status: error.status === 401 ? 403 : error.status, body: { error: { code: error.code, message: error.message, ...shownDetail(error.code, error.detail) } } };
    if (error instanceof PloegError || error instanceof TaskError) return { status: error.status, body: { error: { code: error.code, message: error.message } } };
    throw error;
  }
  if (known.some(pattern => pattern.test(path))) return { status: 405, body: { error: { code: 'method', message: `This address does not take ${method}. The API reference at /api/openapi.yaml lists the methods it takes.` } } };
  return undefined;
}

const known = [/^\/api\/onboarding\/clickup(?:\/(?:token|oauth|callback|map|bindings))?$/, /^\/api\/onboarding\/clickup\/connections\/(tc-[a-f0-9]{12})(?:\/(lists))?$/, /^\/api\/onboarding\/clickup\/bindings\/([a-z0-9][a-z0-9-]{0,63})(?:\/(check))?$/, /^\/api\/onboarding\/clickup\/unrecorded\/([A-Za-z0-9][A-Za-z0-9_.:-]{0,127})(?:\/(adopt))?$/];
