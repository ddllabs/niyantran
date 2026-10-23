import { assert, assertEquals } from 'jsr:@std/assert@1';
import { placeholderAnswer, placeholderPrefix } from './answerValidation.ts';
Deno.test('F249: exact placeholder and streamed prefixes are held, not ordinary prose',()=>{
 for(const token of ['llm_result',' LLM_RESULT\n']) assert(placeholderAnswer(token));
 for(const token of ['', 'l', 'llm_', 'llm_result ']) assert(placeholderPrefix(token));
 for(const prose of ['llm_result is an internal token.', 'The text mentions llm_result.', 'Legal result']) {
  assertEquals(placeholderAnswer(prose),false); assertEquals(placeholderPrefix(prose),false);
 }
});
