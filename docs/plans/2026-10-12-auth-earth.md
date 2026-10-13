# Auth Earth implementation

> **Reconciled 2026-10-13 (F105):** this work is in `main` and production (`f20ef35` (merged 2026-10-12, pushed and deployed with F102/F103)). Lines below that call it uncommitted, local only or unmerged describe its state on the date written.

> **Status: Historical (2026-10-12).** Retired by F141 on 2026-10-14: the client's data globe
> replaced `AuthEarth` on every page and `AuthEarth` was deleted; see
> [the one-globe spec](../specs/2026-10-14-one-globe.md). Kept as the record of what it was.
> Originally: Owner authorized 2026-10-12; sequential work on task/client-ui-spec.

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


## Amendment 1 (owner, 2026-10-12)

Spec amendment 1: orbits with satellites, India start view, continuous motion
during drag. Auth pages only.

5. Red tests in `authEarthScene.test.js`: India faces the camera at load;
   three rings with two satellites each; satellites advance while dragging
   and the globe does not auto-spin; spin resumes from the dragged angle.
6. Implement in `authEarthScene.js`: India Euler, orbit group outside the
   planet group, a points shader for satellites and trails, camera framing
   that keeps the globe size; canvas overflow styling in `marketing.css`.
7. Focused and full tests, lint, build; browser check of login and signup at
   360/768/1024/1440, drag/pause/keyboard; screenshots. Local only.

Amendment 1 tasks 5–7 done and verified locally; evidence in the spec. Left
uncommitted for owner review.
