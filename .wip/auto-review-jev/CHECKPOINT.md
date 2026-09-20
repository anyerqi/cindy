# WIP checkpoint: client-side Jev Auto-review

This directory preserves the client source draft requested by the owner.
It is NOT installed into the application and does not change runtime behavior.
No server or gateway source is modified. Existing Auto-review stays unchanged.

## Why this is a snapshot, not an integrated feature commit

The current cloud environment cannot clone GitHub or download npm dependencies
(DNS resolution fails). No complete application checkout is available here.
The original cloud output was a source overlay and guarded patch generator,
not tracked changes in a checked-out Cindy repository. Saving this source as
WIP must not silently turn it into an enabled, unverified security boundary.

The commit has the real anyerqi/cindy main commit
2234ef74c93d57e1e4ab85e2f8272ecc34c6d1b5 as its parent. Existing tree entries
are retained unchanged. The prerequisite commit must already exist when
importing the incremental Git bundle into a normal repository clone.

## Verification repeated for this checkpoint

- Offline tests: 154 passed, 0 failed.
- Strict TypeScript check of the isolated pure modules: passed, using the
  available ts-node installation's @types/node via an explicit --typeRoots.
- Syntax check: 13 TypeScript/TSX files, 0 diagnostics.
- Cindy repository-related tests and package typechecks: NOT RUN.
- Real Jev calls, Electron UI, native reviewer coverage: NOT VERIFIED.

Generated dist files and old verification outputs are excluded from Git.
After installing the necessary TypeScript/Node development types, build the
isolated modules before running their tests. These tests are not a substitute
for the Cindy repository's required gates.

## Remaining work before a functional feature commit

1. Apply the guarded transforms and source overlay to a full checkout.
2. Finish Claude/Codex native-reviewer selection and cache invalidation.
3. Run the repository-related tests and affected-package typechecks.
4. Verify the settings UI, credential handling, and real Jev judgments.

Do not push or open a PR for this WIP checkpoint before the required gates
pass. This checkpoint has not been pushed and no GitHub branch was changed.
