import { useEffect, useId, useMemo, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { SegmentedControl } from '@/components/ui/segmented-control';
import type { AutoReviewProvider, AutoReviewSettingsApi } from '../../../shared/autoReviewSettings.js';
import { createAutoReviewSettingsController } from './autoReviewSettingsController.js';

const unavailableApi: AutoReviewSettingsApi = {
  get: async () => { throw new Error('unavailable'); },
  save: async () => { throw new Error('unavailable'); },
  reset: async () => { throw new Error('unavailable'); },
  deleteKey: async () => { throw new Error('unavailable'); },
  onChanged: () => () => {},
};

export function AutoReviewSection() {
  const { t } = useTranslation();
  const inputId = useId();
  const controller = useMemo(() => createAutoReviewSettingsController(
    window.autoReviewSettings ?? unavailableApi,
  ), []);
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  useEffect(() => {
    controller.start();
    const onFocus = () => controller.notifyChanged();
    window.addEventListener('focus', onFocus);
    return () => { window.removeEventListener('focus', onFocus); controller.stop(); };
  }, [controller]);
  const missingKey = state.provider === 'jev' && !state.view?.hasApiKey && !state.keyDraft.trim();
  const blocked = state.busy || state.stale || !state.view;

  return (
    <div id="settings-auto-review" aria-busy={state.busy}>
      <h2 className="mb-3 text-14 font-medium text-[var(--settings-section-title)]">
        {t('settings.autoReview.title')}
      </h2>
      <p className="mb-3 text-12 leading-relaxed text-[var(--settings-section-desc)]" role="status">{t('settings.autoReview.coverage')}</p>
      <div className="overflow-hidden rounded-xl border border-[var(--settings-theme-card-border)] bg-[var(--settings-theme-card-bg)]">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-[14px]">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <p className="text-13 text-[var(--settings-section-title)]">{t('settings.autoReview.mode')}</p>
            <p className="text-12 leading-relaxed text-[var(--settings-section-desc)]">
              {t('settings.autoReview.description')}
            </p>
          </div>
          <SegmentedControl<AutoReviewProvider>
            value={state.provider}
            disabled={blocked || state.view?.configurationError}
            onValueChange={controller.select}
            aria-label={t('settings.autoReview.mode')}
            options={[
              { value: 'default', label: t('settings.autoReview.original') },
              { value: 'jev', label: t('settings.autoReview.jev') },
            ]}
          />
        </div>
        {state.provider === 'jev' && (
          <div className="space-y-3 border-t border-[var(--settings-theme-card-border)] px-4 py-[14px]">
            <p id={`${inputId}-privacy`} className="text-12 leading-relaxed text-[var(--settings-section-desc)]">
              {t('settings.autoReview.privacy')}
            </p>
            <div className="space-y-1.5">
              <label htmlFor={inputId} className="block text-13 text-[var(--settings-section-title)]">
                {t('settings.autoReview.apiKey')}
              </label>
              <Input
                id={inputId}
                type="password"
                value={state.keyDraft}
                onChange={controller.typeKey}
                maxLength={4096}
                disabled={blocked || state.view?.configurationError}
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                aria-describedby={`${inputId}-privacy ${inputId}-key-status`}
                placeholder={t(state.view?.hasApiKey ? 'settings.autoReview.replaceKey' : 'settings.autoReview.enterKey')}
              />
              <p id={`${inputId}-key-status`} className="text-12 text-[var(--settings-section-desc)]">
                {t(state.view?.hasApiKey ? 'settings.autoReview.keySaved' : 'settings.autoReview.keyRequired')}
              </p>
            </div>
          </div>
        )}
        <div className="space-y-3 border-t border-[var(--settings-theme-card-border)] px-4 py-[14px]">
          {state.view?.configurationError && <p role="alert" className="text-12 text-[var(--settings-section-title)]">{t('settings.autoReview.invalidConfiguration')}</p>}
          {state.error && <p role="alert" className="text-12 text-[var(--settings-section-title)]">{t(`settings.autoReview.${state.error}Error`)}</p>}
          {state.stale && <p role="status" className="text-12 text-[var(--settings-section-desc)]">{t('settings.autoReview.changed')}</p>}
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" disabled={blocked || !!state.view?.configurationError || missingKey} onClick={() => void controller.save()}>
              {t(state.busy ? 'settings.autoReview.working' : 'settings.autoReview.save')}
            </Button>
            <Button variant="secondary" type="button" disabled={blocked || (!state.view?.isCustomized && !state.view?.configurationError)} onClick={() => void controller.reset()}>
              {t('settings.autoReview.restoreDefault')}
            </Button>
            {state.view?.hasApiKey && <Button variant="secondary" type="button" disabled={blocked} onClick={() => void controller.deleteKey()}>
              {t('settings.autoReview.deleteKey')}
            </Button>}
            {(state.error || state.stale) && <Button variant="secondary" type="button" disabled={state.busy} onClick={() => void controller.refresh()}>
              {t('settings.autoReview.reload')}
            </Button>}
          </div>
          <p className="text-12 leading-relaxed text-[var(--settings-section-desc)]">{t('settings.autoReview.restoreHint')}</p>
        </div>
      </div>
    </div>
  );
}
