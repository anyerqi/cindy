import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { addSettingsSection, addLocale, registerSettingsIpc, exposeSettingsBridge } from '../integration/transforms.mjs';

// Reviewed SettingsView excerpt, including its actual multiline JSX formatting.
const settings = "import { AuxiliaryModelSection } from './AuxiliaryModelSection';\n"
  + '                <section className="pb-[18px]" aria-label={t(\'settings.sections.auxiliaryModels\')}>\n'
  + '                  <AuxiliaryModelSection\n'
  + "                    key={`auxiliary-models:${mode}:${dataOwnerId ?? 'none'}`}\n"
  + '                  />\n                </section>\n';
test('mounts the settings component at the reviewed multiline JSX anchor',()=>{
  const result=addSettingsSection(settings);
  assert.ok(result.includes("import { AutoReviewSection } from './AutoReviewSection'"));
  assert.ok(result.includes("key={`auto-review:${mode}:${dataOwnerId ?? 'none'}`}"));
  assert.equal((result.match(/<AutoReviewSection/g)||[]).length,1);
  assert.ok(result.indexOf('<AutoReviewSection')>result.indexOf('<AuxiliaryModelSection'));
  assert.throws(()=>addSettingsSection(result));
});
test('registers named Main IPC before application bootstrap',()=>{
  const result=registerSettingsIpc("  const mod = await import('./bootstrap-electron.js');\n  await mod.bootstrapElectron();");
  assert.ok(result.indexOf('registerAutoReviewSettingsIpc();')<result.indexOf('await mod.bootstrapElectron()'));
  assert.throws(()=>registerSettingsIpc(result));
});
test('exposes only a named bridge without changing existing electronAPI contents',()=>{
  const existing="import { contextBridge, ipcRenderer, webUtils } from 'electron';\ncontextBridge.exposeInMainWorld('electronAPI', existingApi);\n";
  const result=exposeSettingsBridge(existing);
  assert.ok(result.includes("contextBridge.exposeInMainWorld('autoReviewSettings', createAutoReviewSettingsBridge(ipcRenderer))"));
  assert.ok(result.endsWith("contextBridge.exposeInMainWorld('electronAPI', existingApi);\n"));
});
const locales=['zh-CN','zh-TW','en','ja','ko'];
const dictionaries=Object.fromEntries(await Promise.all(locales.map(async locale=>[locale,JSON.parse(await readFile(new URL(`../integration/locales/${locale}.json`,import.meta.url),'utf8'))])));
for(const locale of locales) test(`additive ${locale} translations preserve every existing key`,()=>{
  const before='{\n  "other": "existing value",\n  "settings": {\n    "old": { "value": "keep me" }\n  }\n}\n';
  const result=addLocale(before,dictionaries[locale]);
  const parsed=JSON.parse(result);assert.deepEqual(parsed.settings.autoReview,dictionaries[locale]);
  delete parsed.settings.autoReview;assert.deepEqual(parsed,JSON.parse(before));
  assert.ok(result.includes('    "old": { "value": "keep me" }'));
  assert.deepEqual(Object.keys(dictionaries[locale]).sort(),Object.keys(dictionaries.en).sort());
  assert.ok(Object.values(dictionaries[locale]).every(v=>typeof v==='string'&&v.trim()));
  assert.throws(()=>addLocale(result,dictionaries[locale]));
});
test('UI uses a password input and does not read or persist saved plaintext',async()=>{
  const ui=await readFile(new URL('../overlay/apps/desktop/src/renderer/components/settings/AutoReviewSection.tsx',import.meta.url),'utf8');
  assert.ok(ui.includes('type="password"'));assert.ok(ui.includes("state.provider === 'jev'"));
  assert.ok(ui.includes('var(--text-placeholder)'));
  assert.ok(!ui.includes('localStorage'));assert.ok(!ui.includes('fetch('));assert.ok(!ui.includes('readKey('));
});
