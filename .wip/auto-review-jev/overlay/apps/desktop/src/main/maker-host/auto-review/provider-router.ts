import type { PreparedJevInput } from './jev-context.js';
import type { ReviewResult, TypeSafeOptions } from './jev-transport.js';
import { requestTypeSafeAutoReview } from './jev-transport.js';

export type AutoReviewProvider = 'default' | 'jev';
export const DEFAULT_AUTO_REVIEW_PROVIDER: AutoReviewProvider = 'default';
/** Unknown explicit configuration must not silently send evidence to another provider. */
export function parseAutoReviewProvider(value: unknown): AutoReviewProvider | null {
  if (value === undefined || value === null || value === '') return DEFAULT_AUTO_REVIEW_PROVIDER;
  return value === 'default' || value === 'jev' ? value : null;
}
interface Logger {
  debug(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
}
export interface ProviderRouterDeps<Request> {
  readProvider(): AutoReviewProvider | null;
  /** Changes on logout/owner transition; the pending boundary returns null. */
  ownerStamp(): string | null;
  /** Key-free configuration stamp, including the owner generation. */
  configStamp?(): string | null;
  subscribeChanges?(listener: () => void): () => void;
  requestDefault(prompt: string, signal?: AbortSignal): Promise<string | null>;
  prepareJev(request: Request): PreparedJevInput;
  readJevApiKey(): string | null;
  fetchImpl: typeof fetch;
  logger: Logger;
  requestJev?: typeof requestTypeSafeAutoReview;
  /** Test seams, not a public route/config interface. */
  attemptTimeoutMs?: number;
  retryBackoffMs?: number;
}

function wait(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => { clearTimeout(timer); signal.removeEventListener('abort', done); resolve(); };
    const timer = setTimeout(done, ms);
    signal.addEventListener('abort', done, { once: true });
  });
}

/**
 * Model/provider selection lives outside the legacy candidate chain. An explicit Jev
 * selection never falls back to a gateway/subscription and never shops for an allow.
 * Null means service/config unavailable; a valid evidence/uncertainty ask is real JSON.
 */
export function createAutoReviewProviderRouter<Request>(deps: ProviderRouterDeps<Request>) {
  return async (request: Request, prompt: string, parentContext: { signal: AbortSignal }): Promise<string | null> => {
    const controller = new AbortController();
    const abort = () => controller.abort();
    if (parentContext.signal.aborted) abort();
    else parentContext.signal.addEventListener('abort', abort, { once: true });
    const unsubscribe = deps.subscribeChanges?.(abort);
    const context = { signal: controller.signal };
    try {
      const selected = deps.readProvider();
      // Keep the legacy chain unchanged; do not read the optional TypeSafe credential here.
      if (selected === 'default') {
        const config = deps.configStamp?.();
        if (context.signal.aborted || config === null) return null;
        const result = await deps.requestDefault(prompt, context.signal);
        return !context.signal.aborted && deps.readProvider() === 'default'
          && (!deps.configStamp || deps.configStamp() === config) ? result : null;
      }
      if (selected === null) {
        deps.logger.warn('auto-review provider configuration invalid');
        return null;
      }
      const stamp = deps.ownerStamp();
      const isCurrent = () => !context.signal.aborted && stamp !== null
        && deps.ownerStamp() === stamp && deps.readProvider() === selected;
      if (!isCurrent()) return null;
      const prepared = deps.prepareJev(request);
      if (!prepared.ok) {
        deps.logger.debug('jev auto-review context unavailable', { reason: prepared.reason });
        return isCurrent() ? JSON.stringify({
          verdict: 'ask', reason: 'The complete context required for this review is unavailable.',
        }) : null;
      }
      let apiKey: string | null;
      try { apiKey = deps.readJevApiKey(); } catch { apiKey = null; }
      if (!apiKey || !isCurrent()) {
        deps.logger.warn('jev auto-review credential unavailable');
        return null;
      }
      const requestJev = deps.requestJev ?? requestTypeSafeAutoReview;
      const options: TypeSafeOptions = {
        apiKey, fetchImpl: deps.fetchImpl, signal: context.signal,
        // Two 6-second attempts + at most 5 seconds backoff fit below the unchanged 53-second host guard.
        timeoutMs: deps.attemptTimeoutMs ?? 6_000,
      };
      for (let attempt = 1; attempt <= 2; attempt++) {
        if (!isCurrent()) return null;
        let result: ReviewResult;
        try { result = await requestJev(prepared.input, options); }
        catch { result = { ok: false, reason: 'request_failed', retryable: true }; }
        if (!isCurrent()) return null;
        if (result.ok) {
          deps.logger.debug('jev auto-review completed', {
            attempt, model: result.diagnostics.model, verdict: result.decision.verdict,
            reviewStatus: result.reviewStatus,
            allowProbability: result.diagnostics.probabilities.allow,
            contextProbability: result.diagnostics.context.probabilities.sufficient,
            inputTokens: result.diagnostics.usage.input_tokens,
          });
          return JSON.stringify(result.decision);
        }
        deps.logger.warn('jev auto-review attempt failed', {
          attempt, reason: result.reason, httpStatus: result.httpStatus,
        });
        if (result.reason === 'invalid_input') {
          return JSON.stringify({ verdict: 'ask', reason: 'The review context exceeds the supported request budget.' });
        }
        if (attempt === 2 || !result.retryable || result.reason === 'cancelled') return null;
        const delayMs = result.retryAfterMs ?? deps.retryBackoffMs ?? 500;
        // Do not retry earlier than the server requested, or hold permission callbacks
        // indefinitely for a long rate-limit window. Hand the action to the user instead.
        if (!Number.isFinite(delayMs) || delayMs < 0 || delayMs > 5_000) return null;
        await wait(delayMs, context.signal);
      }
      return null;
    } finally {
      unsubscribe?.();
      parentContext.signal.removeEventListener('abort', abort);
    }
  };
}
