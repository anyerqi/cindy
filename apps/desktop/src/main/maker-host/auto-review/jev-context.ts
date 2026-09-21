/** Context projection only. This module neither retrieves files nor invents consent. */
export type JsonValue = null | boolean | number | string
  | readonly JsonValue[] | { readonly [key: string]: JsonValue };
export interface AuthorizationContext {
  requesterAuthority: 'owner' | 'guest' | 'unknown';
  source: 'group' | 'direct';
}
export interface HostContext {
  workspaceRoots: readonly string[];
  writableRoots?: readonly string[];
  authorizationContext?: AuthorizationContext;
}
export interface JevInput {
  trustedPolicy: string;
  evidence: { readonly [key: string]: JsonValue };
}
export type PreparedJevInput = { ok: true; input: JevInput }
  | { ok: false; reason: 'invalid_context' | 'context_over_budget' };
export const MAX_JEV_STATE_BYTES = 24_576;

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function strings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}
function validIntent(value: unknown): boolean {
  if (typeof value === 'string') return true;
  return record(value) && strings(value.earlierUserMessages)
    && typeof value.currentUserMessage === 'string'
    && (value.historyOmitted === undefined || value.historyOmitted === true);
}
function validAuthority(value: unknown): value is AuthorizationContext {
  return record(value)
    && ['owner', 'guest', 'unknown'].includes(value.requesterAuthority as string)
    && ['group', 'direct'].includes(value.source as string);
}

/**
 * payload comes ONLY from buildAutoPermissionReviewInput(request), not renderer/tool text.
 * HostContext comes from the same request. Recover complete path evidence rather than
 * forwarding the legacy renderer-oriented 512-character path compaction to Jev.
 * Keep the existing atomic user-intent budget and omission marker; no transcript fetch.
 */
export function prepareJevReviewInput(
  trustedPolicy: string,
  payload: unknown,
  context: HostContext,
): PreparedJevInput {
  try {
    if (typeof trustedPolicy !== 'string' || !trustedPolicy.trim() || !record(payload)
      || !validIntent(payload.userIntent) || !record(payload.action)
      || !['read', 'session-state', 'file-write', 'exec', 'network', 'other'].includes(payload.action.kind as string)
      || typeof payload.platform !== 'string' || !payload.platform
      || !strings(context.workspaceRoots)
      || context.workspaceRoots.some((root) => !root.trim())
      || (context.writableRoots !== undefined && (!strings(context.writableRoots)
        || context.writableRoots.some((root) => !root.trim())))
      || (context.authorizationContext !== undefined && !validAuthority(context.authorizationContext))
      || (payload.precedingBlockedActions !== undefined
        && (!Array.isArray(payload.precedingBlockedActions) || payload.precedingBlockedActions.length > 3))) {
      return { ok: false, reason: 'invalid_context' };
    }
    const authority = context.authorizationContext
      ?? (validAuthority(payload.authorizationContext) ? payload.authorizationContext : undefined);
    const currentText = typeof payload.userIntent === 'string' ? payload.userIntent
      : (payload.userIntent as Record<string, unknown>).currentUserMessage as string;
    const currentOmitted = currentText === 'User message omitted because it exceeds the review budget; it cannot establish authorization.';
    const writableRoots = [...(context.writableRoots ?? context.workspaceRoots.slice(0, 1))];
    const writableSet = new Set(writableRoots);
    // Explicit projection: never spread the request or include session data/secrets.
    const evidence = {
      userIntent: typeof payload.userIntent === 'string' ? payload.userIntent : {
        earlierUserMessages: (payload.userIntent as Record<string, unknown>).earlierUserMessages,
        currentUserMessage: (payload.userIntent as Record<string, unknown>).currentUserMessage,
        ...((payload.userIntent as Record<string, unknown>).historyOmitted === true ? { historyOmitted: true } : {}),
      },
      action: payload.action,
      ...(payload.precedingBlockedActions === undefined ? {} : {
        precedingBlockedActions: payload.precedingBlockedActions,
      }),
      authorizationContext: authority ?? {
        requesterAuthority: 'unknown', source: 'direct',
      },
      workspaceRoot: context.workspaceRoots[0] ?? '',
      defaultWritableRoots: writableRoots,
      readOnlyReferenceRoots: context.workspaceRoots.filter((root) => !writableSet.has(root)),
      platform: payload.platform,
      contextCoverage: {
        userHistory: currentOmitted || (record(payload.userIntent) && payload.userIntent.historyOmitted === true)
          ? 'omitted' : 'bounded',
        currentUserMessage: currentOmitted ? 'omitted' : currentText.trim() ? 'present' : 'empty',
        requesterAuthority: context.authorizationContext ? 'host_verified' : authority ? 'legacy_host_default' : 'not_provided',
        attachments: 'not_included',
        assistantHistory: 'not_included',
        toolResults: 'not_included',
        fileContents: 'not_included',
        pathEvidence: context.workspaceRoots.length ? 'complete_as_supplied_by_host' : 'roots_not_provided',
      },
    };
    const text = JSON.stringify(evidence);
    if (new TextEncoder().encode(text).byteLength > MAX_JEV_STATE_BYTES) {
      return { ok: false, reason: 'context_over_budget' };
    }
    // Snapshot protects in-flight evidence from subsequent mutation by its owner.
    return { ok: true, input: { trustedPolicy, evidence: JSON.parse(text) as JevInput['evidence'] } };
  } catch {
    return { ok: false, reason: 'invalid_context' };
  }
}
