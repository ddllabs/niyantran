/**
 * Directory for server-side caches / SQLite / flags.
 * On Vercel (and other Lambda-style hosts) the deploy root is read-only;
 * only TMPDIR (/tmp) is writable.
 */
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(__dirname, '..');

export function isServerlessHost() {
  return Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.LAMBDA_TASK_ROOT);
}

/** Writable base dir: project tmp/ locally, /tmp/niyantran on serverless. */
export function writableRoot() {
  if (isServerlessHost()) {
    return path.join(process.env.TMPDIR || '/tmp', 'niyantran');
  }
  return path.join(APP_ROOT, 'tmp');
}

export function writablePath(...parts) {
  return path.join(writableRoot(), ...parts);
}
