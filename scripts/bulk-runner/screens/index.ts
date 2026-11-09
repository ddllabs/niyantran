// The collection screens the screen command knows by name (docs/specs/2026-11-10-screening-stage.md). Each value builds
// one `Screen` (scripts/bulk-runner/screen_types.ts). Empty until a collection's screen module is added here.
import type { Screen } from '../screen_types.ts';

export const SCREENS: Record<string, () => Promise<Screen>> = {};
