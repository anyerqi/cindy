import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import type { AutoReviewProvider, AutoReviewSettingsView } from '../../../shared/autoReviewSettings.js';

export type SettingsErrorCode = 'invalid_input' | 'key_required' | 'stale' | 'unavailable' | 'storage_failed';
export class AutoReviewSettingsError extends Error {
  constructor(readonly code: SettingsErrorCode) {
    super(code);
    this.name = 'AutoReviewSettingsError';
  }
}
export interface StoredAutoReviewSettings {
  provider: AutoReviewProvider | null;
  nonce: string;
  isCustomized: boolean;
  valid: boolean;
}
export interface AutoReviewSettingsScope {
  /** Main-derived owner/generation, never supplied by the renderer. */
  id: string;
  readSettings(): StoredAutoReviewSettings;
  readKey(): string | null;
  writeKey(value: string): boolean;
  removeKey(): boolean;
  writeSettings(provider: AutoReviewProvider, nonce: string): void;
  resetSettings(): void;
  /** Serializes settings AND credentials across processes sharing the same owner. */
  lock<T>(task: () => T): Promise<T>;
}
export interface AutoReviewSettingsDeps {
  captureScope(): AutoReviewSettingsScope | null;
  changed(): void;
}
function fail(code: SettingsErrorCode): never { throw new AutoReviewSettingsError(code); }
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail('invalid_input');
  return value as Record<string, unknown>;
}
function expected(raw: Record<string, unknown>, keys: string[]): string {
  if (Object.keys(raw).some((key) => !keys.includes(key))) return fail('invalid_input');
  if (typeof raw.expectedRevision !== 'string' || !/^[a-f0-9]{64}$/.test(raw.expectedRevision)) return fail('invalid_input');
  return raw.expectedRevision;
}
function keyValue(value: unknown): string {
  if (typeof value !== 'string' || value.length > 4_096) return fail('invalid_input');
  const key = value.trim();
  if (!key || !/^[\x21-\x7e]+$/.test(key)) return fail('invalid_input');
  return key;
}

/**
 * Pure settings orchestration with injectable encrypted IO. All secret writes are
 * synchronous inside the owner-bound lock, so an account switch cannot interleave them.
 * The keyed digest below is an opaque form token, not a reusable hash of an API key.
 */
export function createAutoReviewSettingsService(deps: AutoReviewSettingsDeps) {
  const tokenKey = randomBytes(32);
  let epoch = 0;
  const controllers = new Set<AbortController>();
  const activeScope = (): AutoReviewSettingsScope => deps.captureScope() ?? fail('unavailable');
  const checkScope = (scope: AutoReviewSettingsScope) => {
    if (deps.captureScope()?.id !== scope.id) fail('stale');
  };
  const invalidate = () => {
    epoch++;
    for (const controller of controllers) controller.abort();
    // Notification errors cannot change the success/failure of a completed write.
    try { deps.changed(); } catch { /* UI will re-read on the next action. */ }
  };
  function snapshot(scope: AutoReviewSettingsScope) {
    checkScope(scope);
    const settings = scope.readSettings();
    const apiKey = scope.readKey();
    checkScope(scope);
    const revision = createHmac('sha256', tokenKey)
      .update(JSON.stringify([scope.id, settings, apiKey, epoch])).digest('hex');
    const view: AutoReviewSettingsView = {
      provider: settings.valid ? settings.provider : null,
      isCustomized: settings.isCustomized,
      configurationError: !settings.valid,
      hasApiKey: !!apiKey,
      revision,
    };
    return { view, apiKey };
  }
  async function mutate(raw: unknown, kind: 'save' | 'reset' | 'deleteKey', validateCaller: () => void): Promise<AutoReviewSettingsView> {
    const input = object(raw);
    const revision = expected(input, kind === 'save'
      ? ['expectedRevision', 'provider', 'apiKey'] : ['expectedRevision']);
    const provider = input.provider;
    let newKey: string | undefined;
    if (kind === 'save') {
      if (provider !== 'default' && provider !== 'jev') return fail('invalid_input');
      if (Object.hasOwn(input, 'apiKey')) {
        if (provider !== 'jev') return fail('invalid_input');
        newKey = keyValue(input.apiKey);
      }
    }
    const scope = activeScope();
    try {
      return await scope.lock(() => {
        checkScope(scope);
        validateCaller();
        const current = snapshot(scope);
        if (current.view.revision !== revision) return fail('stale');
        if (kind === 'save' && current.view.configurationError) return fail('unavailable');
        if (kind === 'save' && provider === 'jev' && !(newKey ?? current.apiKey)) return fail('key_required');
        // Cancel in-flight decisions BEFORE touching either persisted state. Even a
        // partial storage failure must not let a previous allow survive a key rotation.
        epoch++;
        for (const controller of controllers) controller.abort();
        try {
          if (kind === 'deleteKey') {
            if (!scope.removeKey()) return fail('storage_failed');
            scope.resetSettings();
          } else if (kind === 'reset') {
            scope.resetSettings(); // Removing an override is not deleting a credential.
          } else {
            if (newKey !== undefined && !scope.writeKey(newKey)) return fail('storage_failed');
            scope.writeSettings(provider as AutoReviewProvider, randomUUID());
          }
        } catch (error) {
          if (error instanceof AutoReviewSettingsError) throw error;
          return fail('storage_failed');
        } finally {
          invalidate();
        }
        return snapshot(scope).view;
      });
    } catch (error) {
      if (error instanceof AutoReviewSettingsError) throw error;
      return fail('storage_failed');
    }
  }
  return {
    get(): AutoReviewSettingsView { return snapshot(activeScope()).view; },
    save: (raw: unknown, validateCaller: () => void = () => {}) => mutate(raw, 'save', validateCaller),
    reset: (raw: unknown, validateCaller: () => void = () => {}) => mutate(raw, 'reset', validateCaller),
    deleteKey: (raw: unknown, validateCaller: () => void = () => {}) => mutate(raw, 'deleteKey', validateCaller),
    /** Default-mode lookup does NOT unlock/read the optional Jev credential. */
    readProvider(): AutoReviewProvider | null {
      const scope = deps.captureScope();
      if (!scope) return null;
      const settings = scope.readSettings();
      return settings.valid ? settings.provider : null;
    },
    /** Non-secret stamp used to retire even legacy decisions when selection changes. */
    routingStamp(): string | null {
      const scope = deps.captureScope();
      if (!scope) return null;
      return createHmac('sha256', tokenKey)
        .update(JSON.stringify([scope.id, scope.readSettings(), epoch])).digest('hex');
    },
    /** Bind one Jev request to an immutable owner + settings + credential snapshot. */
    captureReview() {
      const scope = activeScope();
      const initial = snapshot(scope);
      const controller = new AbortController();
      controllers.add(controller);
      return {
        apiKey: initial.apiKey,
        provider: initial.view.provider,
        signal: controller.signal,
        isCurrent(): boolean {
          if (controller.signal.aborted) return false;
          try { return snapshot(scope).view.revision === initial.view.revision; }
          catch { return false; }
        },
        release(): void { controllers.delete(controller); },
      };
    },
  };
}
