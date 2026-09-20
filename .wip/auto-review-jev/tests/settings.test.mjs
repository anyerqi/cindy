import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createAutoReviewSettingsService } from '../dist/main/maker-host/auto-review/settings-service.js';
import { createAutoReviewSettingsHandler } from '../dist/main/maker-host/auto-review/settings-handler.js';
import { createAutoReviewProviderRouter } from '../dist/main/maker-host/auto-review/provider-router.js';
import { createAutoReviewSettingsBridge } from '../dist/preload/autoReviewSettingsBridge.js';
import { AUTO_REVIEW_SETTINGS } from '../dist/shared/autoReviewSettings.js';
import { prepareJevReviewInput } from '../dist/main/maker-host/auto-review/jev-context.js';

const emptySettings = () => ({ provider: 'default', nonce: '', valid: true, isCustomized: false });
function deferred() { let resolve; const promise = new Promise(r => resolve = r); return { promise, resolve }; }
function fixture() {
  const records = new Map();
  let owner = 'owner-A:1'; let gate; let changed = 0; let reads = 0;
  const listeners = new Set();
  const current = () => {
    if (!records.has(owner)) records.set(owner, { settings: emptySettings(), key: null });
    return records.get(owner);
  };
  const deps = {
    changed() { changed++; for (const listener of listeners) listener(); },
    captureScope() {
      if (!owner) return null;
      const id = owner; const row = current();
      return {
        id,
        readSettings: () => structuredClone(row.settings),
        readKey: () => { reads++; return row.key; },
        writeKey: value => { if (row.failKey) return false; row.key = value; return true; },
        removeKey: () => { if (row.failDelete) return false; row.key = null; return true; },
        writeSettings(provider, nonce) { if (row.failSettings) throw Error('secret must not leak'); row.settings = { provider, nonce, valid: true, isCustomized: true }; },
        resetSettings() { if (row.failSettings) throw Error('secret must not leak'); row.settings = emptySettings(); },
        async lock(task) { if (gate) await gate.promise; return task(); },
      };
    },
  };
  const service = createAutoReviewSettingsService(deps);
  return { service, deps, row: current, records, listeners,
    owner: v => { owner = v; }, gate: v => { gate = v; },
    reads: () => reads, changed: () => changed };
}
const patch = (f, provider = 'jev', apiKey = 'fake-typesafe-key') => ({
  provider, expectedRevision: f.service.get().revision, ...(apiKey === undefined ? {} : { apiKey }),
});
const rejects = (p, code) => assert.rejects(p, e => e.code === code && e.message === code);

test('unset mode is original and runtime mode lookup does not unlock the key', () => {
  const f = fixture();
  assert.equal(f.service.readProvider(), 'default');
  assert.match(f.service.routingStamp(), /^[a-f0-9]{64}$/);
  assert.equal(f.reads(), 0);
  assert.equal(f.service.get().isCustomized, false);
});
test('Jev save requires its own key; the safe view never returns plaintext', async () => {
  const f = fixture();
  await rejects(f.service.save({ provider: 'jev', expectedRevision: f.service.get().revision }), 'key_required');
  const view = await f.service.save(patch(f));
  assert.equal(view.provider, 'jev'); assert.equal(view.hasApiKey, true);
  assert.deepEqual(Object.keys(view).sort(), ['configurationError','hasApiKey','isCustomized','provider','revision'].sort());
  assert.ok(!JSON.stringify(view).includes('fake-typesafe-key'));
});
test('blank omitted field keeps key, explicit blank key is invalid', async () => {
  const f = fixture(); await f.service.save(patch(f));
  await f.service.save({ provider: 'jev', expectedRevision: f.service.get().revision });
  assert.equal(f.row().key, 'fake-typesafe-key');
  await rejects(f.service.save(patch(f, 'jev', '   ')), 'invalid_input');
});
test('switching to default keeps key; explicit reset deletes the override only', async () => {
  const f = fixture(); await f.service.save(patch(f));
  await f.service.save({ provider: 'default', expectedRevision: f.service.get().revision });
  assert.equal(f.service.get().provider, 'default'); assert.equal(f.service.get().isCustomized, true);
  await f.service.reset({ expectedRevision: f.service.get().revision });
  assert.equal(f.service.get().isCustomized, false); assert.equal(f.row().key, 'fake-typesafe-key');
});
test('delete key explicitly restores defaults and leaves no credential', async () => {
  const f = fixture(); await f.service.save(patch(f));
  const view = await f.service.deleteKey({ expectedRevision: f.service.get().revision });
  assert.equal(view.provider, 'default'); assert.equal(view.hasApiKey, false); assert.equal(view.isCustomized, false);
});
test('invalid persisted config does not silently select another provider; reset recovers', async () => {
  const f = fixture(); f.row().settings = { provider: null, nonce: 'unreadable', valid: false, isCustomized: true };
  assert.equal(f.service.readProvider(), null); assert.equal(f.service.get().configurationError, true);
  await rejects(f.service.save(patch(f)), 'unavailable');
  await f.service.reset({ expectedRevision: f.service.get().revision });
  assert.equal(f.service.readProvider(), 'default');
});
for (const [name, mutate] of [
  ['unknown provider', p => ({ ...p, provider: 'other' })],
  ['URL injection', p => ({ ...p, endpoint: 'https://unrelated.invalid' })],
  ['owner injection', p => ({ ...p, ownerId: 'owner-B' })],
  ['key read method', p => ({ ...p, reveal: true })],
  ['key under default', p => ({ ...p, provider: 'default' })],
  ['key with newline', p => ({ ...p, apiKey: 'fake\nkey' })],
  ['key over size', p => ({ ...p, apiKey: 'x'.repeat(4097) })],
  ['key object', p => ({ ...p, apiKey: {} })],
  ['key whitespace', p => ({ ...p, apiKey: 'fake key' })],
  ['missing token', p => ({ provider: p.provider, apiKey: p.apiKey })],
]) test(`reject untrusted settings payload: ${name}`, async () => {
  const f = fixture(); await rejects(f.service.save(mutate(patch(f))), 'invalid_input');
  assert.equal(f.row().key, null);
});
test('optimistic token stops stale multi-window overwrite', async () => {
  const f = fixture(); const first = patch(f); const second = { ...first, apiKey: 'fake-other-key' };
  await f.service.save(first); await rejects(f.service.save(second), 'stale');
  assert.equal(f.row().key, 'fake-typesafe-key');
});
test('same provider with key rotation changes revision and cancels prior review lease', async () => {
  const f = fixture(); await f.service.save(patch(f));
  const old = f.service.get().revision; const route = f.service.routingStamp(); const lease = f.service.captureReview();
  await f.service.save(patch(f, 'jev', 'fake-new-key'));
  assert.notEqual(f.service.get().revision, old); assert.notEqual(f.service.routingStamp(), route);
  assert.equal(lease.signal.aborted, true); assert.equal(lease.isCurrent(), false); lease.release();
});
test('cross-process change is detected even without notification', () => {
  const f = fixture(); const lease = f.service.captureReview();
  f.row().settings = { provider: 'jev', nonce: 'external', valid: true, isCustomized: true };
  assert.equal(lease.isCurrent(), false); lease.release();
});
test('changing key externally invalidates a captured Jev lease', () => {
  const f = fixture(); const lease = f.service.captureReview();
  f.row().key = 'fake-externally-rotated-key'; assert.equal(lease.isCurrent(), false); lease.release();
});
test('owner changes while waiting for lock: neither owner is written', async () => {
  const f = fixture(); const input = patch(f); const gate = deferred(); f.gate(gate);
  const pending = f.service.save(input); f.owner('owner-B:2'); gate.resolve();
  await rejects(pending, 'stale'); assert.equal(f.records.get('owner-A:1').key, null); assert.equal(f.row().key, null);
});
test('key isolation and old UI tokens across owners', async () => {
  const f = fixture(); await f.service.save(patch(f)); const viewA = f.service.get();
  f.owner('owner-B:2'); assert.equal(f.service.get().hasApiKey, false);
  await rejects(f.service.save({ provider: 'jev', apiKey: 'fake-key-B', expectedRevision: viewA.revision }), 'stale');
  assert.equal(f.row().key, null);
});
test('pending account boundary never falls back to original or reveals a key', () => {
  const f = fixture(); f.owner(null);
  assert.equal(f.service.readProvider(), null); assert.equal(f.service.routingStamp(), null);
  assert.throws(() => f.service.get(), e => e.code === 'unavailable');
});
test('failed key storage never enables Jev', async () => {
  const f = fixture(); const input = patch(f); f.row().failKey = true;
  await rejects(f.service.save(input), 'storage_failed'); assert.equal(f.service.readProvider(), 'default');
});
test('partial failure preserves a newly saved key, never restores guessed old plaintext', async () => {
  const f = fixture(); const input = patch(f); f.row().failSettings = true;
  await rejects(f.service.save(input), 'storage_failed');
  assert.equal(f.row().key, 'fake-typesafe-key'); assert.equal(f.service.readProvider(), 'default');
});
test('failed key deletion preserves the key and reports safe error', async () => {
  const f = fixture(); await f.service.save(patch(f)); f.row().failDelete = true;
  await rejects(f.service.deleteKey({ expectedRevision: f.service.get().revision }), 'storage_failed');
  assert.equal(f.row().key, 'fake-typesafe-key');
});
test('source trust is rechecked while holding the mutation lock', async () => {
  const f = fixture(); const input = patch(f); const gate = deferred(); f.gate(gate); let trusted = true;
  const handler = createAutoReviewSettingsHandler({ assertTrusted() { if (!trusted) throw Error('not trusted'); },
    load: async () => f.service, notify() {}, fail(code,message) { throw Object.assign(Error(message), {code}); } });
  const pending = handler('save')({}, input); await Promise.resolve(); trusted = false; gate.resolve();
  await assert.rejects(pending); assert.equal(f.row().key, null);
});
test('untrusted IPC is rejected before any module or storage access', async () => {
  const handler = createAutoReviewSettingsHandler({ assertTrusted() { throw Error('blocked'); },
    load() { throw Error('unexpected load'); }, notify() {}, fail() { throw Error('unexpected fail'); } });
  await assert.rejects(handler('get')({}), /blocked/);
});
test('IPC does not expose raw storage errors or keys', async () => {
  const handler = createAutoReviewSettingsHandler({ assertTrusted() {},
    load: async () => { throw Error('Authorization: Bearer fake-sensitive-value'); }, notify() {},
    fail(code,message) { throw Object.assign(Error(message), {code}); } });
  await assert.rejects(handler('get')({}), error => error.code === 'INTERNAL' && !error.message.includes('fake-sensitive'));
});
test('bridge exposes named operations only and strips event/payload from notifications', async () => {
  const calls = []; let callback; let removed;
  const bridge = createAutoReviewSettingsBridge({ invoke: async (...args) => { calls.push(args); return {}; },
    on(channel,fn) { callback=fn; }, removeListener(channel,fn) { removed=fn; } });
  assert.deepEqual(Object.keys(bridge).sort(), ['deleteKey','get','onChanged','reset','save']);
  await bridge.get(); await bridge.save({ provider:'default',expectedRevision:'token' });
  assert.equal(calls[0][0],AUTO_REVIEW_SETTINGS.get); assert.equal(calls[1][0],AUTO_REVIEW_SETTINGS.save);
  let args; const stop = bridge.onChanged((...a)=>args=a); callback({}, { apiKey:'fake-do-not-forward' });
  assert.deepEqual(args,[]); stop(); assert.equal(removed,callback);
});
test('default pending result is dropped after settings revision changes, without reading Jev key', async () => {
  let stamp='one'; const route=createAutoReviewProviderRouter({readProvider:()=> 'default', configStamp:()=>stamp,
    requestDefault:async()=> {stamp='two'; return '{"verdict":"allow"}';},
    ownerStamp:()=>{throw Error('no Jev ownership read');},readJevApiKey:()=>{throw Error('no key read');},
    prepareJev:()=>{throw Error('no context');},fetchImpl:fetch,logger:{debug(){},warn(){}}});
  assert.equal(await route({},'',{signal:new AbortController().signal}),null);
});
test('provider notifications cancel the actual HTTP request signal', async () => {
  let notify; let sentSignal;
  const route=createAutoReviewProviderRouter({readProvider:()=> 'default',configStamp:()=> 'one',
    subscribeChanges(fn){notify=fn;return()=>{notify=undefined;};}, requestDefault:async(_p,signal)=>{
      sentSignal=signal; notify(); return '{"verdict":"allow"}';}, ownerStamp:()=> 'o',
    readJevApiKey:()=> null,prepareJev:()=>{throw Error('no context');},fetchImpl:fetch,logger:{debug(){},warn(){}}});
  assert.equal(await route({},'',{signal:new AbortController().signal}),null);
  assert.equal(sentSignal.aborted,true); assert.equal(notify,undefined);
});
test('atomic current-message omission is explicit Jev evidence, not a valid grant', () => {
  const current='User message omitted because it exceeds the review budget; it cannot establish authorization.';
  const result=prepareJevReviewInput('policy',{userIntent:current,action:{kind:'exec',command:'pnpm test'},platform:'linux'}, {workspaceRoots:['/repo']});
  assert.equal(result.input.evidence.contextCoverage.currentUserMessage,'omitted');
  assert.equal(result.input.evidence.contextCoverage.userHistory,'omitted');
  assert.equal(result.input.evidence.authorizationContext.requesterAuthority,'unknown');
});
