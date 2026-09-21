import type { AutoReviewDecision } from './auto-review-decision.js';

/** Host-owned selection and opaque generation, never a model/provider credential. */
export interface AutoReviewRuntimePolicy {
  forceHost: boolean;
  revision: string | null;
}
const LEGACY: Readonly<AutoReviewRuntimePolicy> = Object.freeze({ forceHost: false, revision: 'legacy' });
const UNAVAILABLE: Readonly<AutoReviewRuntimePolicy> = Object.freeze({ forceHost: true, revision: null });

export function sameAutoReviewRuntimePolicy(a: AutoReviewRuntimePolicy, b: AutoReviewRuntimePolicy): boolean {
  return a.forceHost === b.forceHost && a.revision === b.revision;
}

/** Shared by Claude, Codex and Pi. Config transitions retire cached and in-flight results. */
export function createAutoReviewPolicyGuard(
  read: (() => AutoReviewRuntimePolicy | null) | undefined,
  invalidate: () => void,
) {
  let previous: AutoReviewRuntimePolicy | undefined;
  function capture(): AutoReviewRuntimePolicy {
    let current: AutoReviewRuntimePolicy = LEGACY;
    if (read) {
      try {
        const value = read();
        current = value && typeof value.forceHost === 'boolean'
          && typeof value.revision === 'string' && value.revision.length > 0
          ? { forceHost: value.forceHost, revision: value.revision }
          : UNAVAILABLE;
      } catch { current = UNAVAILABLE; }
    }
    if (previous && !sameAutoReviewRuntimePolicy(previous, current)) invalidate();
    previous = current;
    return current;
  }
  return {
    capture,
    protect(snapshot: AutoReviewRuntimePolicy, decision: AutoReviewDecision): AutoReviewDecision {
      const current = capture();
      if (current.revision === null) {
        return { verdict: 'ask', unavailable: true, reason: 'Auto-review settings are unavailable; confirm this action.' };
      }
      if (!sameAutoReviewRuntimePolicy(snapshot, current)) {
        return { verdict: 'block', reason: 'Auto-review settings changed; retry using the current reviewer.' };
      }
      return decision;
    },
  };
}
