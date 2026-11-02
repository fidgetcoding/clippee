import { ext } from '../platform';

/**
 * Google OAuth for an unpacked extension.
 *
 * `chrome.identity.getAuthToken` is the easy path and is unavailable here — it
 * requires the extension to be published with a fixed id. `launchWebAuthFlow`
 * works for a locally-loaded build, which is what a personal tool is.
 *
 * The scope is `drive.readonly`, which Google classifies as **restricted**. For
 * a published app that means a CASA security assessment; for an unverified
 * personal app it means a one-time "unverified app" interstitial and a 100-user
 * cap, neither of which matters for one person. The narrower `drive.file` scope
 * would avoid that entirely but only grants access to files the user hands over
 * one at a time through a picker — which cannot build a corpus.
 */

const SCOPES = [
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/documents.readonly',
];

const TOKEN_KEY = 'mrclippy:googleToken';

interface StoredToken {
  readonly accessToken: string;
  /** Epoch ms. */
  readonly expiresAt: number;
}

/** Refresh a minute early rather than discovering expiry mid-request. */
const EXPIRY_MARGIN_MS = 60_000;

export class GoogleAuthError extends Error {
  constructor(
    message: string,
    readonly needsSetup = false,
  ) {
    super(message);
    this.name = 'GoogleAuthError';
  }
}

export async function getStoredToken(): Promise<string | undefined> {
  const stored = await ext.storage.local.get(TOKEN_KEY);
  const token = stored[TOKEN_KEY] as StoredToken | undefined;
  if (!token) return undefined;
  if (token.expiresAt - EXPIRY_MARGIN_MS < Date.now()) return undefined;
  return token.accessToken;
}

export async function clearToken(): Promise<void> {
  await ext.storage.local.remove(TOKEN_KEY);
}

/**
 * Run the consent flow. Must be triggered by a user gesture — Chrome refuses to
 * open the interactive window otherwise.
 *
 * Implicit flow (`response_type=token`) rather than an auth-code exchange: an
 * extension cannot hold a client secret, so there is no confidential client to
 * exchange a code with. The cost is no refresh token, meaning the user re-
 * consents roughly hourly. For a personal tool that is the right trade; the
 * alternative is standing up a server to hold the secret.
 */
export async function authorize(clientId: string): Promise<string> {
  if (!clientId) {
    throw new GoogleAuthError('No Google client ID set. Add one in the popup.', true);
  }

  const redirectUri = ext.identity.getRedirectURL();
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('response_type', 'token');
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('scope', SCOPES.join(' '));
  // Without this the user is silently re-issued a token for whatever they
  // approved last time, which hides scope changes until a request 403s.
  url.searchParams.set('prompt', 'consent');

  let responseUrl: string | undefined;
  try {
    responseUrl = await ext.identity.launchWebAuthFlow({
      url: url.toString(),
      interactive: true,
    });
  } catch (error: unknown) {
    throw new GoogleAuthError(
      error instanceof Error ? error.message : 'Google sign-in was cancelled.',
    );
  }

  if (!responseUrl) throw new GoogleAuthError('Google sign-in was cancelled.');

  // The implicit flow returns the token in the URL fragment, not the query.
  const fragment = new URLSearchParams(responseUrl.split('#')[1] ?? '');
  const accessToken = fragment.get('access_token');
  const expiresIn = Number.parseInt(fragment.get('expires_in') ?? '3600', 10);

  if (!accessToken) {
    const reason = fragment.get('error') ?? 'no token returned';
    throw new GoogleAuthError(`Google sign-in failed: ${reason}`);
  }

  const token: StoredToken = {
    accessToken,
    expiresAt: Date.now() + expiresIn * 1_000,
  };
  await ext.storage.local.set({ [TOKEN_KEY]: token });

  return accessToken;
}

/** The redirect URI to paste into the Google Cloud console. */
export function redirectUri(): string {
  return ext.identity.getRedirectURL();
}
