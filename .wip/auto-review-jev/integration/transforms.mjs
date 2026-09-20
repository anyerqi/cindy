/** Source transforms, used only when preparing a patch. Never used at application runtime. */
export function replaceOnce(source, before, after) {
  const at = source.indexOf(before);
  if (at < 0 || source.indexOf(before, at + before.length) >= 0) throw Error('Expected unique source anchor not found.');
  return source.slice(0, at) + after + source.slice(at + before.length);
}
export function refactorReviewer(source) {
  const signature = 'export function buildAutoPermissionReviewPrompt(request: AutoReviewRequest): string {\n';
  const start = source.indexOf(signature);
  const end = source.indexOf('\nexport function parseAutoPermissionReviewDecision', start);
  if (start < 0 || end < 0) throw Error('Reviewer function boundaries not found.');
  const original = source.slice(start, end);
  const comment = original.indexOf('  // Authorization is assessed against the actual action,');
  const policyStart = original.indexOf('    "Decide in this order:",');
  const policyEnd = original.indexOf("    '',\n    '<review_input>',", policyStart);
  if (comment < 0 || policyStart <= comment || policyEnd <= policyStart) throw Error('Reviewer policy boundaries not found.');
  const payloadBody = replaceOnce(original.slice(signature.length, comment), '  const payload = {', '  return {');
  const policyItems = original.slice(policyStart, policyEnd);
  const promptBody = original.slice(comment, policyStart)
    + '    buildAutoPermissionReviewPolicy(),\n' + original.slice(policyEnd);
  const replacement = 'export function buildAutoPermissionReviewInput(request: AutoReviewRequest) {\n'
    + payloadBody + '}\n\n'
    + '/** Semantic rules shared by text and typed reviewers; no text-generation instructions. */\n'
    + 'export function buildAutoPermissionReviewPolicy(): string {\n  return [\n'
    + policyItems + "  ].join('\\n');\n}\n\n"
    + signature + '  const payload = buildAutoPermissionReviewInput(request);\n' + promptBody;
  return source.slice(0, start) + replacement + source.slice(end);
}
export function wireHost(source) {
  let result = replaceOnce(source,
    "import { createAutoPermissionReviewer } from './auto-permission-reviewer.js';",
    "import { buildAutoPermissionReviewInput, buildAutoPermissionReviewPolicy, createAutoPermissionReviewer } from './auto-permission-reviewer.js';\n"
    + "import { prepareJevReviewInput } from './auto-review/jev-context.js';\n"
    + "import { createAutoReviewProviderRouter } from './auto-review/provider-router.js';\n"
    + "import { getAutoReviewSettingsService, onAutoReviewSettingsChanged } from './auto-review/settings-store.js';");
  result = replaceOnce(result, '  type McpProvider,\n', '  type McpProvider,\n  type AutoReviewRequest,\n');
  result = replaceOnce(result,
    "import { readCustomProviderKey } from '../secrets/providerSecretStore.js';",
    "import { getProviderSecretStore, readCustomProviderKey } from '../secrets/providerSecretStore.js';");
  result = replaceOnce(result, 'const reviewAutoPermissionAction = createAutoPermissionReviewer({',
    `// This is a client-only reviewer selection. The original chain is unchanged.
// Store access stays lazy; importing Maker never probes the optional Jev key.
const requestAutoReviewProviderText = createAutoReviewProviderRouter<AutoReviewRequest>({
  readProvider: () => getAutoReviewSettingsService().readProvider(),
  configStamp: () => getAutoReviewSettingsService().routingStamp(),
  subscribeChanges: onAutoReviewSettingsChanged,
  ownerStamp: () => {
    try { return getAutoReviewSettingsService().get().revision; }
    catch { return null; }
  },
  requestDefault: requestAutoReviewText,
  prepareJev: (request) => prepareJevReviewInput(
    buildAutoPermissionReviewPolicy(), buildAutoPermissionReviewInput(request), request,
  ),
  readJevApiKey: () => getProviderSecretStore().get('typesafe-auto-review'),
  fetchImpl: outboundFetch,
  logger: desktopMakerLogger,
});

const reviewAutoPermissionAction = createAutoPermissionReviewer({`);
  return replaceOnce(result,
    '  requestText: (_request, prompt, { signal }) => requestAutoReviewText(prompt, signal),',
    '  requestText: (request, prompt, context) => requestAutoReviewProviderText(request, prompt, context),');
}
export function registerSecret(source) {
  let result = replaceOnce(source, "  | 'openai-images';", "  | 'openai-images'\n  | 'typesafe-auto-review';");
  result = replaceOnce(result, "  'openai-images': 'provider_key_openai_images',",
    "  'openai-images': 'provider_key_openai_images',\n  'typesafe-auto-review': 'provider_key_typesafe_auto_review',");
  return replaceOnce(result, "  STORAGE_KEYS['openai-images'].toLowerCase(),",
    "  STORAGE_KEYS['openai-images'].toLowerCase(),\n  STORAGE_KEYS['typesafe-auto-review'].toLowerCase(),");
}

export function registerSettingsIpc(source) {
  return replaceOnce(source,
    "  const mod = await import('./bootstrap-electron.js');\n  await mod.bootstrapElectron();",
    "  const mod = await import('./bootstrap-electron.js');\n"
      + "  const { registerAutoReviewSettingsIpc } = await import('./auto-review-settings-ipc.js');\n"
      + "  registerAutoReviewSettingsIpc();\n  await mod.bootstrapElectron();");
}
export function exposeSettingsBridge(source) {
  if (source.includes("exposeInMainWorld('autoReviewSettings'")) throw Error('Auto-review bridge already exists.');
  return replaceOnce(source,
    "import { contextBridge, ipcRenderer, webUtils } from 'electron';",
    "import { contextBridge, ipcRenderer, webUtils } from 'electron';\n"
      + "import { createAutoReviewSettingsBridge } from './autoReviewSettingsBridge.js';\n"
      + "contextBridge.exposeInMainWorld('autoReviewSettings', createAutoReviewSettingsBridge(ipcRenderer));");
}
export function addSettingsSection(source) {
  if (source.includes('AutoReviewSection')) throw Error('Auto-review settings are already mounted.');
  let result = replaceOnce(source,
    "import { AuxiliaryModelSection } from './AuxiliaryModelSection';",
    "import { AuxiliaryModelSection } from './AuxiliaryModelSection';\nimport { AutoReviewSection } from './AutoReviewSection';");
  const anchor = "<AuxiliaryModelSection\n                    key={`auxiliary-models:${mode}:${dataOwnerId ?? 'none'}`}\n                  />";
  const start = result.indexOf(anchor);
  if (start < 0 || result.indexOf(anchor, start + anchor.length) >= 0) throw Error('Settings mount anchor changed.');
  const end = result.indexOf('</section>', start);
  if (end < 0) throw Error('Settings section boundary missing.');
  const at = end + '</section>'.length;
  return result.slice(0, at) + `
                <section className="pb-[18px]" aria-label={t('settings.autoReview.title')}>
                  <AutoReviewSection key={\`auto-review:\${mode}:\${dataOwnerId ?? 'none'}\`} />
                </section>` + result.slice(at);
}
/** Add a new translation subtree while preserving every existing source byte. */
export function addLocale(source, strings) {
  const document = JSON.parse(source);
  if (!document.settings || typeof document.settings !== 'object' || Array.isArray(document.settings)
    || Object.hasOwn(document.settings, 'autoReview')) throw Error('Locale settings structure has changed.');
  const pattern = /^([ \t]*)"settings"\s*:\s*\{/gm;
  const matches = [...source.matchAll(pattern)];
  if (matches.length !== 1) throw Error('Expected one settings locale anchor.');
  const match = matches[0];
  const at = match.index + match[0].length;
  const indent = match[1] + '  ';
  const lines = JSON.stringify(strings, null, 2).split('\n');
  const addition = '\n' + indent + '"autoReview": ' + lines[0] + '\n'
    + lines.slice(1).map(line => indent + line).join('\n') + ',';
  const result = source.slice(0,at) + addition + source.slice(at);
  const parsed = JSON.parse(result);
  delete parsed.settings.autoReview;
  if (JSON.stringify(parsed) !== JSON.stringify(document)) throw Error('Unexpected locale mutation.');
  return result;
}
