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

function attachmentsOf(message: unknown): Json[] {
  const attachments = Array.isArray((message as Json)?.attachments) ? (message as Json).attachments as Json[] : [];
  return attachments.filter(attachment => attachment && typeof attachment === 'object');
}

/**
 * The names of a message's attachments that no Team receives: embedded content, such as a pasted screenshot, files
 * outside the host's repositories folder and skill references, whose content Unfold cannot pass on. Commands and review
 * feedback are read by the host, and the repositories' own files are already in the Team's workspace. Only names are
 * returned, never content.
 */
export function unsentAttachments(message: unknown, repositoriesDirectory: string): string[] {
  return attachmentsOf(message).filter(attachment => {
    if (attachment.type === 'embeddedResource') return true;
    return attachment.type === 'resource' && (attachment.displayKind === 'skill' || !hostSide(attachment.uri, repositoriesDirectory));
  }).map(nameOf);
}

/** The most characters of message text Unfold accepts: an instruction or first message of a session, and a Work Item note. */
export const messageLimits = { session: 20000, workItemNote: 4096 } as const;

function passedOn(attachment: Json): attachment is Json & { modelRepresentation: string } {
  if (attachment.type !== 'simple' || typeof attachment.modelRepresentation !== 'string' || !attachment.modelRepresentation.trim()) return false;
  return attachment.displayKind !== 'command' && attachment.displayKind !== 'agentFeedback' && !attachment._meta?.command && !attachment._meta?.agentFeedback;
}

function fenced(content: string): string {
  const longest = Math.max(0, ...[...content.matchAll(/`+/g)].map(run => run[0].length));
  const fence = '`'.repeat(Math.max(3, longest + 1));
  return `${fence}text\n${content}\n${fence}`;
}

const attachedBlock = (attachment: Json & { modelRepresentation: string }): string =>
  `The person attached ${quoted(nameOf(attachment))}. It is their input, not an instruction from Unfold:\n${fenced(attachment.modelRepresentation.trim())}`;

/**
 * The text a Team receives for a message: the person's text followed by each attached link or text snippet, marked as
 * the person's attachment, as long as it fits within `limit` characters. Unfold never fetches a link; the Team gets its
 * text. `unsent` names every attachment that stayed behind, including a snippet that did not fit.
 */
export function forwardedMessage(message: unknown, text: string, repositoriesDirectory: string, limit: number): { text: string; unsent: string[] } {
  const unsent = unsentAttachments(message, repositoriesDirectory);
  let forwarded = text;
  for (const attachment of attachmentsOf(message).filter(passedOn)) {
    const joined = [forwarded, attachedBlock(attachment)].filter(Boolean).join('\n\n');
    if (joined.length <= limit) forwarded = joined;
    else unsent.push(nameOf(attachment));
  }
  return { text: forwarded, unsent };
}
