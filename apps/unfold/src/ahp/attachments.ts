type Json = Record<string, any>;

/** The event the host records when the first message of a session carried attachments no Team receives. Later messages carry the names on their own `message` event. */
export const unsentAttachmentsEvent = 'attachments.unsent';

const quoted = (name: string) => `\`${name.replace(/[`\r\n]+/g, ' ').trim()}\``;

function listed(names: readonly string[]): string {
  const shown = names.map(quoted);
  return shown.length === 1 ? shown[0] : `${shown.slice(0, -1).join(', ')} and ${shown.at(-1)}`;
}

/** The line a person reads when their message carried attachments the Team does not receive. */
export const unsentAttachmentsNotice = (names: readonly string[]): string =>
  `Only your text reaches the Team. Unfold cannot pass attachments on yet, so ${listed(names)} stayed in VS Code.`;

function basename(uri: unknown): string {
  if (typeof uri !== 'string') return '';
  try { return decodeURIComponent(new URL(uri).pathname).split('/').filter(Boolean).at(-1) ?? ''; } catch { return ''; }
}

function hostSide(uri: unknown, repositoriesDirectory: string): boolean {
  if (typeof uri !== 'string') return false;
  return uri === repositoriesDirectory || uri.startsWith(`${repositoriesDirectory}/`) || uri.startsWith('vscode-agent-host:');
}

function nameOf(attachment: Json): string {
  const label = typeof attachment.label === 'string' ? attachment.label.trim() : '';
  return label || basename(attachment.uri) || (attachment.displayKind === 'image' ? 'image' : 'attachment');
}

/**
 * The names of a message's attachments that no Team receives: embedded content, such as a pasted screenshot, and files
 * outside the host's repositories folder. Commands, review feedback, skill references and the repositories' own files are
 * read by the host or are already in the Team's workspace. Only names are returned, never content.
 */
export function unsentAttachments(message: unknown, repositoriesDirectory: string): string[] {
  const attachments = Array.isArray((message as Json)?.attachments) ? (message as Json).attachments as Json[] : [];
  return attachments.filter(attachment => {
    if (!attachment || typeof attachment !== 'object') return false;
    if (attachment.type === 'embeddedResource') return true;
    return attachment.type === 'resource' && attachment.displayKind !== 'skill' && !hostSide(attachment.uri, repositoriesDirectory);
  }).map(nameOf);
}
