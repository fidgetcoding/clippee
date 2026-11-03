import { NO_KEY, ask, clientFor, describe } from '../agent/client';
import { auditStructure } from '../agent/structure';
import { structureSignals } from '../checks/structure';
import type { AskRequest, AskResponse, AuditRequest, AuditResponse } from '../agent/types';
import { ext } from '../platform';
import { loadSettings } from '../settings';

/**
 * Service worker.
 *
 * Chromium kills this after ~30s idle, so it holds no state — it relays the
 * keyboard command and owns the one thing that must never reach a content
 * script: the API key.
 */

ext.commands?.onCommand.addListener((command) => {
  if (command !== 'toggle-mr-clippy') return;
  void relayToActiveTab({ type: 'mrclippy:toggle' });
});

ext.runtime.onMessage.addListener(
  (message: unknown, sender, sendResponse: (response: AskResponse | AuditResponse) => void) => {
    if (isAskRequest(message)) {
      void (async () => {
        const settings = await loadSettings();
        sendResponse(await ask(message, settings.apiKey, settings.workspaceId));
      })();
      // Keeps the message channel open for the async reply. Returning anything
      // falsy here closes it and the content script's promise resolves undefined.
      return true;
    }

    if (isType(message, 'mrclippy:open-settings')) {
      void openSettings(sender.tab?.url);
      return false;
    }

    if (isType(message, 'mrclippy:has-key')) {
      void loadSettings().then((s) => sendResponse({ hasKey: s.apiKey.length > 0 } as never));
      return true;
    }

    if (isAuditRequest(message)) {
      void (async () => sendResponse(await runAudit(message)))();
      return true;
    }

    return false;
  },
);

/**
 * The structure ladder, end to end.
 *
 * Local signals are free and decide whether any cloud call happens at all. A
 * document with nothing structurally interesting costs nothing to audit.
 */
async function runAudit(request: AuditRequest): Promise<AuditResponse> {
  const settings = await loadSettings();
  if (!settings.apiKey) {
    return { ok: false, error: NO_KEY, needsKey: true };
  }

  const signals = structureSignals(request.document);
  if (signals.length === 0) return { ok: true, findings: [] };

  try {
    const client = clientFor(settings.apiKey, settings.workspaceId);
    const findings = await auditStructure(client, request.document, signals);
    return {
      ok: true,
      findings: findings.map((f) => ({
        about: f.about,
        problem: f.problem ?? '',
        ...(f.evidence ? { evidence: f.evidence } : {}),
        confidence: f.confidence,
      })),
    };
  } catch (error: unknown) {
    return { ok: false, ...describe(error) };
  }
}

/**
 * Settings is the popup page. The toolbar popup is the natural place for it, but
 * `action.openPopup` is not available everywhere, so fall back to the same page
 * in a small window of its own. Either way the key is typed into an extension
 * page, never into the document's DOM.
 */
async function openSettings(fromUrl?: string): Promise<void> {
  try {
    await ext.action.openPopup();
    return;
  } catch {
    // Fall through to a window.
  }
  let host = '';
  try {
    host = fromUrl ? new URL(fromUrl).hostname : '';
  } catch {
    host = '';
  }
  const url = ext.runtime.getURL(`src/popup/index.html?host=${encodeURIComponent(host)}`);
  await ext.windows.create({ url, type: 'popup', width: 380, height: 640, focused: true });
}

function isType(value: unknown, type: string): boolean {
  return value !== null && typeof value === 'object' && (value as { type?: unknown }).type === type;
}

function isAuditRequest(value: unknown): value is AuditRequest {
  return (
    value !== null &&
    typeof value === 'object' &&
    (value as AuditRequest).type === 'mrclippy:audit' &&
    typeof (value as AuditRequest).document === 'string'
  );
}

function isAskRequest(value: unknown): value is AskRequest {
  return (
    value !== null &&
    typeof value === 'object' &&
    (value as AskRequest).type === 'mrclippy:ask' &&
    typeof (value as AskRequest).question === 'string'
  );
}

async function relayToActiveTab(message: { type: string }): Promise<void> {
  const [tab] = await ext.tabs.query({ active: true, currentWindow: true });
  if (tab?.id === undefined) return;
  try {
    await ext.tabs.sendMessage(tab.id, message);
  } catch {
    // No content script on this tab — chrome:// pages, the web store, PDFs.
    // Expected, not an error.
  }
}
