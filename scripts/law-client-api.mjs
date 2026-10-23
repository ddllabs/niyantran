/** Shared transport for the platform-admin Law tools. Never accepts a service-role credential. */
export function lawAdminApi({ target, token, publishableKey }, request = fetch) {
 const u = new URL(target);
 const local = ['localhost','127.0.0.1','[::1]'].includes(u.hostname);
 if (u.username || u.password || u.search || u.hash || u.pathname !== '/' ||
     !((local && u.protocol === 'http:') || (u.protocol === 'https:' && /^[a-z0-9-]+\.supabase\.co$/.test(u.hostname)))) throw Error('target must be a bare Supabase project URL');
 if (!token || !publishableKey || token.startsWith('sb_secret_')) throw Error('authenticated admin session required');
 if (publishableKey.startsWith('sb_secret_')) throw Error('publishable key required');
 if (publishableKey.split('.').length === 3) {
  let role;
  try { role = JSON.parse(Buffer.from(publishableKey.split('.')[1],'base64url')).role; } catch { throw Error('invalid publishable key'); }
  if (role !== 'anon') throw Error('publishable key required');
 }
 if (token.split('.').length === 3) {
  let role;
  try { role = JSON.parse(Buffer.from(token.split('.')[1],'base64url')).role; } catch { throw Error('invalid admin session'); }
  if (role !== 'authenticated') throw Error('authenticated admin session required');
 }
 return async body => {
  const response = await request(u.origin+'/functions/v1/admin-ingest?input=supplied-text',{
   method:'POST',redirect:'error',signal:AbortSignal.timeout(30_000),
   headers:{'content-type':'application/json',authorization:`Bearer ${token}`,apikey:publishableKey},body:JSON.stringify(body),
  });
  if (!response.ok) throw Error(`Law request HTTP ${response.status}`);
  const data=await response.json();
  if (data.ok !== true || data.contract_version !== 1) throw Error('unconfirmed Law contract response');
  return data;
 };
}
