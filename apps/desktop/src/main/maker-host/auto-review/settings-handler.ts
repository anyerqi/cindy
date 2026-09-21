import { AutoReviewSettingsError, type createAutoReviewSettingsService } from './settings-service.js';

type Operation = 'get' | 'save' | 'reset' | 'deleteKey';
interface HandlerDeps<Event> {
  assertTrusted(event: Event): void;
  load(): Promise<ReturnType<typeof createAutoReviewSettingsService>>;
  notify(): void;
  fail(code: 'INVALID_PARAMS' | 'INTERNAL', message: string): never;
}
/** The Electron adapter supplies the real sender check, including the commit-time check. */
export function createAutoReviewSettingsHandler<Event>(deps: HandlerDeps<Event>) {
  return (operation: Operation) => async (event: Event, raw?: unknown) => {
    deps.assertTrusted(event);
    try {
      const service = await deps.load();
      deps.assertTrusted(event);
      if (operation === 'get') return service.get();
      try { return await service[operation](raw, () => deps.assertTrusted(event)); }
      finally { try { deps.notify(); } catch { /* advisory, not mutation outcome */ } }
    } catch (error) {
      if (error instanceof AutoReviewSettingsError
        && (error.code === 'invalid_input' || error.code === 'key_required')) {
        return deps.fail('INVALID_PARAMS', 'Invalid Auto-review settings or missing Jev API key.');
      }
      return deps.fail('INTERNAL', 'Auto-review settings could not be updated. Reload settings and try again.');
    }
  };
}
