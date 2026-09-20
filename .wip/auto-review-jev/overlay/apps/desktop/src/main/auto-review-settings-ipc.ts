import { ipcMain, type IpcMainInvokeEvent, type WebContents } from 'electron';
import { AUTO_REVIEW_SETTINGS } from '../shared/autoReviewSettings.js';
import { assertTrustedAppRendererEvent } from './security/trustedAppRenderer.js';
import { throwIpcError } from './utils/ipcValidate.js';
import { createAutoReviewSettingsHandler } from './maker-host/auto-review/settings-handler.js';

let registered = false;
const readers = new Set<WebContents>();
// Lazy-load stores only in an explicit, trusted settings action, never during startup.
const load = async () => (await import('./maker-host/auto-review/settings-store.js')).getAutoReviewSettingsService();
export function registerAutoReviewSettingsIpc(): void {
  if (registered) return;
  registered = true;
  function trust(event: IpcMainInvokeEvent) {
    assertTrustedAppRendererEvent(event);
    if (!readers.has(event.sender)) {
      readers.add(event.sender);
      event.sender.once('destroyed', () => readers.delete(event.sender));
    }
  }
  const notify = () => {
    for (const sender of readers) {
      if (sender.isDestroyed()) { readers.delete(sender); continue; }
      try { sender.send(AUTO_REVIEW_SETTINGS.changed); } catch { /* closing window */ }
    }
  };
  const handle = createAutoReviewSettingsHandler<IpcMainInvokeEvent>({
    assertTrusted: trust, load, notify, fail: throwIpcError,
  });
  ipcMain.handle(AUTO_REVIEW_SETTINGS.get, handle('get'));
  ipcMain.handle(AUTO_REVIEW_SETTINGS.save, handle('save'));
  ipcMain.handle(AUTO_REVIEW_SETTINGS.reset, handle('reset'));
  ipcMain.handle(AUTO_REVIEW_SETTINGS.deleteKey, handle('deleteKey'));
}
