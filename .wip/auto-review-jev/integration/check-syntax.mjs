/** Syntax-only check of every overlay .ts/.tsx file. Not a project typecheck. */
import { createRequire } from 'node:module';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const ts = require(process.env.TYPESCRIPT_PATH || 'typescript');
const root = fileURLToPath(new URL('../overlay/', import.meta.url));
const results=[];
async function check(folder) {
  for (const entry of await readdir(folder,{withFileTypes:true})) {
    const file=path.join(folder,entry.name);
    if(entry.isDirectory()) { await check(file); continue; }
    if(!/\.tsx?$/.test(entry.name)) continue;
    const text=await readFile(file,'utf8');
    const result=ts.transpileModule(text,{fileName:file,reportDiagnostics:true,
      compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}});
    const diagnostics=(result.diagnostics||[]).filter(d=>d.category===ts.DiagnosticCategory.Error)
      .map(d=>ts.flattenDiagnosticMessageText(d.messageText,'\n'));
    results.push({file:path.relative(root,file),diagnostics});
  }
}
await check(root);
const report={check:'syntax-only, not module resolution, React/Electron typechecking, or visual rendering',
  files:results.length,errors:results.reduce((n,r)=>n+r.diagnostics.length,0),results};
await writeFile(new URL('../verification-syntax.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
process.stdout.write(JSON.stringify({files:report.files,errors:report.errors})+'\n');
if(report.errors)process.exitCode=1;
