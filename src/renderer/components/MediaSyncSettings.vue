<template>
  <FtSettingsSection :title="$t('MediaSync.Title')">
    <p>{{ $t('MediaSync.Description') }}</p>
    <p
      role="status"
      aria-live="polite"
    >
      {{ statusText }}
    </p>
    <template v-if="!status.enabled">
      <label for="media-sync-passphrase">{{ $t('MediaSync.Passphrase') }}</label>
      <input
        id="media-sync-passphrase"
        v-model="passphrase"
        type="password"
        autocomplete="off"
        maxlength="128"
        :disabled="busy"
      >
      <FtButton
        :label="$t('MediaSync.Import')"
        :disabled="busy"
        @click="run('import')"
      />
    </template>
    <template v-else>
      <FtButton
        v-if="!status.profilesEnabled"
        :label="$t('MediaSync.EnableProfiles')"
        :disabled="busy"
        @click="run('enable-profiles')"
      />
      <FtButton
        v-if="!status.libraryEnabled"
        :label="$t('MediaSync.EnableLibrary')"
        :disabled="busy"
        @click="run('enable-library')"
      />
      <FtButton
        :label="$t('MediaSync.Sync')"
        :disabled="busy"
        @click="run('sync')"
      />
      <template v-if="status.conflicts">
        <p>{{ $t('MediaSync.Conflict') }}</p>
        <FtButton
          :label="$t('MediaSync.KeepLocal')"
          :disabled="busy"
          @click="run('keep-local')"
        />
        <FtButton
          :label="$t('MediaSync.UseRemote')"
          :disabled="busy"
          @click="run('use-remote')"
        />
      </template>
    </template>
    <FtButton
      v-if="status.enabled || status.code === 'secret_unavailable'"
      :label="$t('MediaSync.Disconnect')"
      :disabled="busy"
      @click="run('disconnect')"
    />
  </FtSettingsSection>
</template>
<script setup>
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import FtSettingsSection from './FtSettingsSection/FtSettingsSection.vue'
import FtButton from './FtButton/FtButton.vue'
const { t } = useI18n()
const status = ref({ enabled: false, code: 'disconnected' })
const passphrase = ref('')
const busy = ref(false)
const statusText = computed(() => {
  const messages = { profiles_upgrade_required: t('MediaSync.ProfilesUpgrade'), unsupported_profiles_version: t('MediaSync.ProfilesUpgrade'), profile_not_portable: t('MediaSync.ProfilesLimit'), library_upgrade_required: t('MediaSync.LibraryUpgrade'), playlist_not_portable: t('MediaSync.LibraryLimit'), invalid_playlist_name: t('MediaSync.LibraryLimit'), disconnected: t('MediaSync.Disconnected'), ready: t('MediaSync.Ready'), server_generation_changed: t('MediaSync.Restored'), synced: t('MediaSync.Synced'), pending: t('MediaSync.Pending'), conflict: t('MediaSync.Conflict'), offline: t('MediaSync.Offline'), restored_service: t('MediaSync.Restored') }
  return messages[status.value.code] ?? t('MediaSync.Failed')
})
async function run(action) {
  if (busy.value) return
  if (['disconnect', 'keep-local', 'use-remote', 'enable-library', 'enable-profiles'].includes(action) && !window.confirm(action === 'enable-library' ? t('MediaSync.LibraryConfirm') : action === 'enable-profiles' ? t('MediaSync.ProfilesConfirm') : t('MediaSync.Confirm'))) return
  busy.value = true
  try { status.value = await window.ftElectron.mediaSync(action, passphrase.value) } catch { status.value = { ...status.value, code: 'failed' } } finally { passphrase.value = ''; busy.value = false }
}
onMounted(() => run('status'))
</script>
