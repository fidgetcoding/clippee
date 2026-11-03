import { MAX_DOCUMENT_CHARS } from './types';

/**
 * The agent's instructions.
 *
 * Two things this prompt is doing deliberately.
 *
 * It tells him not to repeat the deterministic checks. Harper and the local
 * rules already caught the passive voice; a model that also mentions it is
 * burning tokens to say something the user has already seen and produces the
 * false-positive fatigue that gets writing tools muted.
 *
 * And it constrains length hard. This renders in a speech balloon roughly 320px
 * wide. An assistant that answers a one-line question with five paragraphs is
 * unusable in that space regardless of how good the paragraphs are.
 */
export const SYSTEM_PROMPT = `You are Mr. Clippy, a writing assistant living in a small speech balloon beside the user's document.

You can see the whole document. Answer about *this* document, concretely — quote the actual sentence you mean rather than describing it in the abstract.

Length: two or three sentences by default. The balloon is narrow. Go longer only when asked for a rewrite or a list, and even then stay tight.

When asked to rewrite something and you cannot edit the document, return the rewritten text and nothing else — no preamble, no "here's a version that...". The user will paste it.

Never mention grammar, spelling, passive voice, adverbs, wordiness, or repetition unless the user raises it. Deterministic checks already cover those and the user has seen them.

Be direct. If a section is not working, say which one and why in a sentence. Skip praise that carries no information.

If the document is empty or you cannot see it, say so plainly rather than guessing.

You can also see passages from the user's OTHER documents, retrieved from their Drive. Use them:
- If they are repeating an argument they already made elsewhere, say which document and what they said.
- If this draft contradicts something they wrote before, that is the most valuable thing you can tell them. Lead with it.
- If a related document would help them, name it.
Cite by document title. Never invent a document — only refer to ones actually given to you.`;

/**
 * Added when the page can take edits. Without the edit tool he would answer
 * "make this tighter" with a rewrite the user has to paste by hand — which is
 * the 1997 product.
 */
export const EDITING_PROMPT = `You can edit this document with the edit_document tool.

Use it whenever the user asks you to change the document: fix, rewrite, tighten, cut, add, rename, reword, reorder, "make it", "change", "replace", "do it". Do not paste a rewrite into the chat and ask them to copy it. Make the edit.

Do not edit when they only ask a question, ask for feedback, or ask what you think. Answer instead. If they then say "do it", edit.

How to write edits:
- "find" must be copied character for character from the document, and must appear exactly once. If the phrase repeats, include enough surrounding words to make it unique.
- Keep "find" as small as the change allows. Rewriting a sentence: find that sentence, not the paragraph.
- To add text, find the sentence it goes after and replace it with that sentence plus the new text.
- To delete, replace with an empty string.
- Plain text only. No markdown, no asterisks, no bullet characters. A new paragraph is a single newline.
- Several separate changes are several edits in one call, in document order.

After the tool call, the summary is what the user reads in the balloon: one short sentence saying what you changed.`;

export const EDIT_TOOL = {
  name: 'edit_document',
  description:
    'Make changes to the document the user is writing. Each edit swaps one exact passage for new text. Edits apply in order.',
  input_schema: {
    type: 'object' as const,
    properties: {
      edits: {
        type: 'array',
        description: 'The changes, in document order.',
        items: {
          type: 'object',
          properties: {
            find: {
              type: 'string',
              description: 'Exact text from the document, appearing once. Copied verbatim.',
            },
            replace: {
              type: 'string',
              description: 'What replaces it. Empty string deletes it.',
            },
          },
          required: ['find', 'replace'],
        },
      },
      summary: {
        type: 'string',
        description: 'One short sentence for the user saying what you changed.',
      },
    },
    required: ['edits', 'summary'],
  },
};

export interface RelatedPassage {
  readonly title: string;
  readonly path: readonly string[];
  readonly text: string;
  readonly reasons: readonly string[];
}

export interface PromptContext {
  readonly document: string;
  readonly findings: readonly string[];
  readonly related?: readonly RelatedPassage[];
}

/**
 * The document is sent as its own leading user block so it sits in a stable
 * prefix position — the same document across turns of one conversation caches,
 * and only the question at the end varies.
 */
export function buildDocumentBlock({ document, findings, related }: PromptContext): string {
  const truncated =
    document.length > MAX_DOCUMENT_CHARS
      ? `${document.slice(0, MAX_DOCUMENT_CHARS)}\n\n[document truncated at ${MAX_DOCUMENT_CHARS.toLocaleString()} characters]`
      : document;

  const alreadyFlagged =
    findings.length > 0
      ? `\n\nAlready flagged by the local checks — do not repeat these:\n${findings
          .map((f) => `- ${f}`)
          .join('\n')}`
      : '';

  // Corpus passages go AFTER the document: the model should read what the user
  // is writing first, then what they wrote before, not the other way round.
  const corpus =
    related && related.length > 0
      ? `\n\nPassages from the user's other documents, retrieved because they may bear on this one:\n\n${related
          .map(
            (p) =>
              `<related title="${p.title}" folder="${p.path.join('/') || 'My Drive'}" why="${p.reasons.join(', ')}">\n${p.text}\n</related>`,
          )
          .join('\n\n')}`
      : '';

  return `Here is the document the user is working on.\n\n<document>\n${truncated}\n</document>${alreadyFlagged}${corpus}`;
}
