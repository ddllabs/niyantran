// F360 test support: a Supabase-shaped query recorder. Every builder method is chainable and records
// itself; awaiting the builder calls respond({ table, calls }) and returns { data, error }.
export function fakePastClient(respond) {
  const log = [];
  const client = {
    log,
    from(table) {
      const entry = { table, calls: [] };
      log.push(entry);
      const builder = new Proxy({}, {
        get(_t, name) {
          if (name === 'then') {
            return (resolve, reject) => Promise.resolve()
              .then(() => respond(entry))
              .then((out) => resolve({ data: null, error: null, ...out }), reject);
          }
          return (...args) => { entry.calls.push([String(name), ...args]); return builder; };
        },
      });
      return builder;
    },
  };
  return client;
}

/** The recorded arguments of the first call named `name`, or undefined. */
export const callArgs = (entry, name) => entry.calls.find((c) => c[0] === name)?.slice(1);
export const hasCall = (entry, name, ...args) => entry.calls.some((c) => c[0] === name && args.every((a, i) => c[i + 1] === a));
