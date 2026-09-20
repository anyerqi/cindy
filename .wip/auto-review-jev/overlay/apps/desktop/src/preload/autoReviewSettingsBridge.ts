import { AUTO_REVIEW_SETTINGS, type AutoReviewSettingsApi } from '../shared/autoReviewSettings.js';
interface IpcPort {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>;
  on(channel: string, listener: () => void): unknown;
  removeListener(channel: string, listener: () => void): unknown;
}
/** Expose named operations only; callers cannot choose an IPC channel. */
export function createAutoReviewSettingsBridge(ipc: IpcPort): AutoReviewSettingsApi {
  return Object.freeze({
    get: () => ipc.invoke(AUTO_REVIEW_SETTINGS.get) as ReturnType<AutoReviewSettingsApi['get']>,
    save: (input: Parameters<AutoReviewSettingsApi['save']>[0]) =>
      ipc.invoke(AUTO_REVIEW_SETTINGS.save, input) as ReturnType<AutoReviewSettingsApi['save']>,
    reset: (input: Parameters<AutoReviewSettingsApi['reset']>[0]) =>
      ipc.invoke(AUTO_REVIEW_SETTINGS.reset, input) as ReturnType<AutoReviewSettingsApi['reset']>,
    deleteKey: (input: Parameters<AutoReviewSettingsApi['deleteKey']>[0]) =>
      ipc.invoke(AUTO_REVIEW_SETTINGS.deleteKey, input) as ReturnType<AutoReviewSettingsApi['deleteKey']>,
    onChanged(listener: () => void) {
      // Electron event and any unsolicited payload are deliberately discarded.
      const changed = () => listener();
      ipc.on(AUTO_REVIEW_SETTINGS.changed, changed);
      return () => { ipc.removeListener(AUTO_REVIEW_SETTINGS.changed, changed); };
    },
  });
}
