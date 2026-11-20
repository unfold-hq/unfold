import type { Store } from '../store.ts';
import type { User } from '../types.ts';
import type { PloegAskAllowance } from '../ploeg.ts';
import { money } from '../../public/core/format.js';
import { askMarkdown, resetDay, type ChatAskEntry, type ChatAsks } from './asks.ts';

type Json = Record<string, any>;

/** Advertised in `initialize` so VS Code 1.147 may open a side chat that does not carry the source chat's history. */
export const sideChatWithoutContextMeta = 'vscode.sideChatWithoutContext';
/** Declared by a client that addresses chats beside a session's default chat, as VS Code 1.147 does and 1.142 does not. */
export const chatUrisClientMeta = 'vscode.ahpChatUris';
/** The agent capability without which VS Code 1.147 offers no side chat on a session. */
export const sideChatCapabilities = { multipleChats: { sideChat: true } } as const;

const sideChatPattern = /^ahp-chat:\/\/([A-Za-z0-9_-]{1,128})\/([A-Za-z0-9_-]{1,400})$/;
const reservedChatIds = new Set(['default', 'subagent']);
const maxChats = 20;
const maxTurns = 100;
const maxQuestion = 2000;
const statusBits = { idle: 1, inProgress: 8, inputNeeded: 24 } as const;

/** The chat id and session URI of a chat URI VS Code minted for a chat beside a session's default chat. */
export function parseSideChatUri(uri: string): { chatId: string; session: string } | undefined {
  const shaped = sideChatPattern.exec(uri);
  if (!shaped || reservedChatIds.has(shaped[1])) return undefined;
  return { chatId: shaped[1], session: Buffer.from(shaped[2], 'base64url').toString('utf8') };
}

/** A side chat's URI in the spelling of the session URI a client uses. */
export const sideChatUri = (chatId: string, session: string) => `ahp-chat://${chatId}/${Buffer.from(session).toString('base64url')}`;

/** What a side chat says. Every reply says what was spent, and nothing in it reaches the Team. */
export const sideChatText = {
  title: (workItemId: string) => `Ask about #${workItemId}`,
  notSetUp: (page: string) => `Asking is not set up on this workbench, so nothing was asked or spent. An administrator connects Ploeg and a model gateway to answer Asks.${elsewhere(page)}`,
  spendUnknown: (workItemId: string, page: string) => `Unfold can't say what asking a model about #${workItemId} would spend: Ask is not set up here, or Ploeg did not report the Ask Allowance. Nothing was asked or spent.${elsewhere(page)}`,
  asksOff: (team: string) => `Asking a model is not enabled for ${team}, so nothing was asked or spent.`,
  question: (workItemId: string) => `Ask a model about #${workItemId}?`,
  spend: (workItemId: string, team: string, allowance: PloegAskAllowance) => `The record does not answer this, so only a model can. One answer about #${workItemId} spends up to ${money(allowance.askBudgetUsd)} from ${team}'s Ask Allowance, ${money(allowance.remainingUsd)} of ${money(allowance.limitUsd)} left until ${resetDay(allowance.resetAt)}. Nothing is asked or spent until you confirm, and the Team never reads this chat.`,
  declined: (page: string) => `Not asked, so nothing was spent.${elsewhere(page) || ' You can ask in Unfold instead, on the Work Item\'s page.'}`,
  notAsked: (reason: string) => `Not asked: ${reason.replace(/\.$/, '')}. Nothing was spent.`,
  busy: 'This side chat answers one question at a time. Answer or close the question above first.',
  interrupted: 'No answer arrived: the workbench stopped while it was asking. Ask again.',
  readOnly: 'A side chat only asks about the Work Item. Nothing in it reaches the Team or changes the Work Item.',
  emptyQuestion: 'Type a question.',
  longQuestion: `Keep the question under ${maxQuestion} characters.`,
} as const;

function elsewhere(page: string): string { return page ? ` You can ask in Unfold instead: ${page}` : ''; }

type Confirmation = { requestId: string; request: Json; explanation: string; response?: 'accept' | 'cancel'; answers?: Json };
type SideTurn = { turnId: string; text: string; startedAt: string; confirmation?: Confirmation; ask?: ChatAskEntry; reply?: string; finishedAt?: string };
/** A side chat on a Work Item session: one person's Asks about that Work Item, apart from the Work Item's own chat. */
export type SideChat = { chatId: string; publicId: string; workItemId: string; userId: string; createdAt: string; modifiedAt: string; origin: { chat: string; turnId: string; selection?: { text: string; responsePartId?: string } }; turns: SideTurn[] };
/** Where a side chat's replies go: the person's clients that follow it, and its status on the session's catalog. */
export type SideChatOutlet = { chat(actions: Json[]): void; status(chat: SideChat): void };

const chatsKey = (userId: string, publicId: string) => `ahp-side-chats:${userId}:${publicId}`;
const duration = (turn: SideTurn) => Math.max(0, Date.parse(turn.finishedAt ?? turn.startedAt) - Date.parse(turn.startedAt)) || 0;

function confirmationRequest(requestId: string, workItemId: string, allowance: PloegAskAllowance): Json {
  const question = sideChatText.question(workItemId);
  return { id: requestId, message: question, questions: [{ id: '0', title: question, message: `One answer spends up to ${money(allowance.askBudgetUsd)} from the Ask Allowance.`, kind: 'single-select', required: true, options: [{ id: 'ask', label: `Ask and spend up to ${money(allowance.askBudgetUsd)}` }, { id: 'keep', label: 'Don\'t ask' }], allowFreeformInput: false }] };
}

const confirmed = (response: unknown, answers: Json | undefined) => response === 'accept' && answers?.['0']?.value?.kind === 'selected' && answers['0'].value.value === 'ask';

/** Reads a `createChat` source as a side chat's origin, or says why it is not one. */
export function sideChatOrigin(params: Json): SideChat['origin'] | { refused: string } {
  const source = params.source;
  const withoutContext = params._meta?.[sideChatWithoutContextMeta];
  if (withoutContext !== undefined && typeof withoutContext !== 'boolean') return { refused: 'Invalid createChat side-chat context metadata' };
  if (source?.kind !== 'sideChat' || typeof source.chat !== 'string' || typeof source.turnId !== 'string' || !source.turnId) return { refused: 'A side chat needs a sideChat source with a chat and a turnId' };
  const text = typeof source.selection?.text === 'string' ? source.selection.text.slice(0, maxQuestion) : '';
  const part = typeof source.selection?.responsePartId === 'string' ? { responsePartId: source.selection.responsePartId } : {};
  return { chat: source.chat, turnId: source.turnId.slice(0, 128), ...(text ? { selection: { text, ...part } } : {}) };
}

/**
 * The side chats people open beside a Work Item's chat in VS Code 1.147. A side chat only asks: a question is answered
 * from the record for free, and otherwise by a model only after the person confirmed what Ask may spend. It never
 * reaches the Team, starts a Run or writes to Ploeg; the Ask Allowance meters the model call as for every Ask.
 */
export class WorkItemSideChats {
  private readonly store: Store;
  private readonly asks: ChatAsks;
  private readonly now: () => Date;
  private readonly asking = new Set<string>();

  constructor(store: Store, asks: ChatAsks, now: () => Date = () => new Date()) { this.store = store; this.asks = asks; this.now = now; }

  list(userId: string, publicId: string): SideChat[] { return this.store.getSecret<SideChat[]>(chatsKey(userId, publicId)) ?? []; }

  find(userId: string, publicId: string, chatId: string): SideChat | undefined { const chat = this.list(userId, publicId).find(entry => entry.chatId === chatId); return chat && this.settle(chat); }

  private save(chat: SideChat): void {
    chat.modifiedAt = this.now().toISOString();
    const others = this.list(chat.userId, chat.publicId).filter(entry => entry.chatId !== chat.chatId);
    this.store.setSecret(chatsKey(chat.userId, chat.publicId), [...others, { ...chat, turns: chat.turns.slice(-maxTurns) }].slice(-maxChats));
  }

  /** Opens a side chat, or returns the one the person already opened under that id. */
  open(user: User, publicId: string, workItemId: string, chatId: string, origin: SideChat['origin']): SideChat {
    const existing = this.find(user.id, publicId, chatId);
    if (existing) return existing;
    const at = this.now().toISOString();
    const chat: SideChat = { chatId, publicId, workItemId, userId: user.id, createdAt: at, modifiedAt: at, origin, turns: [] };
    this.save(chat);
    return chat;
  }

  close(userId: string, publicId: string, chatId: string): boolean {
    const chats = this.list(userId, publicId);
    const kept = chats.filter(chat => chat.chatId !== chatId);
    if (kept.length === chats.length) return false;
    this.store.setSecret(chatsKey(userId, publicId), kept);
    return true;
  }

  private openTurn(chat: SideChat): SideTurn | undefined { return chat.turns.find(turn => !turn.finishedAt); }

  /** Ends, without an answer, a turn whose Ask this process no longer runs because the workbench restarted while asking. */
  private settle(chat: SideChat): SideChat {
    const stranded = chat.turns.find(turn => !turn.finishedAt && !this.asking.has(turn.turnId) && !(turn.confirmation && !turn.confirmation.response));
    if (stranded) { Object.assign(stranded, { reply: sideChatText.interrupted, finishedAt: this.now().toISOString() }); this.save(chat); }
    return chat;
  }

  status(chat: SideChat): number {
    const open = this.openTurn(chat);
    return !open ? statusBits.idle : open.confirmation && !open.confirmation.response ? statusBits.inputNeeded : statusBits.inProgress;
  }

  summary(chat: SideChat, session: string): Json {
    return { resource: sideChatUri(chat.chatId, session), title: sideChatText.title(chat.workItemId), status: this.status(chat), modifiedAt: chat.modifiedAt, origin: { kind: 'sideChat', ...chat.origin }, interactivity: 'full' };
  }

  state(chat: SideChat, session: string): Json {
    const turns = chat.turns.map(turn => this.turn(turn));
    const active = turns.find(turn => !turn.state);
    return { ...this.summary(chat, session), turns: turns.filter(turn => turn.state), ...(active ? { activeTurn: active } : {}), changesets: [] };
  }

  private parts(turn: SideTurn): Json[] {
    const confirmation = turn.confirmation;
    return [
      ...(confirmation ? [{ kind: 'markdown', id: `${confirmation.requestId}-explanation`, content: confirmation.explanation }, { kind: 'inputRequest', request: confirmation.answers ? { ...confirmation.request, answers: confirmation.answers } : confirmation.request, ...(confirmation.response ? { response: confirmation.response } : {}) }] : []),
      ...(turn.ask ? [{ kind: 'markdown', id: `${turn.turnId}-ask-${turn.ask.askId}`, content: askMarkdown(this.store.getAsk(turn.ask.askId), turn.ask) }] : []),
      ...(turn.reply ? [{ kind: 'markdown', id: `${turn.turnId}-reply`, content: turn.reply }] : []),
    ];
  }

  private turn(turn: SideTurn): Json {
    const shown = { id: turn.turnId, startedAt: turn.startedAt, message: { text: turn.text, origin: { kind: 'user' } }, responseParts: this.parts(turn) };
    return turn.finishedAt ? { ...shown, duration: duration(turn), state: 'complete' } : shown;
  }

  /** Why a message cannot start a turn in this side chat, or undefined when it can. */
  refusal(chat: SideChat, text: string): string | undefined {
    if (this.openTurn(chat)) return sideChatText.busy;
    if (!text) return sideChatText.emptyQuestion;
    if (text.length > maxQuestion) return sideChatText.longQuestion;
    return undefined;
  }

  private finish(chat: SideChat, turn: SideTurn, outlet: SideChatOutlet, fields: Pick<SideTurn, 'ask' | 'reply'>): void {
    Object.assign(turn, fields, { finishedAt: this.now().toISOString() });
    this.save(chat);
    const parts = this.parts({ ...turn, confirmation: undefined });
    outlet.chat([...parts.map(part => ({ type: 'chat/responsePart', turnId: turn.turnId, part })), { type: 'chat/turnComplete', turnId: turn.turnId, duration: duration(turn) }]);
    outlet.status(chat);
  }

  /**
   * Answers a question typed in the side chat. The record answers it for free when it can. Otherwise the person is asked
   * to confirm what a model call may spend, and nothing is asked until they do. Without an Ask service it says so.
   */
  async ask(user: User, chat: SideChat, turnId: string, text: string, team: string, page: string, outlet: SideChatOutlet): Promise<void> {
    const turn: SideTurn = { turnId, text, startedAt: this.now().toISOString() };
    chat.turns.push(turn);
    this.save(chat);
    outlet.status(chat);
    this.asking.add(turnId);
    try { await this.answer(user, chat, turn, team, page, outlet); } finally { this.asking.delete(turnId); }
  }

  private async answer(user: User, chat: SideChat, turn: SideTurn, team: string, page: string, outlet: SideChatOutlet): Promise<void> {
    const turnId = turn.turnId;
    if (!this.asks.service) return this.finish(chat, turn, outlet, { reply: sideChatText.notSetUp(page) });
    try {
      const answered = await this.asks.askAbout(user, chat.workItemId, turn.text, { recordOnly: true, ...selectionOf(chat) });
      return this.finish(chat, turn, outlet, { ask: this.entry(answered.ask.id, turn, answered.allowance) });
    } catch (error) {
      if ((error as { code?: unknown })?.code !== 'ask_needs_model') return this.finish(chat, turn, outlet, { reply: sideChatText.notAsked(reasonOf(error)) });
    }
    const allowance = (await this.asks.service.about(user, chat.workItemId).catch(() => undefined))?.allowance;
    if (!allowance) return this.finish(chat, turn, outlet, { reply: sideChatText.spendUnknown(chat.workItemId, page) });
    if (!allowance.asksEnabled) return this.finish(chat, turn, outlet, { reply: sideChatText.asksOff(team) });
    const requestId = `${turnId}-confirm`;
    turn.confirmation = { requestId, request: confirmationRequest(requestId, chat.workItemId, allowance), explanation: sideChatText.spend(chat.workItemId, team, allowance) };
    this.save(chat);
    outlet.chat([{ type: 'chat/responsePart', turnId, part: { kind: 'markdown', id: `${requestId}-explanation`, content: turn.confirmation.explanation } }, { type: 'chat/inputRequested', request: turn.confirmation.request }]);
    outlet.status(chat);
  }

  /** The open confirmation of a side chat that has this request id, if any. */
  waiting(chat: SideChat, requestId: string): boolean { return Boolean(chat.turns.some(turn => turn.confirmation?.requestId === requestId && !turn.confirmation.response && !turn.finishedAt)); }

  /** The person's answer to a spend confirmation: a model is asked only when they picked to ask; otherwise nothing is spent. */
  async confirm(user: User, chat: SideChat, requestId: string, response: unknown, answers: Json | undefined, page: string, outlet: SideChatOutlet): Promise<void> {
    const turn = chat.turns.find(entry => entry.confirmation?.requestId === requestId && !entry.confirmation.response && !entry.finishedAt);
    if (!turn?.confirmation) return;
    const agreed = confirmed(response, answers);
    Object.assign(turn.confirmation, { response: agreed ? 'accept' : 'cancel', ...(response === 'accept' && answers ? { answers } : {}) });
    this.save(chat);
    outlet.status(chat);
    if (!agreed) return this.finish(chat, turn, outlet, { reply: sideChatText.declined(page) });
    this.asking.add(turn.turnId);
    try {
      const answered = await this.asks.askAbout(user, chat.workItemId, turn.text, { model: true, ...selectionOf(chat) });
      this.finish(chat, turn, outlet, { ask: this.entry(answered.ask.id, turn, answered.allowance) });
    } catch (error) {
      this.finish(chat, turn, outlet, { reply: sideChatText.notAsked(reasonOf(error)) });
    } finally {
      this.asking.delete(turn.turnId);
    }
  }

  private entry(askId: string, turn: SideTurn, allowance: ChatAskEntry['allowance']): ChatAskEntry {
    return { askId, afterEvent: 0, placement: 'turn', turnId: turn.turnId, text: turn.text, at: this.now().toISOString(), allowance };
  }
}

const selectionOf = (chat: SideChat) => chat.origin.selection ? { selection: chat.origin.selection.text } : {};
const reasonOf = (error: unknown) => error instanceof Error && error.message ? error.message : 'the Ask service did not answer';
