# Auth Earth implementation

> **Status: Living.** Owner authorized 2026-10-12; sequential work on task/client-ui-spec.

1. Verify primary Three.js API and texture source/licence. Download optimized
   surface/cloud/specular textures under new auth-earth directory only.
2. Implement lazy Three.js scene and focused lifecycle guard; no homepage changes.
3. Share AuthEarth between login/signup; remove signup rings; preserve handlers.
4. Browser-check real auth composition, drag/keyboard/pause/motion/fallback and
   desktop/mobile sizing. Run focused/full tests, lint/build. Review and commit
   locally; no merge, push or deploy. Corpus untouched.


## Execution

All four tasks implemented and locally verified; see spec execution evidence.
Independent review caught intermediate-width login overlap; fixed before final
checks. The lifecycle guard was mutation-proven. No backend/corpus changes.
Owner visual review and integration remain pending; no release authorized.
