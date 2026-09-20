import { describe, expect, it, vi } from 'vitest';
import type { AutoReviewRequest } from '@cindy/maker-core';
import { buildAutoPermissionReviewInput, buildAutoPermissionReviewPolicy } from '../../auto-permission-reviewer.js';
import { prepareJevReviewInput } from '../jev-context.js';
import { createAutoReviewProviderRouter, type AutoReviewProvider, type ProviderRouterDeps } from '../provider-router.js';
import { TYPESAFE_AUTO_REVIEW_MODEL } from '../jev-transport.js';

const request: AutoReviewRequest = {
  agentKind: 'claude-code', model: 'test-session-model',
  userIntent: { earlierUserMessages: ['Fix the code. Do not deploy.'], currentUserMessage: 'Continue.' },
  action: { kind: 'exec', command: 'pnpm test', cwd: '/repo' },
  // Logical Linux execution paths: no dependence on the test runner's host platform.
  workspaceRoots: ['/repo', '/reference'], writableRoots: ['/repo'], platform: 'linux',
  authorizationContext: { requesterAuthority: 'owner', source: 'direct' },
};
function prepare(value: AutoReviewRequest = request) {
  return prepareJevReviewInput(buildAutoPermissionReviewPolicy(), buildAutoPermissionReviewInput(value), value);
}
function answer(verdict: 'allow' | 'ask' | 'block' = 'allow', sufficient = true) {
  return {
    model: TYPESAFE_AUTO_REVIEW_MODEL,
    answers: {
      decision: { type: 'choice', choice: verdict, confidence: 1,
        probabilities: { allow: Number(verdict === 'allow'), ask: Number(verdict === 'ask'), block: Number(verdict === 'block') } },
      context: { type: 'choice', choice: sufficient ? 'sufficient' : 'insufficient', confidence: 1,
        probabilities: { sufficient: Number(sufficient), insufficient: Number(!sufficient) } },
    },
    usage: { input_tokens: 100, output_tokens: 60 },
  };
}
function setup(verdict: 'allow' | 'ask' | 'block' = 'allow', sufficient = true) {
  const fetchImpl = vi.fn(async () => new Response(JSON.stringify(answer(verdict, sufficient))));
  const requestDefault = vi.fn(async () => '{"verdict":"allow","reason":"legacy"}');
  const readJevApiKey = vi.fn(() => 'fake-typesafe-key');
  const state: { provider: AutoReviewProvider; owner: string | null } = { provider: 'jev', owner: 'owner:1' };
  const deps: ProviderRouterDeps<AutoReviewRequest> = {
    readProvider: () => state.provider, ownerStamp: () => state.owner,
    requestDefault, readJevApiKey, prepareJev: prepare, fetchImpl,
    logger: { debug: vi.fn(), warn: vi.fn() },
  };
  return { state, deps, fetchImpl, requestDefault, readJevApiKey };
}
const run = (deps: ProviderRouterDeps<AutoReviewRequest>) => createAutoReviewProviderRouter(deps)(request, 'legacy prompt', {
  signal: new AbortController().signal,
});

describe('optional Jev Auto-review provider', () => {
  it('keeps the original provider as the default without touching TypeSafe credentials', async () => {
    const env = setup(); env.state.provider = 'default';
    expect(await run(env.deps)).toBe('{"verdict":"allow","reason":"legacy"}');
    expect(env.requestDefault).toHaveBeenCalledOnce();
    expect(env.readJevApiKey).not.toHaveBeenCalled();
    expect(env.fetchImpl).not.toHaveBeenCalled();
  });
  it.each(['allow', 'ask', 'block'] as const)('does not fall back after a valid Jev %s', async (verdict) => {
    const env = setup(verdict);
    expect(JSON.parse((await run(env.deps))!).verdict).toBe(verdict);
    expect(env.fetchImpl).toHaveBeenCalledOnce();
    expect(env.requestDefault).not.toHaveBeenCalled();
  });
  it('asks when the model allows but its independent context judgment is insufficient', async () => {
    const env = setup('allow', false);
    const result = JSON.parse((await run(env.deps))!);
    expect(result.verdict).toBe('ask'); expect(result.unavailable).toBeUndefined();
    expect(env.requestDefault).not.toHaveBeenCalled();
  });
  it('invalidates an in-flight result on owner changes', async () => {
    const env = setup();
    env.fetchImpl.mockImplementation(async () => {
      env.state.owner = 'other:2'; return new Response(JSON.stringify(answer()));
    });
    expect(await run(env.deps)).toBeNull();
  });
  it('uses actual full paths rather than the legacy display-budget strings', () => {
    const longRoot = `/repo/${'a'.repeat(700)}`;
    const result = prepare({ ...request, workspaceRoots: [longRoot, '/reference'], writableRoots: [longRoot] });
    expect(result.ok).toBe(true);
    if (!result.ok) throw Error('Expected valid context');
    expect(result.input.evidence.workspaceRoot).toBe(longRoot);
    expect(result.input.evidence.defaultWritableRoots).toEqual([longRoot]);
    expect(result.input.evidence.readOnlyReferenceRoots).toEqual(['/reference']);
  });
  it('preserves omission and the existing direct-owner Host contract', () => {
    const result = prepare({ ...request, authorizationContext: undefined,
      userIntent: { earlierUserMessages: [], currentUserMessage: 'Continue', historyOmitted: true } });
    expect(result.ok).toBe(true);
    if (!result.ok) throw Error('Expected valid context');
    expect(result.input.evidence.userIntent).toMatchObject({ historyOmitted: true });
    expect(result.input.evidence.authorizationContext).toMatchObject({ requesterAuthority: 'owner' });
  });
  it('shares semantic policy but does not ask Jev to generate JSON or reasoning prose', () => {
    const policy = buildAutoPermissionReviewPolicy();
    expect(policy).toContain('historyOmitted');
    expect(policy).toContain('Guest/unknown');
    expect(policy).not.toContain('Return exactly one compact JSON object');
  });
});
