import { describe, expect, it } from 'vitest';
import { createAutoReviewSettingsService, type AutoReviewSettingsDeps, type StoredAutoReviewSettings } from '../settings-service.js';
import { createAutoReviewSettingsHandler } from '../settings-handler.js';

function fixture() {
  let owner: string | null = 'owner-a:1';
  let key: string | null = null;
  let settings: StoredAutoReviewSettings = { provider: 'default', nonce: '', valid: true, isCustomized: false };
  let gate: Promise<void> | undefined;
  let keyReads = 0;
  const deps: AutoReviewSettingsDeps = {
    changed() {},
    captureScope() {
      if (!owner) return null;
      return {
        id: owner,
        readSettings: () => ({ ...settings }),
        readKey() { keyReads++; return key; },
        writeKey(value) { key = value; return true; },
        removeKey() { key = null; return true; },
        writeSettings(provider, nonce) { settings = { provider, nonce, valid: true, isCustomized: true }; },
        resetSettings() { settings = { provider: 'default', nonce: '', valid: true, isCustomized: false }; },
        async lock<T>(task: () => T): Promise<T> { if (gate) await gate; return task(); },
      };
    },
  };
  const service = createAutoReviewSettingsService(deps);
  return { service, setOwner: (value: string | null) => { owner = value; },
    setGate: (value: Promise<void>) => { gate = value; },
    corrupt: () => { settings = { provider: null, nonce: 'bad', valid: false, isCustomized: true }; },
    key: () => key, reads: () => keyReads, replaceKeyExternally: (value: string | null) => { key = value; },
    input: () => ({ provider: 'jev' as const, apiKey: 'fake-typesafe-key', expectedRevision: service.get().revision }),
  };
}

describe('client-only Auto-review settings', () => {
  it('defaults to the original reviewer without probing optional credentials', () => {
    const f = fixture(); expect(f.service.readProvider()).toBe('default');
    expect(f.service.routingStamp()).toMatch(/^[a-f0-9]{64}$/); expect(f.reads()).toBe(0);
  });
  it('requires a key before enabling Jev and never returns its plaintext', async () => {
    const f = fixture();
    await expect(f.service.save({ provider: 'jev', expectedRevision: f.service.get().revision })).rejects.toMatchObject({ code: 'key_required' });
    const saved = await f.service.save(f.input());
    expect(saved).toMatchObject({ provider: 'jev', hasApiKey: true });
    expect(JSON.stringify(saved)).not.toContain('fake-typesafe-key');
  });
  it.each(['', ' ', 'fake\nheader', 'x'.repeat(4097)])('rejects invalid key input %#', async (value) => {
    const f = fixture(); await expect(f.service.save({ ...f.input(), apiKey: value })).rejects.toMatchObject({ code: 'invalid_input' });
    expect(f.key()).toBeNull();
  });
  it('keeps encrypted key on reset but removes it on explicit deletion', async () => {
    const f = fixture(); await f.service.save(f.input());
    await f.service.reset({ expectedRevision: f.service.get().revision });
    expect(f.service.get()).toMatchObject({ provider: 'default', isCustomized: false, hasApiKey: true });
    await f.service.deleteKey({ expectedRevision: f.service.get().revision });
    expect(f.key()).toBeNull();
  });
  it('rejects stale forms instead of overwriting a newer window', async () => {
    const f = fixture(); const input = f.input(); await f.service.save(input);
    await expect(f.service.save(input)).rejects.toMatchObject({ code: 'stale' });
  });
  it('rejects owner changes while waiting for the shared lock', async () => {
    const f = fixture(); const input = f.input(); let release!: () => void;
    f.setGate(new Promise<void>((resolve) => { release = resolve; }));
    const pending = f.service.save(input); f.setOwner('owner-b:2'); release();
    await expect(pending).rejects.toMatchObject({ code: 'stale' }); expect(f.key()).toBeNull();
  });
  it('invalidates captured requests even when only the key changes', async () => {
    const f = fixture(); await f.service.save(f.input()); const lease = f.service.captureReview();
    await f.service.save({ ...f.input(), apiKey: 'fake-next-key' });
    expect(lease.isCurrent()).toBe(false); expect(lease.signal.aborted).toBe(true); lease.release();
  });
  it('does not silently use another provider for corrupt configuration', async () => {
    const f = fixture(); f.corrupt(); expect(f.service.readProvider()).toBeNull();
    await f.service.reset({ expectedRevision: f.service.get().revision }); expect(f.service.readProvider()).toBe('default');
  });
  it('checks caller trust again inside the write lock', async () => {
    const f = fixture(); const input = f.input(); let trusted = true; let release!: () => void;
    f.setGate(new Promise<void>((resolve) => { release = resolve; }));
    const handler = createAutoReviewSettingsHandler<object>({
      assertTrusted() { if (!trusted) throw new Error('untrusted'); },
      load: async () => f.service, notify() {}, fail(code) { throw new Error(code); },
    });
    const pending = handler('save')({}, input); await Promise.resolve(); trusted = false; release();
    await expect(pending).rejects.toThrow('INTERNAL'); expect(f.key()).toBeNull();
  });
});


describe('external Jev credential revision', () => {
  it.each(['fake-rotated-key', null])('retires cached and pending decisions after an external key change (%s)', async nextKey => {
    const f = fixture(); await f.service.save(f.input());
    const before = f.service.routingStamp(); const lease = f.service.captureReview();
    try {
      f.replaceKeyExternally(nextKey);
      expect(f.service.routingStamp()).not.toBe(before);
      expect(lease.isCurrent()).toBe(false);
    } finally { lease.release(); }
  });
  it('does not read the optional key for original mode even if another process changes it', () => {
    const f = fixture(); const before = f.service.routingStamp();
    f.replaceKeyExternally('fake-external-key');
    expect(f.service.routingStamp()).toBe(before);
    expect(f.reads()).toBe(0);
  });
});
