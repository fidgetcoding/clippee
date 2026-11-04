import { GoogleAuthError } from './auth';
import type { CorpusDoc } from './types';

/**
 * Google Drive, as a corpus.
 *
 * Two calls do the work: `files.list` to enumerate every Google Doc, and
 * `files.export` to pull each one as plain text. Export is the cheap path —
 * `text/plain` comes back as one string with no parsing, against the Docs API's
 * nested structural JSON.
 */

const DRIVE = 'https://www.googleapis.com/drive/v3';
const DOC_MIME = 'application/vnd.google-apps.document';
const FOLDER_MIME = 'application/vnd.google-apps.folder';

interface DriveFile {
  id: string;
  name: string;
  modifiedTime: string;
  parents?: string[];
}

interface ListResponse {
  files?: DriveFile[];
  nextPageToken?: string;
}

async function call<T>(path: string, token: string): Promise<T> {
  const response = await fetch(`${DRIVE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (response.status === 401) {
    throw new GoogleAuthError('Google access expired. Reconnect in the popup.');
  }
  if (response.status === 403) {
    throw new GoogleAuthError(
      'Google refused access. Check the Drive API is enabled on your Cloud project.',
      true,
    );
  }
  if (!response.ok) {
    throw new Error(`Drive returned ${String(response.status)}`);
  }

  return (await response.json()) as T;
}

/** Folder id → name, so a file's parents can be resolved into a readable path. */
async function folderNames(token: string): Promise<Map<string, DriveFile>> {
  const folders = new Map<string, DriveFile>();
  let pageToken: string | undefined;

  do {
    const query = new URLSearchParams({
      q: `mimeType='${FOLDER_MIME}' and trashed=false`,
      fields: 'nextPageToken,files(id,name,parents)',
      pageSize: '1000',
    });
    if (pageToken) query.set('pageToken', pageToken);

    const page = await call<ListResponse>(`/files?${query.toString()}`, token);
    for (const folder of page.files ?? []) folders.set(folder.id, folder);
    pageToken = page.nextPageToken;
  } while (pageToken);

  return folders;
}

/** Walk parents to the root. Guards against the cycles shortcuts can create. */
function resolvePath(file: DriveFile, folders: Map<string, DriveFile>): string[] {
  const path: string[] = [];
  const seen = new Set<string>();
  let parentId = file.parents?.[0];

  while (parentId && !seen.has(parentId)) {
    seen.add(parentId);
    const folder = folders.get(parentId);
    if (!folder) break;
    path.unshift(folder.name);
    parentId = folder.parents?.[0];
  }

  return path;
}

/** Every Google Doc the user owns or can read, without content. */
export async function listDocs(token: string, max = 500): Promise<CorpusDoc[]> {
  const folders = await folderNames(token);
  const docs: CorpusDoc[] = [];
  let pageToken: string | undefined;

  do {
    const query = new URLSearchParams({
      q: `mimeType='${DOC_MIME}' and trashed=false`,
      fields: 'nextPageToken,files(id,name,modifiedTime,parents)',
      orderBy: 'modifiedTime desc',
      pageSize: '100',
    });
    if (pageToken) query.set('pageToken', pageToken);

    const page = await call<ListResponse>(`/files?${query.toString()}`, token);
    for (const file of page.files ?? []) {
      docs.push({
        id: file.id,
        title: file.name,
        path: resolvePath(file, folders),
        modified: file.modifiedTime,
      });
      if (docs.length >= max) return docs;
    }
    pageToken = page.nextPageToken;
  } while (pageToken);

  return docs;
}

/** Fetch one document's plain text. */
export async function exportText(token: string, id: string): Promise<string> {
  const response = await fetch(`${DRIVE}/files/${id}/export?mimeType=text/plain`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (response.status === 401) {
    throw new GoogleAuthError('Google access expired. Reconnect in the popup.');
  }
  if (!response.ok) throw new Error(`Drive export returned ${String(response.status)}. Existing text was kept.`);

  // Exported docs carry a BOM that would otherwise lead every extracted text.
  return (await response.text()).replace(/^﻿/, '');
}
