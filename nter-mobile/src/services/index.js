// One service object for the whole app. VITE_DATA_MODE=sample swaps the live backend for the
// bundled read-only snapshot; every screen calls `api.*` and never knows which it got.
import { DATA_MODE } from '../lib/config.js';
import * as live from './live.js';
import * as sample from './sample.js';

export const api = DATA_MODE === 'sample' ? sample : live;
export const isSample = DATA_MODE === 'sample';
