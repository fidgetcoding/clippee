import Anthropic, {
  APIConnectionError,
  APIError,
  AuthenticationError,
  PermissionDeniedError,
  RateLimitError,
} from '@anthropic-ai/sdk';
import { SYSTEM_PROMPT, buildDocumentBlock } from './prompt';
import { MAX_HISTORY_TURNS, type AskRequest, type AskResponse } from './types';

/**
 * Talks to Claude.
 *
 * Lives in the background worker on purpose. A content script shares a DOM with
 * whatever page it is injected into, so an API key held there is one hostile
 * script away from being read. The background worker is a separate context the
 * page cannot reach — the content script sends a question over
 * `runtime.sendMessage` and never sees the key at all.
 */

const MODEL = 'claude-opus-5';
const MAX_TOKENS = 4_000;

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
    const stream = client.messages.stream({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      messages,
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

    return text.length > 0
      ? { ok: true, text }
      : { ok: false, error: 'Claude had nothing to say about that.' };
  } catch (error: unknown) {
    return { ok: false, ...describe(error) };
  }
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
