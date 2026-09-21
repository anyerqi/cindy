# Client Auto-review providers

## Scope and settings

Settings > Personalization > Auto-review selects `default` (the existing behavior)
or `jev`. This is a reviewer choice, not a task permission mode or a chat model.
It only affects tasks already using Auto-review. No Cindy server, gateway alias,
model catalog or subscription credential is changed.

The default keeps the native Claude/Codex reviewers where previously supported,
and the existing Cindy fallback chain elsewhere. Jev selects the host review
path for Claude, Codex and Pi. Codex retains `on-request` and `workspace-write`;
Claude uses SDK `default` so approval callbacks reach the host. Existing
read-only shortcuts and hard permission boundaries are unchanged.

A mode change is applied by the next regular send. A running vendor-native turn
is not retroactively re-reviewed. Host review requests check their configuration
again before applying results; all three harness caches include an opaque policy
revision. A changed owner, provider or key retires cached/pending judgments. An
unreadable setting never silently selects another provider.

## Storage and credentials

`<owner-scoped userData>/auto-review-settings.json` contains only explicit
`provider` and mutation `nonce` overrides. Missing settings mean `default`.
Restoring defaults deletes these overrides, retaining the separately saved key.
The explicit delete-key action removes the key and restores defaults.

The `typesafe-auto-review` entry in the existing provider secret store maps to
`provider_key_typesafe_auto_review`. It uses the existing owner-scoped OS-backed
encryption. The key is Main-only: the generic Renderer safe-storage bridge cannot
read, overwrite or delete it. The dedicated settings bridge supports setting a
new key and reporting presence, never reading a saved key. No key is embedded in
the bundle, passed to an Agent process, sent to the Cindy gateway or logged.

Main validates the trusted top-level sender, payload shape, optimistic revision,
and current owner, including after waiting for the cross-process mutation lock.
Setting Jev without a key fails. Saving a key does not claim that API access has
been tested. Settings and keys belong to the execution desktop; this change does
not add mobile settings UI or transmit secrets over device-link.

## TypeSafe transport and judgments

Main calls `https://api.typesafe.ai/v1/systemone` through the existing proxy-aware
outbound transport. The model is pinned to `jev-1.13.0`. The native request has
structured `state` and two independent Choice questions: action verdict and
material context sufficiency. It is not a Chat Completions adapter.

A valid `block` or `ask` is final. An `allow` additionally requires sufficient
context and probability >= 0.90 for both allow and sufficient. These conservative
initial floors are not calibrated Cindy accuracy figures or a security guarantee;
changes require evaluating representative permission cases. Jev does not generate
reasoning prose; any guard reason is fixed host text, not invented model reasoning.

Only the selected provider is called. Jev never falls back to the gateway or a
subscription to search for permission. Bounded transient retries, cancellation,
response-size/shape/probability validation, and sanitized failure reporting apply.
A service failure follows the existing unavailable/manual-confirmation path.

## Context contract

The provider receives the existing Host-authenticated user intent, actual action,
preceding blocked calls, owner/guest authority, platform and full directory roots.
Semantic policy is shared with the original reviewer; its legacy prompt and
output instructions remain unchanged. Jev receives no callable tools, unrestricted
transcript, repository scan, Memory or Skill content.

User intent is already normalized upstream to 2,000 characters. Approved plans
and clarification answers participate in that same budget. Omitted history and
oversized messages remain marked as missing evidence, never unrestricted consent.
The Jev adapter cannot reconstruct discarded text. Ambiguous references such as
"send that" require the relevant identity and authorization; uncertain or missing
material context cannot produce an automatic allow. Complete paths are used,
not the legacy prompt's 512-character display budget. Oversized state is rejected
as insufficient evidence instead of silently truncating authorization or paths.

## Verification and maintenance

The runtime-policy guard and Claude/Codex/Pi integration tests cover selection,
return to default, key revisions and late results. Desktop tests cover settings,
UI key entry, IPC ownership, credential visibility, native wire shape, probabilities,
timeouts and safe failures. Follow the repository's related-unit and package
checks before committing. Live Jev judgment quality, bilingual authorization
cases and real macOS/Windows keychain/UI behavior require separate validation;
mocked HTTP and DOM tests are not evidence that those checks passed.

API references: https://docs.typesafe.ai/api, https://docs.typesafe.ai/confidence,
https://docs.typesafe.ai/concepts/state. Implementation lives in
`apps/desktop/src/main/maker-host/auto-review/` and the shared core runtime-policy guard.
