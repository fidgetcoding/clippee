import type { PanelState } from '../agent/panelTools';
import type { AskResponse, AuditResponse, ChatTurn } from '../agent/types';
import { review } from '../checks';
import { ext } from '../platform';
import type { AgentReply } from './chatTypes';
import { openSettings } from './settingsLink';

/** Send a question to the background worker, which owns the API key. */
export async function askWorker(
  question: string,
  history: readonly ChatTurn[],
  document_: string,
  canEdit: boolean,
  panel?: PanelState,
): Promise<AgentReply> {
  const findings = review(document_).map((f) => f.text);

  const response = (await ext.runtime.sendMessage({
    type: 'mrclippy:ask',
    question,
    document: document_,
    history,
    findings,
    canEdit,
    ...(panel ? { panel } : {}),
  })) as AskResponse | undefined;

  if (!response) throw new Error('No reply from the background worker. Try reloading the tab.');
  if (!response.ok) {
    if (response.needsKey) openSettings(false);
    throw new Error(response.error);
  }
  // Proposals only. Nothing touches the document until the user applies one.
  // Actions run through the panel's own buttons, which have Undo.
  return {
    text: response.text,
    ...(response.edits && response.edits.length > 0 ? { proposals: response.edits } : {}),
    ...(response.actions && response.actions.length > 0 ? { actions: response.actions } : {}),
  };
}

/** The structure ladder in the worker, rendered as one readable answer. */
export async function auditWorker(text: string): Promise<string> {
  const response = (await ext.runtime.sendMessage({
    type: 'mrclippy:audit',
    document: text,
  })) as AuditResponse | undefined;

  if (!response) throw new Error('No reply from the background worker. Try reloading the tab.');
  if (!response.ok) {
    if (response.needsKey) openSettings(false);
    throw new Error(response.error);
  }

  if (response.findings.length === 0) {
    return 'Structurally it holds up. Nothing promised that you did not deliver.';
  }

  return response.findings
    .map((f) => (f.evidence ? `${f.problem}\n\n  "${f.evidence}"` : f.problem))
    .join('\n\n');
}
