import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createAutoReviewSettingsController } from '../dist/renderer/components/settings/autoReviewSettingsController.js';
const tick = () => new Promise(resolve => setImmediate(resolve));
const view = (patch={}) => ({provider:'default',isCustomized:false,hasApiKey:false,configurationError:false,revision:'a'.repeat(64),...patch});
function setup(extra={}) {
  let listener; const calls=[]; let stored=view();
  const api={get:async()=>stored,save:async input=>{calls.push(input); stored=view({provider:input.provider,hasApiKey:true,isCustomized:true,revision:'b'.repeat(64)});return stored;},
    reset:async input=>{calls.push(['reset',input]);stored=view({hasApiKey:true});return stored;},
    deleteKey:async input=>{calls.push(['deleteKey',input]);stored=view();return stored;},
    onChanged(fn){listener=fn;return()=>{listener=undefined;};},...extra};
  const control=createAutoReviewSettingsController(api);
  return {control,api,calls,change:()=>listener?.(),set:v=>{stored=v;}};
}
test('loads saved state and never prefills plaintext',async()=>{
  const f=setup({get:async()=>view({provider:'jev',hasApiKey:true})}); f.control.start(); await tick();
  assert.equal(f.control.getSnapshot().provider,'jev'); assert.equal(f.control.getSnapshot().keyDraft,'');f.control.stop();
});
test('missing required key blocks Save before calling IPC',async()=>{
  const f=setup();f.control.start();await tick();f.control.select('jev');await f.control.save();assert.equal(f.calls.length,0);f.control.stop();
});
test('save contains only selected mode, current revision and freshly typed key',async()=>{
  const f=setup();f.control.start();await tick();f.control.select('jev');f.control.typeKey(' fake-key ');await f.control.save();
  assert.deepEqual(f.calls[0],{provider:'jev',expectedRevision:'a'.repeat(64),apiKey:'fake-key'});
  assert.equal(f.control.getSnapshot().keyDraft,'');assert.equal(f.control.getSnapshot().provider,'jev');f.control.stop();
});
test('saved key can be retained by omitting apiKey',async()=>{
  const f=setup();f.set(view({provider:'jev',hasApiKey:true}));f.control.start();await tick();await f.control.save();
  assert.equal(Object.hasOwn(f.calls[0],'apiKey'),false);f.control.stop();
});
test('switching back to original drops unsaved key and never submits it',async()=>{
  const f=setup();f.control.start();await tick();f.control.select('jev');f.control.typeKey('fake-key');f.control.select('default');await f.control.save();
  assert.equal(f.control.getSnapshot().keyDraft,'');assert.equal(Object.hasOwn(f.calls[0],'apiKey'),false);f.control.stop();
});
test('source change with unsaved edits requires explicit reload instead of overwriting',async()=>{
  const f=setup();f.control.start();await tick();f.control.select('jev');f.control.typeKey('fake-key');f.set(view({revision:'c'.repeat(64)}));f.change();await tick();await f.control.save();
  assert.equal(f.control.getSnapshot().stale,true);assert.equal(f.calls.length,0);await f.control.refresh();assert.equal(f.control.getSnapshot().keyDraft,'');f.control.stop();
});
test('source change while clean reloads persisted settings',async()=>{
  const f=setup();f.control.start();await tick();f.set(view({provider:'jev',hasApiKey:true,revision:'c'.repeat(64)}));f.change();await tick();
  assert.equal(f.control.getSnapshot().provider,'jev');f.control.stop();
});
test('storage rejection never reports optimistic success and clears key draft',async()=>{
  const f=setup({save:async()=>{throw Error('fake-secret-in-error');}});f.control.start();await tick();f.control.select('jev');f.control.typeKey('fake-key');await f.control.save();
  assert.equal(f.control.getSnapshot().error,'save');assert.equal(f.control.getSnapshot().keyDraft,'');assert.equal(f.control.getSnapshot().provider,'default');f.control.stop();
});
test('mutation reloads latest state instead of trusting its possibly stale returned view',async()=>{
  const f=setup({save:async()=>view({provider:'jev',hasApiKey:true})});f.control.start();await tick();f.control.select('jev');f.control.typeKey('fake-key');await f.control.save();
  assert.equal(f.control.getSnapshot().provider,'default');f.control.stop();
});
test('double click does not send duplicate writes',async()=>{
  let done;let calls=0;const f=setup({save:()=>{calls++;return new Promise(r=>done=r);}});f.control.start();await tick();
  const first=f.control.save();const second=f.control.save();assert.equal(calls,1);done(view());await Promise.all([first,second]);f.control.stop();
});
test('closing or changing owner ignores old async response and clears typed credential',async()=>{
  let done;const f=setup({get:()=>new Promise(r=>done=r)});f.control.start();f.control.stop();done(view({provider:'jev'}));await tick();
  assert.equal(f.control.getSnapshot().view,null);assert.equal(f.control.getSnapshot().keyDraft,'');
});
test('React strict-mode cleanup/setup keeps new request authoritative',async()=>{
  const resolvers=[];const f=setup({get:()=>new Promise(r=>resolvers.push(r))});f.control.start();f.control.stop();f.control.start();
  resolvers[1](view({provider:'jev',hasApiKey:true}));await tick();resolvers[0](view());await tick();assert.equal(f.control.getSnapshot().provider,'jev');f.control.stop();
});
test('reset and delete key remain distinct named operations',async()=>{
  const f=setup();f.set(view({provider:'jev',hasApiKey:true,isCustomized:true}));f.control.start();await tick();await f.control.reset();
  assert.equal(f.calls[0][0],'reset');assert.equal(f.control.getSnapshot().view.hasApiKey,true);await f.control.deleteKey();
  assert.equal(f.calls[1][0],'deleteKey');assert.equal(f.control.getSnapshot().view.hasApiKey,false);f.control.stop();
});

test('focus with unchanged revision preserves an unsaved API key',async()=>{
  const f=setup();f.control.start();await tick();f.control.select('jev');f.control.typeKey('fake-key');
  f.control.notifyChanged();await tick();assert.equal(f.control.getSnapshot().stale,false);
  assert.equal(f.control.getSnapshot().keyDraft,'fake-key');f.control.stop();
});
test('late focus refresh cannot overwrite a newer save',async()=>{
  const f=setup();f.control.start();await tick();let complete;
  f.api.get=()=>new Promise(r=>complete=r);
  f.control.notifyChanged();f.api.get=async()=>view({provider:'jev',hasApiKey:true,revision:'d'.repeat(64)});
  f.control.select('jev');f.control.typeKey('fake-key');await f.control.save();
  complete(view({revision:'c'.repeat(64)}));await tick();
  assert.equal(f.control.getSnapshot().view.revision,'d'.repeat(64));f.control.stop();
});
