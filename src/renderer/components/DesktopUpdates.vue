<template>
  <component
    :is="compact ? 'section' : FtSettingsSection"
    v-if="!compact || visible"
    :title="t('DDUpdates.Title')"
    :aria-label="t('DDUpdates.Title')"
  >
    <p
      role="status"
      aria-live="polite"
    >
      {{ message }}
    </p>
    <template v-if="!compact">
      <p>{{ t('DDUpdates.Description') }}</p>
      <FtButton
        :label="t('DDUpdates.Check')"
        :disabled="busy"
        @click="run('check')"
      />
      <FtButton
        :label="t('DDUpdates.Releases')"
        @click="run('releases')"
      />
    </template>
    <FtButton
      v-if="status.code === 'available'"
      :label="t('DDUpdates.Download')"
      :disabled="busy"
      @click="run('download')"
    />
    <FtButton
      v-if="status.code === 'downloaded'"
      :label="t('DDUpdates.Install')"
      :disabled="busy"
      @click="run('install')"
    />
  </component>
</template>
<script setup>
import { computed, onMounted, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import FtButton from './FtButton/FtButton.vue'
import FtSettingsSection from './FtSettingsSection/FtSettingsSection.vue'
import { AutomaticUpdateChecks } from '../helpers/desktop-update-checks.mjs'
const { t } = useI18n()
const props = defineProps({ compact: Boolean, automatic: Boolean })
const status = ref({ code: 'idle' })
const busy = ref(false)
const visible = computed(() => ['available', 'downloading', 'downloaded'].includes(status.value.code))
const message = computed(() => {
  const messages = {
    idle: t('DDUpdates.Version', { version: status.value.current ?? '' }),
    checking: t('DDUpdates.Checking'),
    current: t('DDUpdates.Current'),
    available: t('DDUpdates.Available', { version: status.value.version }),
    downloading: t('DDUpdates.Progress', { percent: status.value.percent ?? 0 }),
    downloaded: t('DDUpdates.Ready', { version: status.value.version }),
    failed: t('DDUpdates.Failed'),
    manual: t('DDUpdates.Manual')
  }
  return messages[status.value.code] ?? t('DDUpdates.Failed')
})
async function run(action) {
  if (busy.value && action !== 'status') return
  if (action !== 'status') busy.value = true
  try { status.value = await window.ftElectron.desktopUpdates(action) } catch { status.value = { code: 'failed' } } finally { if (action !== 'status') busy.value = false }
}
let statusTimer
const checks = new AutomaticUpdateChecks(() => run('check'))
onMounted(() => {
  run('status')
  statusTimer = setInterval(() => run('status'), 2000)
  if (props.compact) checks.setEnabled(props.automatic)
})
watch(() => props.automatic, enabled => { if (props.compact) checks.setEnabled(enabled) })
onBeforeUnmount(() => { clearInterval(statusTimer); checks.dispose() })
</script>
