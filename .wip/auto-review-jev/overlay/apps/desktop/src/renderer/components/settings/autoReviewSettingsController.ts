import type { AutoReviewProvider, AutoReviewSettingsApi, AutoReviewSettingsView } from '../../../shared/autoReviewSettings.js';

export interface AutoReviewFormState {
  view: AutoReviewSettingsView | null;
  provider: AutoReviewProvider;
  /** Only the newly typed value; a saved key is never returned by Main. */
  keyDraft: string;
  busy: boolean;
  stale: boolean;
  error: 'load' | 'save' | null;
}

/** View controller shared by the component and offline race/credential tests. */
export function createAutoReviewSettingsController(api: AutoReviewSettingsApi) {
  let state: AutoReviewFormState = {
    view: null, provider: 'default', keyDraft: '', busy: true, stale: false, error: null,
  };
  let active = false;
  let generation = 0;
  let stopChanges: (() => void) | undefined;
  const listeners = new Set<() => void>();
  const publish = (patch: Partial<AutoReviewFormState>) => {
    state = { ...state, ...patch };
    for (const listener of listeners) listener();
  };
  const current = (id: number) => active && generation === id;
  const dirty = () => state.keyDraft.length > 0 || state.provider !== state.view?.provider;
  function install(view: AutoReviewSettingsView) {
    publish({ view, provider: view.provider ?? 'default', keyDraft: '', stale: false });
  }
  async function reload(): Promise<void> {
    if (!active || state.busy && state.view !== null) return;
    const id = ++generation;
    publish({ busy: true, keyDraft: '', error: null });
    try {
      const view = await api.get();
      if (current(id)) install(view);
    } catch {
      if (current(id)) publish({ error: 'load', stale: true });
    } finally {
      if (current(id)) publish({ busy: false });
    }
  }
  async function mutate(kind: 'save' | 'reset' | 'deleteKey'): Promise<void> {
    if (!active || state.busy || state.stale || !state.view) return;
    if (kind === 'save' && (state.view.configurationError
      || (state.provider === 'jev' && !state.view.hasApiKey && !state.keyDraft.trim()))) return;
    const id = ++generation;
    const provider = state.provider;
    const apiKey = provider === 'jev' && state.keyDraft.trim() ? state.keyDraft.trim() : undefined;
    const expectedRevision = state.view.revision;
    // Drop the UI copy immediately, including on errors and navigation.
    publish({ busy: true, keyDraft: '', error: null });
    let failed = false;
    try {
      if (kind === 'save') {
        await api.save({ provider, expectedRevision, ...(apiKey === undefined ? {} : { apiKey }) });
      } else {
        await api[kind]({ expectedRevision });
      }
    } catch { failed = true; }
    if (!current(id)) return;
    // A different window may have written after our mutation. Read authoritative
    // state instead of trusting an older mutation response or optimistic UI state.
    try {
      const view = await api.get();
      if (current(id)) { install(view); publish({ error: failed ? 'save' : null }); }
    } catch {
      if (current(id)) publish({ stale: true, error: failed ? 'save' : 'load' });
    } finally {
      if (current(id)) publish({ busy: false });
    }
  }
  const changed = () => {
    if (!active || state.busy) return; // Mutations always reload after settling.
    const id = ++generation;
    // Focus and notification are hints, not proof of a different configuration.
    // Preserve an unsaved key when the authoritative revision is unchanged.
    void api.get().then((view) => {
      if (!current(id) || state.busy) return;
      if (view.revision === state.view?.revision) return;
      if (dirty()) publish({ stale: true });
      else install(view);
    }).catch(() => {
      if (current(id) && !state.busy) publish({ stale: true, error: 'load' });
    });
  };
  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    start() {
      if (active) return;
      active = true;
      stopChanges = api.onChanged(changed);
      // React strict-mode setup/cleanup/setup must restart the initial read.
      state = { ...state, busy: false };
      void reload();
    },
    stop() {
      active = false;
      generation++;
      stopChanges?.();
      stopChanges = undefined;
      state = { ...state, keyDraft: '', busy: false };
    },
    select(provider: AutoReviewProvider) {
      if (state.busy) return;
      publish({ provider, ...(provider === 'default' ? { keyDraft: '' } : {}) });
    },
    typeKey(keyDraft: string) {
      if (!state.busy && state.provider === 'jev') publish({ keyDraft: keyDraft.slice(0, 4_096) });
    },
    refresh: reload,
    notifyChanged: changed,
    save: () => mutate('save'),
    reset: () => mutate('reset'),
    deleteKey: () => mutate('deleteKey'),
  };
}
