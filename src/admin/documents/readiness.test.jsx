import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ReadinessTable, readinessRequest, inspectPage, createReadinessLoader } from './readiness.jsx';
describe('read-only corpus readiness', () => {
 it('keeps tuple identity separate and exposes admin technical details without mutations', () => {
  const html = renderToStaticMarkup(createElement(ReadinessTable, { kind: 'records', items: [{row_key:'mp-1',title:'Question subject',state:'partial',association_adapter:'ordinary',ready_documents:1,documents:[{document_id:'doc-1',index_state:'indexed',association_kind:'ordinary',chunks_scanned:4,vectors_scanned:4,role:'answer',version:'1',identity_ok:true,published:true}]}] }));
  expect(html).toContain('partial'); expect(html).toContain('doc-1'); expect(html).toContain('mp-1');
  expect(html).not.toMatch(/<(button|input|form)\b/); expect(html).not.toContain('Unlink');
 });
 it('requests one bounded page and only read-only methods', async () => {
  const request = readinessRequest({tier:'national',feature:'Parliamentary Question Database'}, 'records', 'mp-1', '', null);
  expect(request).toEqual({desk_tier:'national',desk_feature:'Parliamentary Question Database',ids:['mp-1'],limit:50});
  const api={readinessRecords:vi.fn(async () => ({items:[]})),readinessDocuments:vi.fn(),link:vi.fn(),retry:vi.fn()};
  await inspectPage(api,'records',request); expect(api.readinessRecords).toHaveBeenCalledTimes(1); expect(api.link).not.toHaveBeenCalled();expect(api.retry).not.toHaveBeenCalled();
  expect(() => readinessRequest({tier:'law',feature:'NCLT'},'records','','cohort',null)).toThrow('document');
 });
 it('distinguishes unassociated and hidden Law documents', () => {
  const html=renderToStaticMarkup(createElement(ReadinessTable,{kind:'documents',items:[{document_id:'a',association_kind:'unassociated',index_state:'registered',publication_state:'not_managed'},{document_id:'b',association_kind:'law',index_state:'indexed',publication_state:'hidden'}]}));
  expect(html).toContain('unassociated');expect(html).toContain('hidden');expect(html).not.toContain('Standalone');
 });
});

it('rejects an old page arriving after filter edit or unmount', async () => {
 const loader=createReadinessLoader();let resolveOld;const old=loader.run(()=>new Promise(resolve=>{resolveOld=resolve;}));
 loader.invalidate();const latest=await loader.run(async()=>({items:[{row_key:'new'}]}));
 resolveOld({items:[{row_key:'old'}]});expect((await old).current).toBe(false);expect(latest.current).toBe(true);expect(latest.answer.items[0].row_key).toBe('new');
 let finish;const unmount=loader.run(()=>new Promise(resolve=>{finish=resolve;}));loader.invalidate();finish({items:[]});expect((await unmount).current).toBe(false);
});
