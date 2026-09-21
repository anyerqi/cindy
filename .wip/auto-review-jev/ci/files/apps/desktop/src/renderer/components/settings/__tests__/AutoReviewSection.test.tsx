// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AutoReviewSettingsApi, AutoReviewSettingsView } from '../../../../shared/autoReviewSettings.js';
import { AutoReviewSection } from '../AutoReviewSection.js';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/components/ui/tooltip', () => ({ Tip: ({ children }: { children: React.ReactNode }) => children }));
afterEach(() => { cleanup(); delete window.autoReviewSettings; });
function fixture(initial: Partial<AutoReviewSettingsView> = {}) {
  let view: AutoReviewSettingsView = { provider: 'default', isCustomized: false, hasApiKey: false,
    configurationError: false, revision: 'a'.repeat(64), ...initial };
  let changed = () => {};
  const api: AutoReviewSettingsApi = {
    get: vi.fn(async () => ({ ...view })),
    save: vi.fn(async input => {
      view = { ...view, provider: input.provider, isCustomized: true,
        hasApiKey: Boolean(input.apiKey) || view.hasApiKey, revision: 'b'.repeat(64) };
      return { ...view };
    }),
    reset: vi.fn(async () => { view = { ...view, provider: 'default', isCustomized: false }; return { ...view }; }),
    deleteKey: vi.fn(async () => { view = { ...view, provider: 'default', isCustomized: false, hasApiKey: false }; return { ...view }; }),
    onChanged: listener => { changed = listener; return () => { changed = () => {}; }; },
  };
  window.autoReviewSettings = api;
  return { api, update: (next: Partial<AutoReviewSettingsView>) => { view = { ...view, ...next }; changed(); } };
}
async function ready() {
  await waitFor(() => expect(screen.getByRole('radio', { name: 'settings.autoReview.jev' })).not.toBeDisabled());
}
describe('client Auto-review settings', () => {
  it('defaults to original; requires a new key before saving Jev and clears the typed value', async () => {
    const { api } = fixture(); render(<AutoReviewSection />); await ready();
    expect(screen.getByRole('radio', { name: 'settings.autoReview.original' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.queryByLabelText('settings.autoReview.apiKey')).toBeNull();
    fireEvent.click(screen.getByRole('radio', { name: 'settings.autoReview.jev' }));
    expect(screen.getByRole('button', { name: 'settings.autoReview.save' })).toBeDisabled();
    const input = screen.getByLabelText('settings.autoReview.apiKey') as HTMLInputElement;
    expect(input.type).toBe('password');
    fireEvent.change(input, { target: { value: 'fake-typesafe-key' } });
    fireEvent.click(screen.getByRole('button', { name: 'settings.autoReview.save' }));
    await waitFor(() => expect(api.save).toHaveBeenCalledWith({ provider: 'jev', expectedRevision: 'a'.repeat(64), apiKey: 'fake-typesafe-key' }));
    await ready();
    expect((screen.getByLabelText('settings.autoReview.apiKey') as HTMLInputElement).value).toBe('');
    expect(screen.getByText('settings.autoReview.keySaved')).toBeTruthy();
    expect(document.body.textContent).not.toContain('fake-typesafe-key');
  });
  it('retains a saved key when blank and restores defaults independently of deleting it', async () => {
    const { api } = fixture({ provider: 'jev', isCustomized: true, hasApiKey: true });
    render(<AutoReviewSection />); await ready();
    fireEvent.click(screen.getByRole('button', { name: 'settings.autoReview.save' }));
    await waitFor(() => expect(api.save).toHaveBeenCalledWith({ provider: 'jev', expectedRevision: 'a'.repeat(64) }));
    await ready();
    fireEvent.click(screen.getByRole('button', { name: 'settings.autoReview.restoreDefault' }));
    await waitFor(() => expect(api.reset).toHaveBeenCalledOnce());
    await ready();
    expect(api.deleteKey).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'settings.autoReview.deleteKey' }));
    await waitFor(() => expect(api.deleteKey).toHaveBeenCalledOnce());
  });
  it('does not overwrite settings when another window changes them during editing', async () => {
    const f = fixture({ provider: 'jev', hasApiKey: true }); render(<AutoReviewSection />); await ready();
    fireEvent.change(screen.getByLabelText('settings.autoReview.apiKey'), { target: { value: 'fake-new-key' } });
    await act(async () => f.update({ revision: 'c'.repeat(64) }));
    await waitFor(() => expect(screen.getByText('settings.autoReview.changed')).toBeTruthy());
    expect(screen.getByRole('button', { name: 'settings.autoReview.save' })).toBeDisabled();
    expect(f.api.save).not.toHaveBeenCalled();
  });
});
