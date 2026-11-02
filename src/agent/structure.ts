import Anthropic from '@anthropic-ai/sdk';
import type { StructureSignal } from '../checks/structure';

/**
 * The judgement half of the structure check.
 *
 * The local pass finds candidates for free and never claims anything; this
 * decides. That split is the whole ladder — a cloud call only happens when a
 * cheap signal earned it, which is what keeps the bill near $3-5/month.
 *
 * The prompt is written to make refusal easy. The failure mode here is not
 * missing a broken promise, it is inventing one: a reader told "check whether
 * this delivered" will find something to say if you let it. `delivered: true`
 * with no finding has to be the comfortable answer.
 */

const MODEL = 'claude-opus-5';

export interface StructureFinding {
  /** The promise or imbalance being judged. */
  readonly about: string;
  /** True when nothing is wrong — the common case. */
  readonly ok: boolean;
  /** One sentence, only when `ok` is false. */
  readonly problem?: string;
  /** Quoted from the document, so the user can check him. */
  readonly evidence?: string;
  readonly confidence: 'high' | 'medium' | 'low';
}

const SYSTEM = `You audit document structure. You are given a document and one specific signal a cheap local pass flagged as worth checking.

Your job is to decide whether there is genuinely a problem. Most of the time there is not, and saying so is the correct answer — a writer who is interrupted for a promise they did keep stops listening.

Judge only the signal you were given. Do not review the writing, the grammar, the style, or anything else you notice.

A promise is kept if the document substantively addresses it, even if the wording differs and even if it is addressed out of order. A count is met if that many distinct things are covered; the writer is not obliged to number them.

An imbalance is a problem only if the long section is about something minor, or the short one about something load-bearing. Length alone is not a fault.

Quote the document when you claim something is missing. If you cannot quote evidence, you do not have a finding.`;

const SCHEMA = {
  type: 'object' as const,
  properties: {
    ok: { type: 'boolean' as const, description: 'True when nothing is wrong.' },
    problem: { type: 'string' as const, description: 'One sentence. Only when ok is false.' },
    evidence: { type: 'string' as const, description: 'Quoted from the document.' },
    confidence: { type: 'string' as const, enum: ['high', 'medium', 'low'] },
  },
  required: ['ok', 'confidence'],
  additionalProperties: false,
};

export async function judge(
  client: Anthropic,
  document: string,
  signal: StructureSignal,
): Promise<StructureFinding> {
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 1_000,
    system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
    output_config: { format: { type: 'json_schema', schema: SCHEMA } },
    messages: [
      {
        role: 'user',
        content:
          `<document>\n${document}\n</document>\n\n` +
          `Signal flagged locally: ${signal.detail}\n\n` +
          `Relevant excerpts:\n${signal.evidence.map((e) => `- ${e}`).join('\n')}\n\n` +
          `Is this genuinely a problem?`,
      },
    ],
  });

  const text = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('');

  try {
    const parsed = JSON.parse(text) as Omit<StructureFinding, 'about'>;
    return { about: signal.detail, ...parsed };
  } catch {
    // A malformed judgement is a non-finding, never a guess.
    return { about: signal.detail, ok: true, confidence: 'low' };
  }
}

/**
 * Run the whole ladder. Returns only real problems, most-confident first.
 *
 * Capped at three calls per pass: the local layer can raise a dozen candidates
 * on a messy document, and judging all of them would blow the budget on a
 * document the writer has not finished yet.
 */
export async function auditStructure(
  client: Anthropic,
  document: string,
  signals: readonly StructureSignal[],
  maxCalls = 3,
): Promise<StructureFinding[]> {
  const findings: StructureFinding[] = [];

  for (const signal of signals.slice(0, maxCalls)) {
    try {
      const finding = await judge(client, document, signal);
      if (!finding.ok && finding.problem) findings.push(finding);
    } catch {
      // One failed judgement must not sink the pass.
    }
  }

  const order = { high: 0, medium: 1, low: 2 } as const;
  return findings.sort((a, b) => order[a.confidence] - order[b.confidence]);
}
