/** Guard real initial downloads as well as the unchanged Vite chunk warning limit. */
export function checkBundleBudget({ initialGzipBytes, limit, chunks }) {
  if (initialGzipBytes > limit) throw new Error(`aggregate initial JavaScript ${initialGzipBytes} bytes gzip exceeds ${limit}`);
  for (const [name, code] of chunks) {
    // Vite's default threshold compares minified chunk code length with500kB.
    if (code.length > 500_000) throw new Error(`${name} exceeds the500kB minified JavaScript chunk budget`);
  }
}
