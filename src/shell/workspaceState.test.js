import { afterEach, expect, it } from 'vitest';
import { clearWorkspace, workspaceScopeKey, readWorkspace, writeWorkspace } from './workspaceState.js';
afterEach(clearWorkspace);
it('retains controls across module navigation without sharing accounts or desks', () => {
 const a = workspaceScopeKey('alice', 'global:Open Fronts');
 writeWorkspace(a, 'q', 'Ukraine'); writeWorkspace(a, 'page', 3);
 const b = workspaceScopeKey('alice', 'global:Alliances');
 expect(readWorkspace(b, 'q', '')).toBe('');
 expect(readWorkspace(workspaceScopeKey('alice', 'global:Open Fronts'), 'q', '')).toBe('Ukraine');
 expect(readWorkspace(workspaceScopeKey('bob', 'global:Open Fronts'), 'q', '')).toBe('');
 clearWorkspace(); expect(readWorkspace(a, 'q', '')).toBe('');
});
it('does not accept oversized control state', () => {
 const scope=workspaceScopeKey('alice', 'module');
 writeWorkspace(scope,'q','x'.repeat(25000)); expect(readWorkspace(scope,'q','')).toBe('');
});
