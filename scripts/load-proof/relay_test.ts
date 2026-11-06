// The relay must end a connection when the SERVER closes it (review finding B5). Needs PostgREST up
// (postgrest.sh up); the tests are skipped, with a note, when it is not.
import { assert } from 'jsr:@std/assert@1';
import { mintToken, OLD_RELAY_SCRIPT, POSTGREST, RELAY_SCRIPT, startRelay } from './lib.ts';

const up = await new Deno.Command('docker', {
  args: ['inspect', '-f', '{{.State.Running}}', POSTGREST],
  env: { PATH: `${Deno.env.get('HOME')}/.docker/bin:${Deno.env.get('PATH')}` },
  stdout: 'piped',
  stderr: 'null',
}).output().then((o) => new TextDecoder().decode(o.stdout).trim() === 'true', () => false);

/** Sends one request that asks the server to close, keeps OUR side open, and returns the ms until EOF (or null). */
async function msToServerClose(script: string): Promise<{ ms: number | null; body: string }> {
  const relay = startRelay(script);
  try {
    const url = new URL(relay.url);
    const conn = await Deno.connect({ hostname: url.hostname, port: Number(url.port) });
    const token = await mintToken('service_role');
    await conn.write(
      new TextEncoder().encode(
        `GET /ingest_settings?select=max_running HTTP/1.1\r\nHost: x\r\nAuthorization: Bearer ${token}\r\nConnection: close\r\n\r\n`,
      ),
    );
    const t0 = performance.now();
    const chunks: Uint8Array[] = [];
    const deadline = t0 + 4000;
    const text = () => new TextDecoder().decode(new Uint8Array(chunks.flatMap((c) => [...c])));
    // One read in flight at a time, each into its own buffer: a read that lost a race with the timer would
    // otherwise still be filling a buffer nobody looks at.
    let buf = new Uint8Array(65536);
    let read = conn.read(buf);
    while (performance.now() < deadline) {
      const n = await Promise.race([read, new Promise<-1>((r) => setTimeout(() => r(-1), 200))]);
      if (n === -1) continue;
      if (n === null) return { ms: performance.now() - t0, body: text() };
      chunks.push(buf.slice(0, n));
      buf = new Uint8Array(65536);
      read = conn.read(buf);
    }
    return { ms: null, body: text() };
  } finally {
    relay.close();
  }
}

Deno.test({
  name: 'the relay ends the connection within 3 s of a server-side close, with the client still open',
  ignore: !up,
  async fn() {
    const r = await msToServerClose(RELAY_SCRIPT);
    assert(r.body.includes('max_running'), r.body.slice(0, 200));
    assert(r.ms !== null && r.ms < 3000, `no EOF after ${r.ms}`);
  },
});

Deno.test({
  name: 'the old relay does not (this is what the test above is able to fail on)',
  ignore: !up,
  async fn() {
    const r = await msToServerClose(OLD_RELAY_SCRIPT);
    assert(r.body.includes('max_running'));
    assert(r.ms === null, `the old relay ended after ${r.ms} ms`);
  },
});
