// Temporary integration driver; removed after the real application changes pass validation.
import fs from 'node:fs';
import path from 'node:path';
import { replaceOnce, refactorReviewer, wireHost, registerSecret, exposeSettingsBridge, addSettingsSection } from '../integration/transforms.mjs';
const root = process.cwd();
const staging = path.join(root, '.wip/auto-review-jev');
const edit = (name, change) => { const file = path.join(root, name); fs.writeFileSync(file, change(fs.readFileSync(file, 'utf8'))); };
function copyTree(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const name of fs.readdirSync(from)) {
    const source = path.join(from, name), target = path.join(to, name);
    if (fs.lstatSync(source).isDirectory()) copyTree(source, target);
    else { if (fs.existsSync(target)) throw Error(`Refusing to overwrite ${target}`); fs.copyFileSync(source, target); }
  }
}
copyTree(path.join(staging, 'overlay'), root);
copyTree(path.join(staging, 'ci/files'), root);
edit('apps/desktop/src/main/maker-host/auto-permission-reviewer.ts', refactorReviewer);
edit('apps/desktop/src/main/maker-host/index.ts', source => {
  let result = wireHost(source);
  const anchor = 'const reviewAutoPermissionAction = createAutoPermissionReviewer({';
  result = replaceOnce(result, anchor, `// Provider-neutral policy consumed by every harness. No key lookup on this path.
const getAutoReviewRuntimePolicy = () => {
  const settings = getAutoReviewSettingsService();
  return { forceHost: settings.readProvider() !== 'default', revision: settings.routingStamp() };
};

${anchor}`);
  const needle = '      reviewAutoPermissionAction,\n';
  if (result.split(needle).length !== 4) throw Error('Expected three agent registrations');
  return result.replaceAll(needle, needle + '      getAutoReviewRuntimePolicy,\n');
});
edit('apps/desktop/src/main/maker-host/pi-host.ts', source => replaceOnce(replaceOnce(source,
  "  reviewAutoPermissionAction?: AgentDeps['reviewAutoPermissionAction'];",
  "  reviewAutoPermissionAction?: AgentDeps['reviewAutoPermissionAction'];\n  getAutoReviewRuntimePolicy?: AgentDeps['getAutoReviewRuntimePolicy'];"),
  '    reviewAutoPermissionAction: opts.reviewAutoPermissionAction,',
  '    reviewAutoPermissionAction: opts.reviewAutoPermissionAction,\n    getAutoReviewRuntimePolicy: opts.getAutoReviewRuntimePolicy,'));
edit('apps/desktop/src/shared/providerSecrets.ts', registerSecret);
edit('apps/desktop/src/main/bootstrap-electron.ts', source => replaceOnce(
  "import { registerAutoReviewSettingsIpc } from './auto-review-settings-ipc.js';\n" + source,
  'registerAppearanceSettingsIpc();', 'registerAppearanceSettingsIpc();\nregisterAutoReviewSettingsIpc();'));
edit('apps/desktop/src/preload/preload.ts', exposeSettingsBridge);
edit('apps/desktop/src/renderer/components/settings/SettingsView.tsx', addSettingsSection);
const coverage = {
  en: 'Applies to tasks using Auto-review. A mode change takes effect on the next message you send; completed actions are not reviewed again.',
  'zh-CN': '仅影响使用 Auto-review 的任务。模式切换在下次发送消息时生效，不会重新审核已执行的操作。',
  'zh-TW': '僅影響使用 Auto-review 的任務。模式切換在下次傳送訊息時生效，不會重新審核已執行的操作。',
  ja: 'Auto-review を使用するタスクに適用されます。モードの変更は次にメッセージを送信した時に有効になります。実行済みの操作は再審査されません。',
  ko: 'Auto-review를 사용하는 작업에 적용됩니다. 모드 변경은 다음 메시지를 보낼 때 적용되며, 완료된 동작은 다시 검토하지 않습니다.',
};
for (const locale of Object.keys(coverage)) {
  const strings = JSON.parse(fs.readFileSync(path.join(staging, 'integration/locales', `${locale}.json`), 'utf8'));
  strings.coverage = coverage[locale]; strings.working = strings.working.replace('...', '\u2026');
  edit(`apps/desktop/src/renderer/i18n/locales/${locale}/common.json`, source => {
    const original = JSON.parse(source);
    if (original.settings.autoReview) throw Error('Settings already integrated');
    const fragment = JSON.stringify(strings, null, 2).split('\n').map(line => '    ' + line).join('\n').trimStart();
    const result = replaceOnce(source, '\n  "settings": {', '\n  "settings": {\n    "autoReview": ' + fragment + ',');
    const check = JSON.parse(result); delete check.settings.autoReview;
    if (JSON.stringify(check) !== JSON.stringify(original)) throw Error('Unexpected locale mutation');
    return result;
  });
}
edit('packages/maker-core/src/agents/base-agent.ts', source => replaceOnce(
  "import type { AutoReviewRuntimePolicy } from './shared/auto-review-runtime-policy.js';\n" + source,
  '  reviewAutoPermissionAction?: AutoReviewDelegate;', `  reviewAutoPermissionAction?: AutoReviewDelegate;

  /** Host-selected reviewer policy. Never changes a task's permission mode or sandbox.
   * The revision must change on provider, credential, and owner changes. No secrets.
   * Undefined preserves the legacy native-first behavior; null means unavailable.
   */
  getAutoReviewRuntimePolicy?: () => AutoReviewRuntimePolicy | null;`));
for (const agent of ['claude-code', 'codex', 'pi']) {
  edit(`packages/maker-core/src/agents/${agent}/index.ts`, source => {
    let result = "import { createAutoReviewPolicyGuard, sameAutoReviewRuntimePolicy } from '../shared/auto-review-runtime-policy.js';\n" + source;
    result = replaceOnce(result, '    const autoReviewDecisionCache = new Map<string, Promise<AutoReviewDecision>>();',
      `    const autoReviewDecisionCache = new Map<string, Promise<AutoReviewDecision>>();
    const autoReviewPolicy = createAutoReviewPolicyGuard(
      this.deps.getAutoReviewRuntimePolicy,
      () => autoReviewDecisionCache.clear(),
    );${agent === 'claude-code' ? '\n    let appliedAutoReviewPolicy = autoReviewPolicy.capture();' : ''}`);
    const start = result.indexOf('    const reviewAutoAction = (');
    const endAnchor = agent === 'claude-code' ? '    // guard ' : agent === 'codex' ? '    const readonlyReferencesConfig' : '    let closed = false;';
    const end = result.indexOf(endAnchor, start);
    if (start < 0 || end < start) throw Error(`Missing ${agent} review boundary`);
    const key = agent === 'pi' ? 'cacheKey' : 'key';
    let section = replaceOnce(result.slice(start, end), `      const ${key} = JSON.stringify(request);`,
      `      const reviewPolicy = autoReviewPolicy.capture();\n      const ${key} = JSON.stringify([reviewPolicy, request]);`);
    section = replaceOnce(section, '      )).then((decision) => {',
      '      )).then((decision) => autoReviewPolicy.protect(reviewPolicy, decision)).then((decision) => {');
    result = result.slice(0, start) + section + result.slice(end);
    if (agent === 'claude-code') {
      result = replaceOnce(result, '      !nativeAutoReviewUnavailable\n', '      !nativeAutoReviewUnavailable\n      && !autoReviewPolicy.capture().forceHost\n');
      result = replaceOnce(result, '          const accepted = inputQueue.push(sdkInput);', `          // Apply a changed reviewer at the next accepted send, after async content
          // preparation. Native Auto otherwise bypasses canUseTool completely.
          const reviewPolicy = autoReviewPolicy.capture();
          if (!sameAutoReviewRuntimePolicy(appliedAutoReviewPolicy, reviewPolicy)) {
            if (mutablePermissionMode === 'auto') {
              const targetQuery = q;
              const targetMode = currentTurnSdkPermissionMode();
              await targetQuery.setPermissionMode(targetMode);
              if (closed || sendOpts?.signal?.aborted || targetQuery !== q
                || targetMode !== currentTurnSdkPermissionMode()
                || !sameAutoReviewRuntimePolicy(reviewPolicy, autoReviewPolicy.capture())) {
                throw new Error('Auto-review settings changed during send; retry with the current settings.');
              }
              if (targetMode === 'auto') nativeAutoQueries.add(targetQuery);
              else nativeAutoQueries.delete(targetQuery);
            }
            appliedAutoReviewPolicy = reviewPolicy;
          }
          const accepted = inputQueue.push(sdkInput);`);
    } else result = result.replace('createAutoReviewPolicyGuard, sameAutoReviewRuntimePolicy', 'createAutoReviewPolicyGuard');
    if (agent === 'codex') result = replaceOnce(result, '        approvalsReviewerRouteSupported,\n      );',
      '        approvalsReviewerRouteSupported && !autoReviewPolicy.capture().forceHost,\n      );');
    return result;
  });
}
edit('apps/desktop/src/main/auto-review-settings-ipc.ts', source => {
  let result = "import { getAutoReviewSettingsService } from './maker-host/auto-review/settings-store.js';\n" + source;
  result = replaceOnce(result, 'import { ipcMain,', 'import { BrowserWindow, ipcMain,');
  result = replaceOnce(result, 'import { assertTrustedAppRendererEvent }', 'import { assertTrustedAppRendererEvent, isTrustedAppRendererWindow }');
  result = replaceOnce(result, "const load = async () => (await import('./maker-host/auto-review/settings-store.js')).getAutoReviewSettingsService();", 'const load = async () => getAutoReviewSettingsService();');
  result = result.replace('Lazy-load stores only in an explicit, trusted settings action, never during startup.', 'Static module graph, with store access deferred until a trusted action.');
  return replaceOnce(result, '      try { sender.send(AUTO_REVIEW_SETTINGS.changed); }',
    '      if (!isTrustedAppRendererWindow(BrowserWindow.fromWebContents(sender))) continue;\n      try { sender.send(AUTO_REVIEW_SETTINGS.changed); }');
});
edit('apps/desktop/src/renderer/components/settings/AutoReviewSection.tsx', source => {
  let result = replaceOnce(source, 'import { SegmentedControl }',
    "import { Input } from '@/components/ui/input';\nimport { Button } from '@/components/ui/button';\nimport { SegmentedControl }");
  result = result.split('\n').filter(line => !line.startsWith('const buttonClass = ') && !line.includes('className="min-h-9 w-full rounded-lg')).join('\n');
  result = replaceOnce(result, '<input\n', '<Input\n');
  result = replaceOnce(result, 'onChange={(event) => controller.typeKey(event.target.value)}', 'onChange={controller.typeKey}');
  result = result.replaceAll('<button className={buttonClass}', '<Button variant="secondary"').replaceAll('</button>', '</Button>');
  return replaceOnce(result, '<Button variant="secondary" type="button" disabled={blocked || !!state.view?.configurationError || missingKey}',
    '<Button type="button" disabled={blocked || !!state.view?.configurationError || missingKey}');
});
const readAppend = name => fs.readFileSync(path.join(staging, 'ci', name), 'utf8');
edit('packages/maker-core/src/agents/claude-code/__tests__/auto-review-wiring.test.ts', source => {
  let result = replaceOnce(source, "  reviewAutoPermissionAction?: AgentDeps['reviewAutoPermissionAction'];", "  reviewAutoPermissionAction?: AgentDeps['reviewAutoPermissionAction'];\n  getAutoReviewRuntimePolicy?: AgentDeps['getAutoReviewRuntimePolicy'];");
  result = replaceOnce(result, "    reviewer?: AgentDeps['reviewAutoPermissionAction'];", "    reviewer?: AgentDeps['reviewAutoPermissionAction'];\n    getAutoReviewRuntimePolicy?: AgentDeps['getAutoReviewRuntimePolicy'];");
  result = replaceOnce(result, '    reviewAutoPermissionAction: options.reviewAutoPermissionAction,', '    reviewAutoPermissionAction: options.reviewAutoPermissionAction,\n    getAutoReviewRuntimePolicy: options.getAutoReviewRuntimePolicy,');
  result = replaceOnce(result, '    reviewAutoPermissionAction,\n    mcpProviderNames:', '    reviewAutoPermissionAction,\n    getAutoReviewRuntimePolicy: options.getAutoReviewRuntimePolicy,\n    mcpProviderNames:');
  return result + '\n\n' + readAppend('claude-tests.txt');
});
edit('packages/maker-core/src/agents/codex/index.test.ts', source => source + '\n\n' + readAppend('codex-tests.txt'));
edit('packages/maker-core/src/agents/pi/__tests__/pi-auto-review-dispatch.test.ts', source => {
  const anchor = "  it('passes flat task history and actual blocked plugin actions after a natural steer, then invalidates on revocation',";
  return replaceOnce(source, anchor, readAppend('pi-tests.txt') + anchor);
});
edit('apps/desktop/src/main/secrets/__tests__/providerSecretStore.test.ts', source => {
  const anchor = "    expect(isRendererAccessibleSafeStorageKey(providerSecretStorageKey('openai-images'))).toBe(false);";
  return replaceOnce(source, anchor, anchor + "\n    expect(isRendererAccessibleSafeStorageKey(providerSecretStorageKey('typesafe-auto-review'))).toBe(false);");
});
edit('packages/maker-core/src/agents/base-agent.ts', source => source.replace(
  "   * reviewer. The host must use this session's selected provider + model and pass\n   * only the request supplied here; null/throw is treated as a silent block.",
  '   * reviewer, or when the user explicitly selects a host review provider. Only\n   * the bounded request is supplied; null/throw yields the unavailable ask path.'));
edit('docs/dev-rules/configuration-and-overrides.md', source => source + '\n## Auto-review provider\n\nClient-only reviewer selection, encrypted BYOK storage and runtime application are\ndefined in [Auto-review providers](auto-review-providers.md).\n');
console.log('Applied client settings, typed Jev provider, and all three harness policy/cache boundaries.');
