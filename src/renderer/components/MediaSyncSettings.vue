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
      <h4>{{ $t('MediaSync.SignInTitle') }}</h4>
      <p>{{ $t('MediaSync.SignInHelp') }}</p>
      <label for="media-sync-address">{{ $t('MediaSync.Address') }}</label>
      <input
        id="media-sync-address"
        v-model="address"
        type="url"
        autocomplete="off"
        spellcheck="false"
        maxlength="256"
        :disabled="busy"
      >
      <label for="media-sync-code">{{ $t('MediaSync.Code') }}</label>
      <input
        id="media-sync-code"
        v-model="code"
        type="text"
        autocomplete="off"
        autocapitalize="characters"
        spellcheck="false"
        maxlength="40"
        :disabled="busy"
      >
      <label for="media-sync-label">{{ $t('MediaSync.DeviceName') }}</label>
      <input
        id="media-sync-label"
        v-model="label"
        type="text"
        autocomplete="off"
        maxlength="96"
        :disabled="busy"
      >
      <FtButton
        :label="$t('MediaSync.SignIn')"
        :disabled="busy || !address.trim() || !code.trim() || !label.trim()"
        @click="run('connect')"
      />
      <details>
        <summary>{{ $t('MediaSync.FileInstead') }}</summary>
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
      </details>
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
const address = ref('')
const code = ref('')
const label = ref('DD FreeTube')
const busy = ref(false)
const statusText = computed(() => {
  const messages = { invalid_connect_code: t('MediaSync.CodeRejected'), invalid_code: t('MediaSync.CodeInvalid'), invalid_service_address: t('MediaSync.AddressInvalid'), verified_transport_required: t('MediaSync.AddressInvalid'), invalid_device_label: t('MediaSync.DeviceNameInvalid'), rate_limited: t('MediaSync.TooManyAttempts'), device_quota: t('MediaSync.DeviceQuota'), profiles_upgrade_required: t('MediaSync.ProfilesUpgrade'), unsupported_profiles_version: t('MediaSync.ProfilesUpgrade'), profile_not_portable: t('MediaSync.ProfilesLimit'), library_upgrade_required: t('MediaSync.LibraryUpgrade'), playlist_not_portable: t('MediaSync.LibraryLimit'), invalid_playlist_name: t('MediaSync.LibraryLimit'), disconnected: t('MediaSync.Disconnected'), ready: t('MediaSync.Ready'), server_generation_changed: t('MediaSync.Restored'), synced: t('MediaSync.Synced'), pending: t('MediaSync.Pending'), conflict: t('MediaSync.Conflict'), offline: t('MediaSync.Offline'), restored_service: t('MediaSync.Restored') }
  return messages[status.value.code] ?? t('MediaSync.Failed')
})
async function run(action) {
  if (busy.value) return
  if (['disconnect', 'keep-local', 'use-remote', 'enable-library', 'enable-profiles'].includes(action) && !window.confirm(action === 'enable-library' ? t('MediaSync.LibraryConfirm') : action === 'enable-profiles' ? t('MediaSync.ProfilesConfirm') : t('MediaSync.Confirm'))) return
  busy.value = true
  const input = action === 'connect' ? { address: address.value, code: code.value, label: label.value } : passphrase.value
  try {
    status.value = await window.ftElectron.mediaSync(action, input)
    if (action === 'connect' && status.value.enabled) { code.value = ''; address.value = '' }
  } catch { status.value = { ...status.value, code: 'failed' } } finally { passphrase.value = ''; busy.value = false }
}
onMounted(() => run('status'))
</script>
