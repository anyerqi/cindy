# Cindy: client-only Jev Auto-review settings

**Delivery status: source overlay and guarded patch generator. Not applied to the repository, not committed, and not ready for a production release.**

This supersedes the earlier gateway-replacement proposal and environment-variable-only draft. No server changes are included.

## Implemented in this bundle

- Settings > Personalization > Auto-review: Original (default) or Jev.
- Jev-only password field, explicit save, restore defaults, and delete-key-and-restore-defaults.
- Dedicated trusted Main IPC and a narrow preload bridge; saved plaintext is never returned to the renderer.
- Owner-scoped configuration plus the existing safeStorage credential plane. No plaintext key in the settings JSON, application logs, or Agent child-process environment.
- Main-process direct requests to the TypeSafe System One endpoint, with the existing proxy-aware outbound transport.
- The existing Cindy gateway/subscription candidate chain remains the default, unchanged. Jev is not inserted into that chain and never silently falls back to it.
- Explicit state projection, context-coverage information, typed decisions, bounded request/response sizes, cancellation, retries, and safe failure categories.
- Main handler, settings service, view-controller race tests, transport tests, source-transform tests, and five complete locale additions.

## Important remaining work

1. **Native reviewer routing is not implemented.** Some official Claude OAuth sessions use native SDK Auto and bypass the Cindy callback. Codex has a corresponding `approvalsReviewer: auto_review` path. Selecting Jev must be wired into those engines without changing their sandbox or higher-priority constraints. The UI currently identifies this as an integration preview rather than claiming those paths use Jev.
2. **Engine-level decision-cache invalidation is not implemented.** New-router requests abort/check staleness after local setting changes. Existing decisions cached inside the engines can still bypass that router. Provider/key/owner generation must be included at those cache and execution boundaries.
3. The source overlay must be integrated into a complete checkout, including review of all transformed code. The generator has been syntax checked and its transformations tested on reviewed snippets; it has not been run against a complete live checkout.
4. Mandatory repository unit/type gates, actual Electron UI checks, and real Jev classification evaluations remain unrun. Mock HTTP success is not a live API test or evidence of model accuracy.

Do not merge or publish this as a fully functioning replacement selector until the first two items are completed and the repository gates pass.

## Bundle layout

- `overlay/`: 13 new TypeScript/TSX files, laid out as repository-relative paths. Two files are Vitest tests intended for the existing desktop package.
- `integration/transforms.mjs`: guarded edits to six reviewed existing files, including extracting shared input/policy while preserving the original text-reviewer prompt.
- `integration/locales/`: additive `settings.autoReview` translations for en, zh-CN, zh-TW, ja, and ko.
- `integration/prepare-patch.mjs`: read-only patch generation; refuses changed blobs, duplicate targets, unexpected structures, and symlinked/out-of-root source files.
- `dist/`: compiled pure modules so the offline test suite can run without downloading dependencies.
- `tests/`: offline Node tests. These do not substitute for the monorepo test suite.
- `SOURCE_MANIFEST.json`: reviewed commit, exact blob hashes, external API references, and verification status.
- `TECHNICAL_PLAN.md`: Chinese implementation/context notes and remaining work.

## Verification actually performed

On Node v22.16.0:

- Strict TypeScript check and compilation of the eight pure entry modules listed in `tsconfig.offline.json`.
- **154 offline tests passed; zero failed, skipped, or cancelled.**
- Syntax-only transpilation of all 13 overlay TypeScript/TSX files: zero diagnostics.
- JavaScript syntax checks for the source transforms and patch generator.
- Locale key parity and additive insertion tests for all five locales.
- Nine sample cases compare the original/refactored prompt byte-for-byte; normalization helpers are injected fixtures, not a claim that the complete repository was executed.

`verification-offline.txt` and `verification-syntax.json` retain the actual results. Electron/React module resolution, the repository package typecheck, visual rendering, and live inference have not been validated.

## Re-run offline checks

Compiled files are included:

```bash
npm run test:offline
```

For rebuilding, TypeScript and Node type declarations must be available to the local toolchain. The cloud run used a preinstalled TypeScript executable with an explicit `--typeRoots` pointing to preinstalled Node types; no packages were downloaded and no project dependency versions were changed.

```bash
tsc -p tsconfig.offline.json --typeRoots /absolute/path/to/node-types
node --test tests/*.test.mjs
# Uses a locally installed TypeScript package, or set TYPESCRIPT_PATH to its JS entry.
node integration/check-syntax.mjs
```

## Prepare, inspect, then integrate

The generator reads the checkout, verifies source hashes, and prints a unified diff. It does not alter the checkout, Git history, branches, remotes, or dependencies:

```bash
node integration/prepare-patch.mjs /absolute/path/to/cindy > /tmp/cindy-jev.patch
cd /absolute/path/to/cindy
git apply --check /tmp/cindy-jev.patch
```

Do not apply with force or bypass a source mismatch. Reconcile against the actual branch and user changes. The full integration still needs the native routing/cache work above.

Before a commit, follow repository rules, including:

```bash
pnpm test:unit:related
pnpm --filter desktop run --if-present typecheck
# Also run maker-core typecheck after implementing the remaining engine changes.
pnpm --filter @cindy/maker-core run --if-present typecheck
```

Run the full relevant engine/native integration and platform checks as required by the resulting diff. Review the complete diff. Only commit after all mandatory gates pass, using the repository's DCO sign-off workflow. No commit command has been executed as part of this delivery.

## Contract and privacy notes

The TypeSafe endpoint/model contract was checked on 2026-09-20; official sources are in `SOURCE_MANIFEST.json`. `jev-1.13.0` is pinned. Probabilities of 0.90 used in the experimental allow/context composition are uncalibrated policy thresholds, not 90% correctness or a permission guarantee.

The direct API opt-in sends the bounded authorization/action evidence described by the UI to TypeSafe. It does not grant permission to upload an entire repository, transcript, attachment set, or credential store. Complete host-supplied directory paths are preserved, but user history omitted by the upstream 2,000-character budget cannot be recovered by this adapter. Missing referents or script effects require additional evidence or a user decision, not a guessed grant.
