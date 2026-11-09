// Bulk runner pack reader (F285, C1): a read-only Google Drive client for the owner's service account
// (docs/specs/2026-11-10-pack-reader.md). The key file is read only to sign one token request; the token lives in
// memory. `fetch`, the clock and sleep are injected, so tests use a fake and a key pair generated in the test.
// Errors carry a status and a code, never a response body, the key or the token.

export interface ServiceAccountKey {
  client_email: string;
  private_key: string;
}

export interface DriveItem {
  id: string;
  name: string;
  mimeType: string;
  size?: number;
  sha256Checksum?: string;
}

export interface DriveClient {
  /** A folder by path, starting among the items shared with the account (`National/v1.1`). */
  folderByPath(path: string): Promise<DriveItem>;
  /** The folder's children, with size and Drive's sha256 for files. */
  children(folderId: string): Promise<DriveItem[]>;
  /** Exactly bytes `start` to `endInclusive` of the file, or an error. */
  readRange(id: string, start: number, endInclusive: number): Promise<Uint8Array>;
}

export interface DriveDeps {
  fetch: typeof fetch;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
}

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/drive.readonly';
const API = 'https://www.googleapis.com/drive/v3/files';
const FOLDER = 'application/vnd.google-apps.folder';
const RETRIES = 3;
const BACKOFF_MS = 500;
/** A token is renewed this long before Google says it ends. */
const TOKEN_MARGIN_MS = 60_000;

/** Checks a key file has what signing needs. The message never repeats the file's content. */
export function parseKey(text: string): ServiceAccountKey {
  let k: Partial<ServiceAccountKey>;
  try {
    k = JSON.parse(text);
  } catch {
    throw new Error('the key file is not JSON');
  }
  if (!k || typeof k.client_email !== 'string' || !k.client_email) throw new Error('the key file has no client_email');
  if (typeof k.private_key !== 'string' || !k.private_key.includes('PRIVATE KEY')) {
    throw new Error('the key file has no private_key');
  }
  return { client_email: k.client_email, private_key: k.private_key };
}

const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
const jsonB64 = (o: unknown) => b64url(new TextEncoder().encode(JSON.stringify(o)));

async function importKey(pem: string): Promise<CryptoKey> {
  const body = pem.replace(/-----(BEGIN|END) PRIVATE KEY-----/g, '').replace(/\s+/g, '');
  let der: Uint8Array;
  try {
    der = Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
  } catch {
    throw new Error('the private_key is not PEM');
  }
  try {
    return await crypto.subtle.importKey(
      'pkcs8',
      der as BufferSource,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['sign'],
    );
  } catch {
    throw new Error('the private_key is not a PKCS#8 RSA key');
  }
}

/** The signed RS256 assertion the token endpoint exchanges for an access token. */
export async function signJwt(key: ServiceAccountKey, nowSec: number): Promise<string> {
  const unsigned = `${jsonB64({ alg: 'RS256', typ: 'JWT' })}.${
    jsonB64({ iss: key.client_email, scope: SCOPE, aud: TOKEN_URL, iat: nowSec, exp: nowSec + 3000 })
  }`;
  const sig = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    await importKey(key.private_key),
    new TextEncoder().encode(unsigned),
  );
  return `${unsigned}.${b64url(new Uint8Array(sig))}`;
}

/** A Drive query literal: single quotes and backslashes escaped. */
const lit = (s: string) => `'${s.replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`;

/** A transfer failure `consume` found, worth another try. */
class Retry extends Error {}

export function createDriveClient(key: ServiceAccountKey, deps: DriveDeps): DriveClient {
  let token: { value: string; until: number } | null = null;

  async function accessToken(): Promise<string> {
    if (token && deps.now() < token.until) return token.value;
    const assertion = await signJwt(key, Math.floor(deps.now() / 1000));
    const res = await deps.fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }).toString(),
    });
    if (!res.ok) {
      let code = '';
      try {
        const e = (await res.json()).error;
        if (typeof e === 'string' && /^[a-z_]{1,40}$/.test(e)) code = ` (${e})`;
      } catch { /* no code to report */ }
      throw new Error(`token request failed: HTTP ${res.status}${code}`);
    }
    const j = await res.json();
    if (typeof j.access_token !== 'string' || !Number.isFinite(j.expires_in)) {
      throw new Error('token response has no token');
    }
    token = { value: j.access_token, until: deps.now() + j.expires_in * 1000 - TOKEN_MARGIN_MS };
    return j.access_token;
  }

  /**
   * One authorised GET whose body is read by `consume`, retried up to RETRIES times with growing waits. Only a failure
   * of the transfer is retried: a bad status, a fetch or body-read TypeError, or a `Retry` from `consume` (a short body).
   * Anything else, such as a key that cannot sign, is thrown at once with its own message.
   */
  async function get<T>(
    url: string,
    headers: Record<string, string>,
    ok: number,
    consume: (res: Response) => Promise<T>,
  ): Promise<T> {
    let last = 'unknown';
    for (let attempt = 0; attempt <= RETRIES; attempt++) {
      if (attempt > 0) await deps.sleep(BACKOFF_MS * 2 ** (attempt - 1));
      try {
        const res = await deps.fetch(url, { headers: { ...headers, authorization: `Bearer ${await accessToken()}` } });
        if (res.status === ok) return await consume(res);
        if (res.status === 401) token = null;
        await res.body?.cancel();
        last = `HTTP ${res.status}`;
      } catch (e) {
        if (e instanceof Retry) last = e.message;
        else if (e instanceof TypeError) last = 'network error';
        else throw e;
      }
    }
    throw new Error(`Drive request failed after ${RETRIES + 1} attempts: ${last}`);
  }

  const children = (folderId: string): Promise<DriveItem[]> => list(`${lit(folderId)} in parents and trashed = false`);

  async function list(q: string): Promise<DriveItem[]> {
    const out: DriveItem[] = [];
    let page = '';
    do {
      const u = new URL(API);
      u.searchParams.set('q', q);
      u.searchParams.set('fields', 'nextPageToken,files(id,name,mimeType,size,sha256Checksum)');
      u.searchParams.set('pageSize', '1000');
      u.searchParams.set('supportsAllDrives', 'true');
      u.searchParams.set('includeItemsFromAllDrives', 'true');
      if (page) u.searchParams.set('pageToken', page);
      const j = await get(u.toString(), {}, 200, (r) => r.json());
      for (const f of j.files ?? []) {
        out.push({
          id: f.id,
          name: f.name,
          mimeType: f.mimeType,
          size: f.size === undefined ? undefined : Number(f.size),
          sha256Checksum: f.sha256Checksum,
        });
      }
      page = j.nextPageToken ?? '';
    } while (page);
    return out;
  }

  return {
    children,
    async folderByPath(path) {
      const parts = path.split('/');
      let at: DriveItem | null = null;
      for (const name of parts) {
        const q: string = at === null
          ? `sharedWithMe = true and trashed = false and name = ${lit(name)}`
          : `${lit(at.id)} in parents and trashed = false and name = ${lit(name)}`;
        const found = await list(q);
        if (found.length === 0) throw new Error(`not found: ${name} (in ${path})`);
        if (found.length > 1) throw new Error(`more than one item named ${name} (in ${path})`);
        if (found[0].mimeType !== FOLDER) throw new Error(`${name} is not a folder (in ${path})`);
        at = found[0];
      }
      return at!;
    },
    async readRange(id, start, endInclusive) {
      const u = `${API}/${encodeURIComponent(id)}?alt=media&supportsAllDrives=true`;
      const want = endInclusive - start + 1;
      return await get(u, { range: `bytes=${start}-${endInclusive}` }, 206, async (res) => {
        const body = new Uint8Array(await res.arrayBuffer());
        if (body.length !== want) throw new Retry(`range answered short: wanted ${want} bytes, got ${body.length}`);
        return body;
      });
    },
  };
}
