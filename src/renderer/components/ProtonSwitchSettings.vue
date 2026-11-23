<template>
  <FtSettingsSection :title="t('ProtonSwitch.Title')">
    <p
      role="status"
      aria-live="polite"
    >
      {{ statusText }}
    </p>
    <p>{{ t('ProtonSwitch.Description') }}</p>
    <ft-flex-box v-if="state.code !== 'unsupported'">
      <FtSelect
        :placeholder="t('ProtonSwitch.Mode')"
        :value="mode"
        :select-names="modeNames"
        :select-values="SWITCH_MODES"
        :icon="['fas', 'shield']"
        @change="setMode"
      />
    </ft-flex-box>
    <FtButton
      v-if="canSwitchNow"
      :label="t('ProtonSwitch.SwitchNow')"
      @click="switchNow"
    />
  </FtSettingsSection>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import FtButton from './FtButton/FtButton.vue'
import FtFlexBox from './ft-flex-box/ft-flex-box.vue'
import FtSelect from './FtSelect/FtSelect.vue'
import FtSettingsSection from './FtSettingsSection/FtSettingsSection.vue'
import store from '../store/index'
import { SWITCH_MODES } from '../helpers/proton-block.mjs'

const { t } = useI18n()

const state = ref({ code: 'unknown' })
const mode = computed(() => store.getters.getProtonSwitchMode)
const modeNames = computed(() => [t('ProtonSwitch.ModeAutomatic'), t('ProtonSwitch.ModeAsk'), t('ProtonSwitch.ModeOff')])

const statusText = computed(() => {
  const { code, connected, server, message } = state.value
  switch (code) {
    case 'ready':
      if (connected === true && server) return t('ProtonSwitch.StatusConnected', { server })
      if (connected === false) return t('ProtonSwitch.StatusDisconnected')
      return t('ProtonSwitch.StatusReady')
    case 'switching': return t('ProtonSwitch.StatusSwitching')
    case 'switched': return server ? t('ProtonSwitch.StatusSwitched', { server }) : t('ProtonSwitch.StatusReady')
    case 'failed': return t('ProtonSwitch.StatusFailed', { message: message || t('ProtonSwitch.NoReason') })
    case 'no-answer': return t('ProtonSwitch.StatusNoAnswer')
    case 'busy': return t('ProtonSwitch.StatusBusy')
    case 'unavailable': return t('ProtonSwitch.StatusUnavailable')
    case 'unsupported': return t('ProtonSwitch.StatusUnsupported')
    default: return t('ProtonSwitch.StatusChecking')
  }
})

// A switch needs the app running, connected or not, and nothing else in progress.
const canSwitchNow = computed(() => ['ready', 'switched', 'failed', 'no-answer'].includes(state.value.code))

function setMode(value) {
  if (SWITCH_MODES.includes(value)) store.dispatch('updateProtonSwitchMode', value)
}

async function refresh() {
  try { state.value = await window.ftElectron.protonSwitch('status') } catch { state.value = { code: 'unavailable' } }
}

async function switchNow() {
  state.value = { code: 'switching' }
  try { state.value = await window.ftElectron.protonSwitch('switch') } catch { state.value = { code: 'failed' } }
}

let timer
let stopListening
onMounted(() => {
  refresh()
  timer = setInterval(() => { if (state.value.code !== 'switching') refresh() }, 5000)
  stopListening = window.ftElectron.onProtonSwitchState(next => { state.value = next })
})
onBeforeUnmount(() => {
  clearInterval(timer)
  stopListening?.()
})
</script>
