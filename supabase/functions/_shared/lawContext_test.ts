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

Deno.test('A complete Law prefix contributes deduplicated original tail evidence with its own hash', async () => {
  const hit = await rowToChunk({...rows[1],desk_tier:'law',title:'Order',source_kind:'document'});
  const result = await hydrateLawContext([hit],()=>Promise.resolve(rows));
  assertEquals(new Set(result.map(c=>c.id)), new Set(['b','c','d']));
  const tail=result.find(c=>c.id==='d')!;
  assertEquals(tail.content, rows[3].content);
  assertEquals(tail.char_from,rows[3].char_from);
  assertEquals(tail.text_hash,(await rowToChunk(rows[3])).text_hash);
  const repeated = await hydrateLawContext(result,()=>Promise.resolve(rows));
  assertEquals(new Set(repeated.map(c=>c.id)).size,repeated.length);
});

Deno.test('An exactly full bounded prefix is not proof of document end', async () => {
  const prefix=Array.from({length:256},(_,i)=>({id:`x${i}`,document_id:'law',chunk_index:i,char_from:i*20,char_to:i*20+10,content:'plain text'}));
  const hit=await rowToChunk({...prefix[2],desk_tier:'law'});
  assertEquals((await hydrateLawContext([hit],()=>Promise.resolve(prefix))).map(c=>c.id),['x2']);
});

Deno.test('Tail citations retain their own page and block coordinates, never those of a relevance hit', async () => {
  const paged = rows.map((r,i)=>({...r,source_kind:'pdf_page',page_number:i+1,block_ids:[`block-${i}`],image_ids:[`image-${i}`]}));
  const hit=await rowToChunk({...paged[1],desk_tier:'law'});
  const tail=(await hydrateLawContext([hit],()=>Promise.resolve(paged))).find(c=>c.id==='d')!;
  assertEquals(tail.source_kind,'pdf_page');
  assertEquals(tail.page_number,4);
  assertEquals(tail.block_ids,['block-3']);
  assertEquals(tail.image_ids,['image-3']);
});

Deno.test('Original final passages precede lower-ranked hits so reply bounds do not discard them first',async()=>{
 const prefix=Array.from({length:45},(_,i)=>({id:`x${i}`,document_id:'law',chunk_index:i,char_from:i*500,char_to:i*500+400,content:'source '.repeat(50)}));
 const hit=await Promise.all(prefix.slice(0,40).map(r=>rowToChunk({...r,desk_tier:'law'})));
 const result=await hydrateLawContext(hit,()=>Promise.resolve(prefix));
 assertEquals(result.slice(0,3).map(c=>c.id),['x0','x43','x44']);
 assertEquals(new Set(result.map(c=>c.id)).size,result.length);
});

Deno.test('Quoted numbered precedent preserves earlier heading and intervening text without asserting governing speaker', async () => {
  const changed = rows.map((r,i)=>i===2?{...r,content:'50. Suffice it to conclude that there is no substance\nin that precedent.'}:r);
  const hit = await rowToChunk({...changed[3],desk_tier:'law'});
  const result = (await hydrateLawContext([hit],()=>Promise.resolve(changed)))[0];
  assertEquals(result.preceding_heading,undefined);
  assertEquals(result.heading_context?.map(h=>h.text),['3. CONTENTIONS OF RESPONDENT','50. Suffice it to conclude that there is no substance']);
  assertEquals(result.content,hit.content);
});

Deno.test('Ambiguous heading context preserves a possible speaker change literally', async () => {
  const changed = rows.map((r,i)=>i===2?{...r,content:'4. Tribunal reasoning\n4.1 The application fails.'}:r);
  const hit = await rowToChunk({...changed[3],desk_tier:'law'});
  const result = (await hydrateLawContext([hit],()=>Promise.resolve(changed)))[0];
  assertEquals(result.preceding_heading,undefined);
  assertEquals(result.heading_context?.map(h=>h.text),['3. CONTENTIONS OF RESPONDENT','4. Tribunal reasoning']);
});

Deno.test('A quoted precedent fragment retains its original introductory paragraph as citable evidence', async () => {
  const source:LawContextRow[]=[
    {id:'intro',document_id:'law',chunk_index:0,char_from:0,char_to:300,content:'7.32 We rely on the Supreme Court judgment in Other Case. Its paragraph is reproduced below:\n“16. Admission of a claim by the IRP'},
    {id:'middle',document_id:'law',chunk_index:1,char_from:300,char_to:600,content:'is administrative work. Admission of the claim in the first CIRP was not an acknowledgement.'},
    {id:'end',document_id:'law',chunk_index:2,char_from:600,char_to:900,content:'Accordingly the third issue is answered.”\n7.33 This petition is barred.\n7.34 No order as to cost.'},
  ];
  const hit=await rowToChunk({...source[1],desk_tier:'law'});
  const output=await hydrateLawContext([hit],()=>Promise.resolve(source));
  assertEquals(output[0].paragraph_context?.text,source[0].content);
  assert(output.some(c=>c.id==='intro'&&c.content===source[0].content));
  assertEquals(output[0].content,hit.content);
  assertEquals(output[0].text_hash,hit.text_hash);
  assertEquals(output.find(c=>c.id==='end')?.paragraph_context?.chunkId,'intro');
});

Deno.test('Paragraph context is bounded, does not cross a fresh decimal opening, and strips unverified metadata', async () => {
  const source:LawContextRow[]=[
    {id:'intro',document_id:'law',chunk_index:0,char_from:0,char_to:1000,content:'7.32 Original opening '+ 'x'.repeat(900)},
    {id:'continuation',document_id:'law',chunk_index:1,char_from:1000,char_to:1100,content:'continuation'},
    {id:'fresh',document_id:'law',chunk_index:2,char_from:1100,char_to:1200,content:'7.33 New paragraph'},
    {id:'distant',document_id:'law',chunk_index:3,char_from:14000,char_to:14100,content:'distant fragment'},
  ];
  const input=await Promise.all(source.slice(1).map(r=>rowToChunk({...r,desk_tier:'law'})));
  const output=await hydrateLawContext(input,()=>Promise.resolve(source));
  assertEquals(output.find(c=>c.id==='continuation')?.paragraph_context?.text.length,700);
  assertEquals(output.find(c=>c.id==='fresh')?.paragraph_context,undefined);
  assertEquals(output.find(c=>c.id==='distant')?.paragraph_context,undefined);
  const forged={...input[0],paragraph_context:{text:'Unverified',chunkId:'other',charFrom:0}};
  assertEquals((await hydrateLawContext([forged],()=>Promise.reject(new Error('unavailable'))))[0].paragraph_context,undefined);
});

Deno.test('Paragraph opening coordinates point to its literal first character after indentation',async()=>{
 const source:LawContextRow[]=[
  {id:'intro',document_id:'law',chunk_index:0,char_from:0,char_to:100,content:'   7.32 Quoted authority follows.'},
  {id:'tail',document_id:'law',chunk_index:1,char_from:100,char_to:200,content:'continued original quotation'},
 ];
 const hit=await rowToChunk({...source[1],desk_tier:'law'});
 const context=(await hydrateLawContext([hit],()=>Promise.resolve(source)))[0].paragraph_context;
 assertEquals(context?.charFrom,3);
 assertEquals(context?.text,'7.32 Quoted authority follows.');
});
