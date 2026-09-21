import { describe, expect, it, vi } from 'vitest';
import { createAutoReviewPolicyGuard, type AutoReviewRuntimePolicy } from './auto-review-runtime-policy.js';

describe('Auto-review runtime policy', () => {
  it('preserves native-first defaults without a host hook', () => {
    const invalidate = vi.fn();
    const guard = createAutoReviewPolicyGuard(undefined, invalidate);
    const policy = guard.capture();
    expect(policy.forceHost).toBe(false);
    const decision = { verdict: 'allow' as const };
    expect(guard.protect(policy, decision)).toBe(decision);
    expect(invalidate).not.toHaveBeenCalled();
  });
  it.each(['provider', 'key', 'owner', 'reset'])('retires cached and in-flight allows on %s changes', (kind) => {
    let policy: AutoReviewRuntimePolicy = { forceHost: false, revision: 'before' };
    const invalidate = vi.fn();
    const guard = createAutoReviewPolicyGuard(() => policy, invalidate);
    const snapshot = guard.capture();
    policy = { forceHost: kind !== 'reset', revision: kind };
    expect(guard.protect(snapshot, { verdict: 'allow' }).verdict).toBe('block');
    expect(invalidate).toHaveBeenCalledOnce();
    expect(guard.protect(guard.capture(), { verdict: 'allow' }).verdict).toBe('allow');
    expect(invalidate).toHaveBeenCalledOnce();
  });
  it('does not reuse a verdict after switching away and back', () => {
    let policy = { forceHost: true, revision: 'jev-1' };
    const guard = createAutoReviewPolicyGuard(() => policy, vi.fn());
    const snapshot = guard.capture();
    policy = { forceHost: false, revision: 'default-2' }; guard.capture();
    policy = { forceHost: true, revision: 'jev-3' };
    expect(guard.protect(snapshot, { verdict: 'allow' }).verdict).toBe('block');
  });
  it.each([null, { forceHost: false, revision: null }, { forceHost: false, revision: '' }])(
    'routes unavailable settings to the host and asks rather than silently using native review', (value) => {
      const guard = createAutoReviewPolicyGuard(() => value, vi.fn());
      const snapshot = guard.capture();
      expect(snapshot.forceHost).toBe(true);
      expect(guard.protect(snapshot, { verdict: 'allow' })).toMatchObject({ verdict: 'ask', unavailable: true });
    },
  );
  it('handles a failing settings reader without trusting a cached allow', () => {
    const guard = createAutoReviewPolicyGuard(() => { throw new Error('private detail'); }, vi.fn());
    expect(JSON.stringify(guard.protect(guard.capture(), { verdict: 'allow' }))).not.toContain('private detail');
  });
});
