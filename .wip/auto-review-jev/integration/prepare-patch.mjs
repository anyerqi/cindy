/** Generate a reviewed-source patch. Does not edit a checkout, commit, push or install packages. */
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile, mkdir, lstat, readdir, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { refactorReviewer, wireHost, registerSecret, registerSettingsIpc, exposeSettingsBridge, addSettingsSection, addLocale } from './transforms.mjs';

const argument = process.argv[2];
if (!argument || !path.isAbsolute(argument)) throw Error('Usage: node integration/prepare-patch.mjs /absolute/path/to/cindy > /tmp/cindy-jev.patch');
const root = await realpath(argument);
const bundle = fileURLToPath(new URL('../', import.meta.url));
const edits = [
  ['apps/desktop/src/main/maker-host/auto-permission-reviewer.ts', 'b6128cd3ef2ab704e868ffdec2c35d838f7754da', refactorReviewer],
  ['apps/desktop/src/main/maker-host/index.ts', 'f17a84e2db1d2170ff10b848017bb9f17b00c848', wireHost],
  ['apps/desktop/src/shared/providerSecrets.ts', 'fa5b305ec9396135d792b64914d2ead98422b4b7', registerSecret],
  ['apps/desktop/src/main/index.ts', 'c16e5f9cc563437e19764c7a0f5403ef9f772c7a', registerSettingsIpc],
  ['apps/desktop/src/preload/preload.ts', '942de3193fecd4239b99aaa0ec10173c0f5e6562', exposeSettingsBridge],
  ['apps/desktop/src/renderer/components/settings/SettingsView.tsx', 'dd90162beeab45658e8e5506f2d0c66ef76db85c', addSettingsSection],
];
function blobHash(bytes) { return createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex'); }
async function sourceFile(file) {
  const full = path.join(root,file);
  const canonical = await realpath(full);
  if (!canonical.startsWith(root + path.sep) || (await lstat(full)).isSymbolicLink()) throw Error(`Refusing symlink/out-of-repo source: ${file}`);
  return readFile(full);
}
async function filesBelow(folder, prefix='') {
  const result=[];
  for (const entry of await readdir(folder,{withFileTypes:true})) {
    const relative=path.posix.join(prefix,entry.name);
    if (entry.isDirectory()) result.push(...await filesBelow(path.join(folder,entry.name),relative));
    else if(entry.isFile()) result.push(relative);
    else throw Error('Overlay must contain regular files only.');
  }
  return result.sort();
}
const planned=[];
for(const [file,sha,transform] of edits) {
  const bytes=await sourceFile(file);
  if(blobHash(bytes)!==sha) throw Error(`Source differs from reviewed blob; reconcile before applying: ${file}`);
  const before=bytes.toString('utf8'); planned.push({file,before,after:transform(before)});
}
for (const locale of ['zh-CN','zh-TW','en','ja','ko']) {
  const file=`apps/desktop/src/renderer/i18n/locales/${locale}/common.json`;
  const before=(await sourceFile(file)).toString('utf8');
  const strings=JSON.parse(await readFile(path.join(bundle,'integration','locales',`${locale}.json`),'utf8'));
  planned.push({file,before,after:addLocale(before,strings)});
}
for (const file of await filesBelow(path.join(bundle,'overlay'))) {
  try { await lstat(path.join(root,file)); throw Error(`Refusing existing overlay target: ${file}`); }
  catch(error) { if(error.code!=='ENOENT') throw error; }
  planned.push({file,after:await readFile(path.join(bundle,'overlay',file),'utf8')});
}
// Entire plan is validated before any output, preventing an incomplete patch on failure.
const temp=await mkdtemp(path.join(tmpdir(),'cindy-jev-client-patch-'));
try {
  for(const item of planned) for(const [side,value] of [['before',item.before],['after',item.after]]) {
    if(value===undefined) continue;
    const target=path.join(temp,side,item.file); await mkdir(path.dirname(target),{recursive:true}); await writeFile(target,value);
  }
  const diff=spawnSync('git',['diff','--no-index','--no-renames','--no-ext-diff','--no-textconv','--src-prefix=a/','--dst-prefix=b/','--','before','after'], {
    cwd:temp,encoding:'utf8',maxBuffer:10*1024*1024,
  });
  if(diff.error || ![0,1].includes(diff.status)) throw Error('Patch generation failed.');
  process.stdout.write(diff.stdout.replaceAll('a/before/','a/').replaceAll('b/after/','b/').replaceAll('a/after/','a/'));
  process.stderr.write('Client-only patch generated; no checkout, commit, branch, or remote changed. Native-review coverage remains incomplete.\n');
} finally { await rm(temp,{recursive:true,force:true}); }
