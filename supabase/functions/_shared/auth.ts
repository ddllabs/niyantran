// requireUser: the caller must present a Supabase JWT that the auth server
// still accepts. Cheap structural checks run before any network call so a
// missing or malformed header never costs a round trip.

import { HttpError } from './http.ts';
import { userClient } from './supabase.ts';

export type Verify = (token: string) => Promise<{ id: string } | null>;

export interface Caller {
  userId: string;
  token: string;
}

async function defaultVerify(token: string): Promise<{ id: string } | null> {
  const { data, error } = await userClient(token).auth.getUser(token);
  if (error || !data.user) return null;
  return { id: data.user.id };
}

export async function requireUser(req: Request, verify: Verify = defaultVerify): Promise<Caller> {
  const header = req.headers.get('authorization') ?? '';
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match) throw new HttpError(401, 'missing bearer token');
  const token = match[1].trim();
  if (token.split('.').length !== 3) throw new HttpError(401, 'malformed token');
  const user = await verify(token);
  if (!user) throw new HttpError(401, 'invalid or expired token');
  return { userId: user.id, token };
}
