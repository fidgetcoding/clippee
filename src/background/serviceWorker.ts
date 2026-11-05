import { NO_KEY, ask, clientFor, describe } from '../agent/client';
import { auditStructure } from '../agent/structure';
import { structureSignals } from '../checks/structure';
import type { AskRequest, AskResponse, AuditRequest, AuditResponse } from '../agent/types';
import { ext } from '../platform';
import { loadSettings } from '../settings';
import { parseSettingsMutation, type SettingsResponse } from '../settingsProtocol';
import { mutatePreferences } from './settingsStore';

/**
 * Service worker.
 *
 * Chromium kills this after ~30s idle, so durable state stays in storage.
 * It serializes pending settings mutations, relays the keyboard command,
 * and owns the one thing that must never reach a content
 * script: the API key.
 */

ext.commands?.onCommand.addListener((command) => {
  if (command !== 'toggle-mr-clippy') return;
  void relayToActiveTab({ type: 'mrclippy:toggle' });
});

ext.runtime.onMessage.addListener(
  (message: unknown, sender, sendResponse: (response: AskResponse | AuditResponse | SettingsResponse | { hasKey: boolean }) => void) => {
    if (isType(message, 'mrclippy:settings')) {
      const mutation = parseSettingsMutation((message as { mutation?: unknown }).mutation);
      if (!mutation) {
        sendResponse({ ok: false, error: 'Invalid settings mutation.' });
        return false;
      }
      void mutatePreferences(mutation).then(
        (preferences) => sendResponse({ ok: true, preferences }),
        () => sendResponse({ ok: false, error: 'Could not save settings. Try again.' }),
      );
      return true;
    }
    if (isType(message, 'mrclippy:open-settings')) {
      void openSettings(sender.tab?.url).catch(() => undefined);
      return false;
    }
    if (!isType(message, 'mrclippy:ask') && !isType(message, 'mrclippy:audit') &&
        !isType(message, 'mrclippy:has-key')) return false;

    // Every recognized request receives one reply, including storage failures
    // and malformed messages. No detached async rejection may strand the panel.
    void (async () => {
      try {
        if (isType(message, 'mrclippy:has-key')) {
          const settings = await loadSettings();
          sendResponse({ hasKey: settings.apiKey.length > 0 });
        } else if (isAskRequest(message)) {
          const settings = await loadSettings();
          sendResponse(await ask(message, settings.apiKey, settings.workspaceId));
        } else if (isAuditRequest(message)) {
          sendResponse(await runAudit(message));
        } else {
          sendResponse({ ok: false, error: 'Invalid request. Reload the tab and try again.' });
        }
      } catch (error: unknown) {
        sendResponse({ ok: false, ...describe(error) });
      }
    })();
    return true;
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
let opening: Promise<void> | undefined;

/**
 * One Settings at a time. Five fixes failing for want of a key used to ask
 * five times at once: one toolbar popup and four stacked windows.
 */
function openSettings(fromUrl?: string): Promise<void> {
  opening ??= openSettingsOnce(fromUrl).finally(() => {
    opening = undefined;
  });
  return opening;
}

async function openSettingsOnce(fromUrl?: string): Promise<void> {
  // The toolbar popup first: it is the fast path, and Chrome never stacks it.
  try {
    await ext.action.openPopup();
    return;
  } catch {
    // Fall through to a window.
  }
  if (await focusOpenSettings()) return;
  let host = '';
  try {
    host = fromUrl ? new URL(fromUrl).hostname : '';
  } catch {
    host = '';
  }
  const url = ext.runtime.getURL(`src/popup/index.html?host=${encodeURIComponent(host)}`);
  await ext.windows.create({ url, type: 'popup', width: 380, height: 640, focused: true });
}

/** Bring an already open Settings window forward. True when there was one. */
async function focusOpenSettings(): Promise<boolean> {
  try {
    const page = ext.runtime.getURL('src/popup/index.html');
    const windows = await ext.windows.getAll({ populate: true, windowTypes: ['popup'] });
    const open = windows.find((w) => w.tabs?.some((t) => t.url?.startsWith(page)));
    if (open?.id === undefined) return false;
    await ext.windows.update(open.id, { focused: true });
    return true;
  } catch {
    return false;
  }
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
  if (!isType(value, 'mrclippy:ask')) return false;
  const v = value as Record<string, unknown>;
  const strings = (a: unknown): a is string[] => Array.isArray(a) && a.every((s) => typeof s === 'string');
  return typeof v.question === 'string' && typeof v.document === 'string' &&
    strings(v.findings) && Array.isArray(v.history) && v.history.every((turn: unknown) => {
      if (!turn || typeof turn !== 'object') return false;
      const t = turn as Record<string, unknown>;
      return (t.role === 'user' || t.role === 'assistant') && typeof t.text === 'string';
    }) && (v.canEdit === undefined || typeof v.canEdit === 'boolean') &&
    (v.related === undefined || (Array.isArray(v.related) && v.related.every((passage: unknown) => {
      if (!passage || typeof passage !== 'object') return false;
      const p = passage as Record<string, unknown>;
      return typeof p.title === 'string' && typeof p.text === 'string' && strings(p.path) && strings(p.reasons);
    })));
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
