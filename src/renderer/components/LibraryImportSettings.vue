<template>
  <section aria-labelledby="library-import-title">
    <h4 id="library-import-title">
      {{ t('LibraryImport.Title') }}
    </h4>
    <p>{{ t('LibraryImport.Description') }}</p>
    <FtButton
      :label="t('LibraryImport.Choose')"
      :disabled="busy"
      @click="run('preview')"
    />
    <template v-if="preview">
      <pre class="import-preview">{{ summary }}</pre>
      <p>{{ t('LibraryImport.MergeHelp') }}</p>
      <FtButton
        :label="t('LibraryImport.Confirm')"
        :disabled="busy"
        @click="run('commit')"
      />
      <FtButton
        :label="t('LibraryImport.Cancel')"
        :disabled="busy"
        @click="run('cancel')"
      />
    </template>
    <template v-if="pending">
      <p>{{ t('LibraryImport.Pending') }}</p>
      <FtButton
        :label="t('LibraryImport.Resume')"
        :disabled="busy"
        @click="run('resume')"
      />
      <FtButton
        :label="t('LibraryImport.Discard')"
        :disabled="busy"
        @click="run('discard')"
      />
    </template>
    <p
      role="status"
      aria-live="polite"
    >
      {{ status }}
    </p>
  </section>
</template>
<script setup>
import { computed, ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import FtButton from './FtButton/FtButton.vue'
const { t } = useI18n()
const preview = ref(null); const busy = ref(false); const pending = ref(false); const status = ref('')
onMounted(async () => { const result = await window.ftElectron.libraryImport('pending'); pending.value = !!result.pending })
const summary = computed(() => {
  const value = preview.value; if (!value) return ''
  const names = { subscription: t('LibraryImport.Subscriptions'), profile: t('LibraryImport.Categories'), 'profile-member': t('LibraryImport.Memberships'), playlist: t('LibraryImport.Playlists'), 'watch-later': t('LibraryImport.WatchLater'), history: t('LibraryImport.History'), resume: t('LibraryImport.Progress') }
  const lines = [...value.sources, ...Object.entries(value.counts).map(([kind, n]) => names[kind] + ': ' + n), t('LibraryImport.Unchanged') + ': ' + value.retained]
  const unsupported = value.warnings.reduce((n, w) => n + w.unsupported + w.remotePlaylists, 0)
  lines.push(t('LibraryImport.Unsupported') + ': ' + unsupported)
  return lines.join('\n')
})
async function run(action) {
  if (busy.value) return
  busy.value = true
  try {
    const result = await window.ftElectron.libraryImport(action)
    if (result.preview) { preview.value = result.preview; pending.value = !!result.preview.pending; status.value = t('LibraryImport.Review') } else if (result.code) { pending.value = !!result.pending; status.value = result.code === 'unfinished_import' ? t('LibraryImport.Pending') : result.code === 'import_recovery_review_required' ? t('LibraryImport.RecoveryReview') : t('LibraryImport.Failed') } else { preview.value = null; pending.value = false; status.value = result.done ? t('LibraryImport.Done') : t('LibraryImport.Canceled') }
  } catch { status.value = t('LibraryImport.Failed') } finally { busy.value = false }
}
</script>
<style scoped src="./LibraryImportSettings.css" />
