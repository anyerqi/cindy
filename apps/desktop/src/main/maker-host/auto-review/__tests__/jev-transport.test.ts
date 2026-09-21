import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildTypeSafeReviewRequest, parseTypeSafeReviewResponse, requestTypeSafeAutoReview,
  TYPESAFE_AUTO_REVIEW_MODEL, TYPESAFE_SYSTEM_ONE_ENDPOINT } from '../jev-transport.js';
import { prepareJevReviewInput } from '../jev-context.js';
import { buildAutoPermissionReviewInput, buildAutoPermissionReviewPolicy } from '../../auto-permission-reviewer.js';
import type { AutoReviewRequest } from '@cindy/maker-core';
const request: AutoReviewRequest = { agentKind: 'codex', model: 'task-model', userIntent: 'Run tests; do not deploy.',
  action: { kind: 'exec', command: 'pnpm test' }, workspaceRoots: ['/repo'], platform: 'linux' };
function input() {
  const value = prepareJevReviewInput(buildAutoPermissionReviewPolicy(), buildAutoPermissionReviewInput(request), request);
  if (!value.ok) throw new Error('Invalid fixture');
  return value.input;
}
function response(verdict: 'allow' | 'block' | 'ask' = 'allow', sufficient = true) {
  return { model: TYPESAFE_AUTO_REVIEW_MODEL, usage: { input_tokens: 100, output_tokens: 60 }, answers: {
    decision: { type: 'choice', choice: verdict, confidence: 1, probabilities: { allow: Number(verdict === 'allow'),
      block: Number(verdict === 'block'), ask: Number(verdict === 'ask') } },
    context: { type: 'choice', choice: sufficient ? 'sufficient' : 'insufficient', confidence: 1,
      probabilities: { sufficient: Number(sufficient), insufficient: Number(!sufficient) } },
  } };
}
afterEach(() => vi.useRealTimers());
describe('Jev native HTTP contract', () => {
  it('sends only typed judgments and the bounded evidence to the fixed endpoint', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(response())));
    expect(await requestTypeSafeAutoReview(input(), { apiKey: 'fake-key', fetchImpl })).toMatchObject({ ok: true, decision: { verdict: 'allow' } });
    expect(fetchImpl).toHaveBeenCalledWith(TYPESAFE_SYSTEM_ONE_ENDPOINT, expect.objectContaining({
      method: 'POST', redirect: 'error', credentials: 'omit', headers: { Authorization: 'Bearer fake-key', 'Content-Type': 'application/json' },
      body: JSON.stringify(buildTypeSafeReviewRequest(input())),
    }));
    expect(buildTypeSafeReviewRequest(input()).model).toBe(TYPESAFE_AUTO_REVIEW_MODEL);
  });
  it.each(['allow', 'block', 'ask'] as const)('preserves a valid %s without inventing reasoning text', verdict => {
    expect(parseTypeSafeReviewResponse(response(verdict))).toMatchObject({ ok: true, decision: { verdict } });
  });
  it('separates insufficient context and uncertain permission from infrastructure failure', () => {
    expect(parseTypeSafeReviewResponse(response('allow', false))).toMatchObject({ ok: true, decision: { verdict: 'ask' }, reviewStatus: 'insufficient_context' });
    const value = response(); value.answers.decision.probabilities = { allow: 0.8, block: 0.1, ask: 0.1 };
    expect(parseTypeSafeReviewResponse(value)).toMatchObject({ ok: true, decision: { verdict: 'ask' }, reviewStatus: 'uncertain' });
    expect(parseTypeSafeReviewResponse(response('block', false))).toMatchObject({ ok: true, decision: { verdict: 'block' } });
  });
  it.each([NaN, Infinity, -1, 2])('rejects an invalid probability: %s', probability => {
    const value = response(); value.answers.decision.probabilities.allow = probability;
    expect(parseTypeSafeReviewResponse(value)).toMatchObject({ ok: false, reason: 'malformed_response' });
  });
  it('rejects missing answers, inconsistent distributions, and invalid usage', () => {
    expect(parseTypeSafeReviewResponse({ ...response(), answers: {} })).toMatchObject({ ok: false });
    const value = response(); value.answers.decision.probabilities.ask = 0.5;
    expect(parseTypeSafeReviewResponse(value)).toMatchObject({ ok: false });
    expect(parseTypeSafeReviewResponse({ ...response(), usage: { input_tokens: -1, output_tokens: 1 } })).toMatchObject({ ok: false });
  });
  it.each([[401, false], [403, false], [429, true], [500, true]] as const)('classifies HTTP %s without exposing the body', async (status, retryable) => {
    const fetchImpl = vi.fn(async () => new Response('fake-key private evidence', { status }));
    const value = await requestTypeSafeAutoReview(input(), { apiKey: 'fake-key', fetchImpl });
    expect(value).toMatchObject({ ok: false, reason: 'http_error', httpStatus: status, retryable });
    expect(JSON.stringify(value)).not.toContain('fake-key');
  });
  it('cancels in-flight requests and does not issue an already cancelled one', async () => {
    const controller = new AbortController(); const fetchImpl = vi.fn(() => new Promise<Response>(() => {}));
    const pending = requestTypeSafeAutoReview(input(), { apiKey: 'fake-key', fetchImpl, signal: controller.signal });
    controller.abort(); expect(await pending).toMatchObject({ ok: false, reason: 'cancelled' });
    await requestTypeSafeAutoReview(input(), { apiKey: 'fake-key', fetchImpl, signal: controller.signal });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });
  it('bounds a non-cooperative network request by its deadline', async () => {
    vi.useFakeTimers();
    const pending = requestTypeSafeAutoReview(input(), { apiKey: 'fake-key', fetchImpl: () => new Promise<Response>(() => {}), timeoutMs: 50 });
    await vi.advanceTimersByTimeAsync(50);
    expect(await pending).toMatchObject({ ok: false, reason: 'timeout' });
  });
  it('rejects malformed or oversized success bodies', async () => {
    for (const body of ['not json', 'x'.repeat(40_000)]) {
      expect(await requestTypeSafeAutoReview(input(), { apiKey: 'fake-key', fetchImpl: async () => new Response(body) })).toMatchObject({ ok: false, reason: 'malformed_response' });
    }
  });
});
