import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { contextualizeReceipt } from './corpus-context-preflight.mjs';
const sha = text => createHash('sha256').update(text).digest('hex');
const text = '# Powers\nEvidence.\n# Appeals\nRemedy.';
const receipt = () => ({ status:'pass', original_sha256:sha(text), expected_chunks:1, chunker_version:2, doc:{source_key:'local-fixture',title:'Test',metadata:{text_sha256:sha(text),n_chars:text.length}} });
test('context preflight refuses stale source text before freezing a receipt',async()=>{
 await assert.rejects(contextualizeReceipt(receipt(),text+' changed'),/source hash/);
});
test('context preflight freezes mode, exact spans, section hashes and complete input budget',async()=>{
 const before=receipt();const r=await contextualizeReceipt(before,text);
 assert.equal(before.chunker_version,2);assert.equal(r.chunker_version,4);assert.equal(r.doc.chunking_mode,'section_context_v1');assert.equal(r.expected_chunks,2);
 assert.equal(r.expected_spans[1].section.heading,'Appeals');assert.match(r.expected_spans[1].embed_hash,/^[a-f0-9]{64}$/);
 assert(r.token_ceiling>Buffer.byteLength(text));assert.equal(r.context_audit.midword_boundaries,0);
});
