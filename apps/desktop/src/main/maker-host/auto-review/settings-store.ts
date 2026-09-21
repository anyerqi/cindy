import fs from 'node:fs';
import path from 'node:path';
import { activeOwnerScopeKey, getActiveAppSession, isAppSessionBoundaryPending,
  ownerScopedUserDataPath } from '../../appSessionState.js';
import { withCrossProcessLock } from '../../device-link/crossProcessLock.js';
import { getProviderSecretStore } from '../../secrets/providerSecretStore.js';
import { desktopMakerLogger } from '../logger-adapter.js';
import { createOverrideSettingsFile } from '../override-settings-file.js';
import type { AutoReviewProvider } from '../../../shared/autoReviewSettings.js';
import { createAutoReviewSettingsService, type StoredAutoReviewSettings } from './settings-service.js';

const KEY_ID = 'typesafe-auto-review' as const;
const FILE = 'auto-review-settings.json';
const LIMIT = 4_096;
const defaults = { provider: 'default' as AutoReviewProvider, nonce: '' };
const listeners = new Set<() => void>();
export function onAutoReviewSettingsChanged(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
function notify() { for (const listener of listeners) { try { listener(); } catch { /* isolated subscriber */ } } }
function normalize(raw: unknown) {
  const record = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  return {
    provider: record.provider === 'jev' ? 'jev' as const : 'default' as const,
    nonce: typeof record.nonce === 'string' ? record.nonce : '',
  };
}

/** Corrupt config is NOT consent to fall back to another provider. */
function readFile(file: string): StoredAutoReviewSettings {
  try {
    if (fs.statSync(file).size > LIMIT) throw new Error('invalid');
    const text = fs.readFileSync(file, 'utf8');
    if (Buffer.byteLength(text, 'utf8') > LIMIT) throw new Error('invalid');
    const raw: unknown = JSON.parse(text);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('invalid');
    const value = raw as Record<string, unknown>;
    if (Object.keys(value).some((key) => !['provider', 'nonce'].includes(key))
      || (value.provider !== undefined && value.provider !== 'default' && value.provider !== 'jev')
      || (value.nonce !== undefined && (typeof value.nonce !== 'string' || value.nonce.length > 64))) {
      throw new Error('invalid');
    }
    return { ...normalize(raw), valid: true, isCustomized: Object.hasOwn(value, 'provider') };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { ...defaults, valid: true, isCustomized: false };
    }
    return { provider: null, nonce: 'unreadable', valid: false, isCustomized: true };
  }
}
let service: ReturnType<typeof createAutoReviewSettingsService> | undefined;
export function getAutoReviewSettingsService() {
  service ??= createAutoReviewSettingsService({
    changed: notify,
    captureScope() {
      if (isAppSessionBoundaryPending() || !getActiveAppSession().dataOwnerId) return null;
      const id = activeOwnerScopeKey();
      const file = ownerScopedUserDataPath(FILE);
      // No filesystem or credential access at module import/startup.
      const store = createOverrideSettingsFile({
        filePath: () => file, defaults, normalize,
        label: 'auto-review', log: desktopMakerLogger,
        scopeKey: activeOwnerScopeKey, maxBytes: LIMIT,
        preserveUnreadableFile: true, logLoadedValue: false, logReadErrorDetails: false,
      });
      return {
        id,
        readSettings: () => readFile(file),
        readKey: () => getProviderSecretStore().get(KEY_ID),
        writeKey: (value) => getProviderSecretStore().set(KEY_ID, value),
        removeKey: () => getProviderSecretStore().remove(KEY_ID).success,
        writeSettings: (provider, nonce) => store.writePatch({ provider, nonce }, { preserveDefaults: true }),
        resetSettings: () => { store.reset(); },
        async lock(task) {
          fs.mkdirSync(path.dirname(file), { recursive: true });
          return withCrossProcessLock(`${file}.lock`, { label: 'auto-review-settings', waitMs: 12_000 }, async (status) => {
            if (!status.held || isAppSessionBoundaryPending() || activeOwnerScopeKey() !== id) {
              throw new Error('settings unavailable');
            }
            return task();
          });
        },
      };
    },
  });
  return service;
}
