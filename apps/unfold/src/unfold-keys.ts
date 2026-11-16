/**
 * The names under which Unfold labels what it creates and tags what it sends. Each name moves from the previous
 * owner's prefix to an Unfold-owned one in two releases (ADR-0067): this release writes both, the next drops the first.
 */
export const retiringPrefix = 'dev.webgrip.unfold';

/** The `_meta` key of Unfold's own facts in Agent Host Protocol messages, and of its metadata in an Agent Trace record. */
export const metaKey = 'dev.unfoldhq.unfold';

/** The Kubernetes label and annotation prefix, a DNS subdomain as Kubernetes recommends. */
export const kubernetesPrefix = 'unfoldhq.dev';

/** The Docker label prefix, in the reverse-DNS order Docker recommends. */
export const dockerPrefix = 'dev.unfoldhq.unfold';

/** Unfold's facts under both the current and the retiring `_meta` key. */
export function unfoldMeta<T>(facts: T): Record<string, T> {
  return { [retiringPrefix]: facts, [metaKey]: facts };
}

function prefixed(prefix: string, names: Readonly<Record<string, string>>): Record<string, string> {
  return Object.fromEntries(Object.entries(names).flatMap(([name, value]) => [[`${retiringPrefix}/${name}`, value], [`${prefix}/${name}`, value]]));
}

/** Kubernetes labels or annotations, each under the current and the retiring prefix. */
export const kubernetesKeys = (names: Readonly<Record<string, string>>): Record<string, string> => prefixed(kubernetesPrefix, names);

/** Docker labels, each under the current and the retiring prefix. */
export const dockerLabels = (names: Readonly<Record<string, string>>): Record<string, string> => prefixed(dockerPrefix, names);

