import { parse } from 'node:url';
import { spawnSync } from 'node:child_process';
import { expect, it, vi } from 'vitest';
import handler, { routePath, requestQueryValue } from '../../api/router.js';

// Matches the pre-f7b5377 Vercel getQueryParser lazy property. Reading it is
// unnecessary: the same encoded rewrite/query string is already in req.url.
function request(url, explicit) {
  const req = { method: 'GET', headers: { host: 'localhost' }, url };
  const read = vi.fn(() => parse(url, true).query);
  if (explicit) req.query = explicit;
  else Object.defineProperty(req, 'query', { configurable: true, get: read });
  return { req, read };
}
function response() {
  return { statusCode: 200, setHeader() {}, status(n) { this.statusCode = n; return this; }, json(v) { this.body = v; return this; } };
}
it('routes a rewritten request without evaluating the deprecated runtime query getter', async () => {
  const { req, read } = request('/api/router?__route=unmatched&name=A%2BB+%26+C');
  const res = response();
  await handler(req, res);
  expect(res.statusCode).toBe(404);
  expect(res.body.error).toBe('No API route for /api/unmatched');
  expect(read).not.toHaveBeenCalled();
});
it('preserves explicit-query precedence and array rewrite segments', () => {
  expect(routePath(request('/api/router?__route=url', { __route: ['ai', 'desk-brief'] }).req)).toBe('/api/ai/desk-brief');
  expect(routePath(request('/api/router?__route=first&__route=second').req)).toBe('/api/first/second');
  expect(routePath(request('/api/router?__route=ai%2Fdesk-brief').req)).toBe('/api/ai/desk-brief');
  expect(routePath(request('/api/home/segments?limit=2').req)).toBe('/api/home/segments');
});
it('produces no DEP0169 under Node with the historical request-helper boundary', () => {
  const probe = `import {parse} from 'node:url';import handler from './api/router.js';const req={method:'GET',headers:{host:'localhost'},url:'/api/router?__route=unmatched'};Object.defineProperty(req,'query',{configurable:true,get:()=>parse(req.url,true).query});const res={setHeader(){},status(){return this},json(){}};await handler(req,res);`;
  const result = spawnSync(process.execPath, ['--trace-deprecation', '--input-type=module', '-e', probe], { encoding: 'utf8', cwd: process.cwd(), env: process.env });
  expect(result.status).toBe(0);
  expect(result.stderr).not.toContain('DEP0169');
});

it('preserves repeated values, plus signs, Unicode and explicit data without invoking accessors', () => {
  const {req,read}=request('/api/router?__route=unmatched&name=A%2BB+%26+C&name=%E0%A4%AD%E0%A4%BE%E0%A4%B0%E0%A4%A4');
  expect(requestQueryValue(req,'name')).toEqual(['A+B & C','भारत']);
  expect(requestQueryValue(req,'missing')).toBeUndefined();
  expect(requestQueryValue(request('/?x=url',{x:'explicit'}).req,'x')).toBe('explicit');
  expect(read).not.toHaveBeenCalled();
});
it('materializes the safe query before downstream handlers rewrite the request URL', async () => {
  const {req,read}=request('/api/router?__route=unmatched&page=2&q=A%2BB+%26+C&tag=a&tag=b');
  await handler(req,response());
  req.url='/api/users';
  expect(req.query).toMatchObject({page:'2',q:'A+B & C',tag:['a','b']});
  expect(read).not.toHaveBeenCalled();
});
