// Temporary follow-up transforms, applied before every validation and publication.
import './complete.mjs';
import fs from 'node:fs';
import { replaceOnce } from '../integration/transforms.mjs';
const edit = (name, change) => fs.writeFileSync(name, change(fs.readFileSync(name, 'utf8')));
edit('apps/desktop/src/main/maker-host/auto-review/settings-service.ts', source => replaceOnce(source,
  "      if (!scope) return null;\n      return createHmac('sha256', tokenKey)",
  "      if (!scope) return null;\n      // Other processes and credential cleanup can change a key without this\n      // process's epoch. Include its opaque digest only for the selected Jev\n      // provider; original mode never probes the optional credential.\n      if (scope.readSettings().provider === 'jev') return snapshot(scope).view.revision;\n      return createHmac('sha256', tokenKey)"));
edit('apps/desktop/src/main/maker-host/index.ts', source => replaceOnce(source,
  '// Provider-neutral policy consumed by every harness. No key lookup on this path.',
  '// Provider-neutral policy. Original mode never probes optional Jev credentials.'));
edit('apps/desktop/src/main/maker-host/auto-review/__tests__/settings-service.test.ts', source => {
  let result = replaceOnce(source, '    key: () => key, reads: () => keyReads,',
    '    key: () => key, reads: () => keyReads, replaceKeyExternally: (value: string | null) => { key = value; },');
  return result + `\n\ndescribe('external Jev credential revision', () => {
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
});\n`;
});
console.log('Applied external-key revision fence and regression coverage.');
