/** Local Desktop settings. No channel accepts a URL or returns a credential. */
export type AutoReviewProvider = 'default' | 'jev';
export const AUTO_REVIEW_SETTINGS = Object.freeze({
  get: 'auto-review-settings:get',
  save: 'auto-review-settings:save',
  reset: 'auto-review-settings:reset',
  deleteKey: 'auto-review-settings:delete-key',
  changed: 'auto-review-settings:changed',
});
export interface AutoReviewSettingsView {
  provider: AutoReviewProvider | null;
  isCustomized: boolean;
  hasApiKey: boolean;
  /** Opaque optimistic-concurrency token; also binds this form to its data owner. */
  revision: string;
  configurationError: boolean;
}
export interface AutoReviewSettingsSave {
  provider: AutoReviewProvider;
  expectedRevision: string;
  /** Omit to retain the existing key. An empty string never deletes a key. */
  apiKey?: string;
}
export interface AutoReviewSettingsMutation {
  expectedRevision: string;
}
export interface AutoReviewSettingsApi {
  get(): Promise<AutoReviewSettingsView>;
  save(input: AutoReviewSettingsSave): Promise<AutoReviewSettingsView>;
  reset(input: AutoReviewSettingsMutation): Promise<AutoReviewSettingsView>;
  deleteKey(input: AutoReviewSettingsMutation): Promise<AutoReviewSettingsView>;
  onChanged(listener: () => void): () => void;
}
declare global {
  interface Window { autoReviewSettings?: AutoReviewSettingsApi; }
}
