import Anthropic, {
  APIConnectionError,
  APIError,
  AuthenticationError,
  PermissionDeniedError,
  RateLimitError,
} from '@anthropic-ai/sdk';
import { EDITING_PROMPT, EDIT_TOOL, SYSTEM_PROMPT, buildDocumentBlock } from './prompt';
import {
  MAX_EDITS,
  MAX_HISTORY_TURNS,
  type AskRequest,
  type AskResponse,
  type DocumentEdit,
} from './types';

/**
 * Talks to Claude.
 *
 * Lives in the background worker on purpose. A content script shares a DOM with
 * whatever page it is injected into, so an API key held there is one hostile
 * script away from being read. The background worker is a separate context the
 * page cannot reach — the content script sends a question over
 * `runtime.sendMessage` and never sees the key at all.
 */

const MODEL = 'claude-opus-5-5';
// Room for a multi-edit rewrite: every edit carries its `find` and its `replace`.
const MAX_TOKENS = 8_000;

let cached: { key: string; client: Anthropic } | undefined;

function clientFor(apiKey: string): Anthropic {
  if (cached?.key === apiKey) return cached.client;
  const client = new Anthropic({
    apiKey,
    // The worker is not a page, but it is not Node either, so the SDK's browser
    // guard trips. The key never enters a page context — see the note above.
    dangerouslyAllowBrowser: true,
  });
  cached = { key: apiKey, client };
  return client;
}

export async function ask(request: AskRequest, apiKey: string): Promise<AskResponse> {
  if (!apiKey) {
    return { ok: false, error: 'No API key set. Open the popup and paste one in.', needsKey: true };
  }

  const client = clientFor(apiKey);

  // Document first so it holds a stable prefix position across the turns of one
  // conversation; only the trailing question changes.
  const messages: Anthropic.MessageParam[] = [
    {
      role: 'user',
      content: buildDocumentBlock({
        document: request.document,
        findings: request.findings,
        ...(request.related ? { related: request.related } : {}),
      }),
    },
    { role: 'assistant', content: 'Got it. What would you like to know about it?' },
    ...request.history.slice(-MAX_HISTORY_TURNS).map(
      (turn): Anthropic.MessageParam => ({ role: turn.role, content: turn.text }),
    ),
    { role: 'user', content: request.question },
  ];

  try {
    // Streaming because the document can be long and thinking is on by default
    // on this model — a non-streaming call risks the HTTP timeout.
    const system: Anthropic.TextBlockParam[] = [
      { type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
    ];
    if (request.canEdit) system.push({ type: 'text', text: EDITING_PROMPT });

    const stream = client.messages.stream({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system,
      messages,
      ...(request.canEdit ? { tools: [EDIT_TOOL] } : {}),
    });

    const message = await stream.finalMessage();

    if (message.stop_reason === 'refusal') {
      return { ok: false, error: 'Claude declined that one.' };
    }

    const text = message.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('')
      .trim();

    const call = message.content.find(
      (block): block is Anthropic.ToolUseBlock =>
        block.type === 'tool_use' && block.name === EDIT_TOOL.name,
    );
    if (call) {
      const parsed = parseEditCall(call.input);
      if (parsed.edits.length > 0) {
        return { ok: true, text: parsed.summary || text || 'Done.', edits: parsed.edits };
      }
    }

    return text.length > 0
      ? { ok: true, text }
      : { ok: false, error: 'Claude had nothing to say about that.' };
  } catch (error: unknown) {
    return { ok: false, ...describe(error) };
  }
}

/**
 * The tool input is model output: validate it like any other untrusted input.
 * Malformed entries are dropped, not repaired, and an edit that changes nothing
 * is not an edit.
 */
export function parseEditCall(input: unknown): { edits: DocumentEdit[]; summary: string } {
  const record = (input ?? {}) as { edits?: unknown; summary?: unknown };
  const summary = typeof record.summary === 'string' ? record.summary.trim() : '';
  const raw = Array.isArray(record.edits) ? record.edits : [];
  const edits = raw
    .filter(
      (e): e is DocumentEdit =>
        e !== null &&
        typeof e === 'object' &&
        typeof (e as DocumentEdit).find === 'string' &&
        typeof (e as DocumentEdit).replace === 'string' &&
        (e as DocumentEdit).find.length > 0 &&
        (e as DocumentEdit).find !== (e as DocumentEdit).replace,
    )
    .slice(0, MAX_EDITS)
    .map((e) => ({ find: e.find, replace: e.replace }));
  return { edits, summary };
}

/**
 * Most specific first. Collapsing these into one broad catch loses the
 * distinction that matters to the user: a bad key needs them to open the popup,
 * a rate limit needs them to wait, and a network error needs neither.
 */
function describe(error: unknown): { error: string; needsKey?: boolean } {
  if (error instanceof AuthenticationError) {
    return { error: 'That API key was rejected. Check it in the popup.', needsKey: true };
  }
  if (error instanceof PermissionDeniedError) {
    return { error: 'That key lacks permission for the Messages API.', needsKey: true };
  }
  if (error instanceof RateLimitError) {
    return { error: 'Rate limited. Give it a moment.' };
  }
  if (error instanceof APIConnectionError) {
    return { error: 'Could not reach Claude. Check your connection.' };
  }
  if (error instanceof APIError) {
    return { error: `Claude returned ${String(error.status)}. ${error.message}` };
  }
  return { error: error instanceof Error ? error.message : 'Something went wrong.' };
}
