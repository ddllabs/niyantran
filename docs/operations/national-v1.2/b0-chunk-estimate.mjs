// B0: offline chunk estimate per record with the shared whole-document chunker (chunkUnit, CHUNK defaults) and its token
// estimate. Read-only use of shared code; no network. Usage:
//   node --experimental-strip-types b0-chunk-estimate.mjs <in.jsonl: {"k": key, "t": text} per line>  -> "key\tchunks\ttokens"
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { chunkUnit, estimateTokens } from '../../../supabase/functions/_shared/chunking.ts';
const rl = createInterface({ input: createReadStream(process.argv[2]), crlfDelay: Infinity });
for await (const line of rl) {
  if (!line.trim()) continue;
  const { k, t } = JSON.parse(line);
  const spans = chunkUnit({ unitKey: 'document', text: t || '', sourceKind: 'document' });
  let tokens = 0;
  for (const s of spans) tokens += estimateTokens(s.content);   // fixed 2026-10-31: the first B0 run sliced by undefined offsets, so its tokens_est column is void
  process.stdout.write(`${k}\t${spans.length}\t${tokens}\n`);
}
