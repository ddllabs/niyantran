import { assert, assertEquals } from 'jsr:@std/assert@1';
import { hydrateLawContext, type LawContextRow } from './lawContext.ts';
import { rowToChunk } from './retrieval.ts';

const rows: LawContextRow[] = [
  { id:'a', document_id:'law', chunk_index:0, char_from:0, char_to:43, content:'3. CONTENTIONS OF RESPONDENT\n3.1 It submits.' },
  { id:'b', document_id:'law', chunk_index:1, char_from:43, char_to:85, content:'3.31 The alleged debt remains unproven.' },
  { id:'c', document_id:'law', chunk_index:2, char_from:85, char_to:143, content:'7. FINDINGS AND ORDER\n7.1 Rejected. No order as to cost.' },
  { id:'d', document_id:'law', chunk_index:3, char_from:143, char_to:170, content:'7.2 Issue certified copy.' },
];
const hits = async () => Promise.all([rows[1],rows[3]].map(r => rowToChunk({...r,desk_tier:'law'})));

Deno.test('Law source context ties an unproven-debt excerpt to its preceding heading without changing evidence', async () => {
  const input = await hits();
  const output = await hydrateLawContext(input, () => Promise.resolve(rows));
  assertEquals(output[0].preceding_heading?.text, '3. CONTENTIONS OF RESPONDENT');
  assertEquals(output[1].preceding_heading?.text, '7. FINDINGS AND ORDER');
  assertEquals(output[0].preceding_heading?.chunkId, 'a');
  assertEquals(output[0].content,input[0].content);
  assertEquals(output[0].text_hash,input[0].text_hash);
  assertEquals(input[0].preceding_heading,undefined);
});

Deno.test('Law source context rejects missing prefix, duplicate indexes and wrong document identity', async () => {
  for (const invalid of [rows.slice(1),[rows[0],rows[0],...rows.slice(1)],rows.map(r=>({...r,document_id:'wrong'}))]) {
    const output = await hydrateLawContext(await hits(), () => Promise.resolve(invalid));
    assert(output.every(c=>!c.preceding_heading));
  }
});

Deno.test('Law source context cannot cross into a later heading or invent a heading from a paragraph number', async () => {
  const plain = rows.map(r=>({...r,content:r.content.replace('3. CONTENTIONS OF RESPONDENT\n','').replace('7. FINDINGS AND ORDER\n','')}));
  const plainHits = await Promise.all([plain[1],plain[3]].map(r=>rowToChunk({...r,desk_tier:'law'})));
  assert((await hydrateLawContext(plainHits,()=>Promise.resolve(plain))).every(c=>!c.preceding_heading));
  const initial=await rowToChunk({...rows[0],desk_tier:'law'});
  assertEquals((await hydrateLawContext([initial],()=>Promise.resolve(rows)))[0].preceding_heading,undefined);
});

Deno.test('Law source context bounds reads and ignores non-Law or unavailable context', async () => {
  const input=await hits();let reads=0;
  const many=Array.from({length:6},(_,i)=>({...input[0],document_id:`law-${i}`}));
  await hydrateLawContext(many,()=>{reads++;return Promise.reject(new Error('unavailable'));});
  assertEquals(reads,4);
  reads=0;
  await hydrateLawContext([{...input[0],desk_tier:'national'}],()=>{reads++;return Promise.resolve(rows);});
  assertEquals(reads,0);
  const huge=rows.map(r=>({...r,content:'x'.repeat(100001)}));
  assert((await hydrateLawContext(input,()=>Promise.resolve(huge))).every(c=>!c.preceding_heading));
});

Deno.test('An unrecognized numbered section boundary blocks inheriting an earlier heading', async () => {
  const changed = rows.map((r,i)=>i===2?{...r,content:'4. Tribunal reasoning\n4.1 The application fails.'}:r);
  const hit = await rowToChunk({...changed[3],desk_tier:'law'});
  assertEquals((await hydrateLawContext([hit],()=>Promise.resolve(changed)))[0].preceding_heading,undefined);
});
