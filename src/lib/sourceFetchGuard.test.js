// Fetching a caller-supplied URL (source extract, chat attachments) must only
// ever reach public internet addresses: no loopback, private, link-local or
// metadata ranges, including via DNS or a redirect.
import { describe, expect, it, vi } from 'vitest';
import { extractSource, isPublicAddress } from '../../server/sourceExtract.mjs';

const PUBLIC_IP = '93.184.216.34';

function deps({ dnsMap = {}, responses = {} } = {}) {
  const fetched = [];
  return {
    fetched,
    lookup: vi.fn(async (host) => (dnsMap[host] || [PUBLIC_IP]).map((address) => ({ address, family: address.includes(':') ? 6 : 4 }))),
    fetch: vi.fn(async (url, init) => {
      fetched.push({ url, redirect: init.redirect });
      const r = responses[url] || { status: 200, body: 'Plain public text body for the record, long enough.', type: 'text/plain' };
      const headers = new Headers({ 'content-type': r.type || 'text/plain', ...(r.location ? { location: r.location } : {}), ...(r.length ? { 'content-length': String(r.length) } : {}) });
      return { ok: r.status >= 200 && r.status < 300, status: r.status, url, headers, arrayBuffer: async () => new TextEncoder().encode(r.body || '').buffer };
    }),
  };
}

describe('isPublicAddress', () => {
  it.each([
    '127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1',
    '0.0.0.0', '224.0.0.1', '255.255.255.255', '::1', '::', 'fe80::1', 'fd00::1', '::ffff:127.0.0.1', '::ffff:10.0.0.1',
  ])('refuses %s', (ip) => expect(isPublicAddress(ip)).toBe(false));

  it.each([PUBLIC_IP, '8.8.8.8', '172.32.0.1', '2606:4700:4700::1111'])('allows %s', (ip) => expect(isPublicAddress(ip)).toBe(true));
});

describe('extractSource network guard', () => {
  it.each([
    'http://127.0.0.1/a/b/c',
    'http://169.254.169.254/latest/meta-data/iam/x',
    'http://[::1]/a/b/c',
    'http://10.0.0.5:8080/admin/panel/x',
    'http://user:pw@example.org/a/b',
    'file:///etc/passwd',
  ])('refuses %s without fetching', async (url) => {
    const d = deps();
    await expect(extractSource(url, d)).rejects.toThrow();
    expect(d.fetched).toEqual([]);
  });

  it('refuses a hostname that resolves to a private address', async () => {
    const d = deps({ dnsMap: { 'intranet.example.org': ['10.0.0.7'] } });
    await expect(extractSource('https://intranet.example.org/docs/a.pdf', d)).rejects.toThrow(/public/);
    expect(d.fetched).toEqual([]);
  });

  it('refuses a hostname where any resolved address is private', async () => {
    const d = deps({ dnsMap: { 'mixed.example.org': [PUBLIC_IP, '127.0.0.1'] } });
    await expect(extractSource('https://mixed.example.org/a/b/c', d)).rejects.toThrow(/public/);
  });

  it('checks every redirect hop and stops at a private one', async () => {
    const d = deps({
      dnsMap: { 'evil.example.org': ['127.0.0.1'] },
      responses: { 'https://public.example.org/a/b/c': { status: 302, location: 'https://evil.example.org/x/y/z' } },
    });
    await expect(extractSource('https://public.example.org/a/b/c', d)).rejects.toThrow(/public/);
    expect(d.fetched.map((f) => f.url)).toEqual(['https://public.example.org/a/b/c']);
    expect(d.fetched[0].redirect).toBe('manual');
  });

  it('follows a public redirect and reports the final URL', async () => {
    const d = deps({ responses: { 'https://public.example.org/a/b/c': { status: 301, location: '/final/doc/page' } } });
    const got = await extractSource('https://public.example.org/a/b/c', d);
    expect(got.url).toBe('https://public.example.org/final/doc/page');
    expect(got.text).toMatch(/public text/);
  });

  it('refuses a body larger than the limit before reading it', async () => {
    const d = deps({ responses: { 'https://public.example.org/big/file/x': { status: 200, length: 50 * 1024 * 1024 } } });
    await expect(extractSource('https://public.example.org/big/file/x', d)).rejects.toThrow(/too large/);
  });
});
