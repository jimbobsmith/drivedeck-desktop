<template>
  <div
    class="protonSwitch"
    role="status"
    aria-live="polite"
  >
    <p class="protonSwitchStatus">
      <FontAwesomeIcon
        :icon="icon"
        :spin="working"
        aria-hidden="true"
      />
      {{ message }}
    </p>
    <p
      v-if="state.phase === 'ask'"
      class="protonSwitchQuestion"
    >
      {{ t('ProtonSwitch.AskQuestion') }}
    </p>
    <div
      v-if="actions.length > 0"
      class="protonSwitchActions"
    >
      <FtButton
        v-for="action in actions"
        :key="action.event"
        :label="action.label"
        :text-color="action.primary ? 'var(--text-with-accent-color)' : 'var(--primary-text-color)'"
        :background-color="action.primary ? 'var(--accent-color)' : 'var(--card-bg-color)'"
        @click="fire(action.event)"
      />
    </div>
  </div>
</template>

<script setup>
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import FtButton from './FtButton/FtButton.vue'

const { t } = useI18n()

const props = defineProps({
  /** { phase, server?, message?, count? } from the Watch page */
  state: { type: Object, required: true }
})
const emit = defineEmits(['switch', 'dismiss', 'reload', 'recheck'])

const working = computed(() => ['checking', 'switching', 'network', 'replaying'].includes(props.state.phase))

const icon = computed(() => {
  if (working.value) return ['fas', 'rotate-right']
  if (props.state.phase === 'ask') return ['fas', 'shield']
  return ['fas', 'circle-exclamation']
})

const message = computed(() => {
  const { phase, server, message: detail, count } = props.state
  switch (phase) {
    case 'checking': return t('ProtonSwitch.Checking')
    case 'ask': return t('ProtonSwitch.Ask')
    case 'switching': return t('ProtonSwitch.Switching')
    case 'network': return server ? t('ProtonSwitch.CheckingNetwork', { server }) : t('ProtonSwitch.CheckingNetworkNoServer')
    case 'replaying': return server ? t('ProtonSwitch.Replaying', { server }) : t('ProtonSwitch.ReplayingNoServer')
    case 'failed': return t('ProtonSwitch.Failed', { message: detail || t('ProtonSwitch.NoReason') })
    case 'no-answer': return t('ProtonSwitch.NoAnswer')
    case 'busy': return t('ProtonSwitch.Busy')
    case 'unavailable': return t('ProtonSwitch.Unavailable')
    case 'paused-video': return t('ProtonSwitch.PausedVideo', { count })
    case 'paused': return t('ProtonSwitch.Paused', { count })
    default: return ''
  }
})

function fire(event) {
  switch (event) {
    case 'switch': emit('switch'); break
    case 'dismiss': emit('dismiss'); break
    case 'reload': emit('reload'); break
    case 'recheck': emit('recheck'); break
  }
}

// Only the actions that can work in this state.
const actions = computed(() => {
  switch (props.state.phase) {
    case 'ask':
      return [
        { event: 'switch', label: t('ProtonSwitch.SwitchAndContinue'), primary: true },
        { event: 'dismiss', label: t('ProtonSwitch.NotNow') }
      ]
    case 'failed':
    case 'paused':
    case 'paused-video':
      return [
        { event: 'switch', label: t('ProtonSwitch.SwitchAgain'), primary: true },
        { event: 'reload', label: t('ProtonSwitch.ReloadVideo') }
      ]
    case 'no-answer':
      return [{ event: 'reload', label: t('ProtonSwitch.ReloadVideo'), primary: true }]
    case 'busy':
    case 'unavailable':
      return [{ event: 'recheck', label: t('ProtonSwitch.CheckAgain'), primary: true }]
    default:
      return []
  }
})
</script>

<style scoped>
.protonSwitch {
  margin-block-start: 12px;
  text-align: center;
}

.protonSwitchStatus {
  font-weight: bold;
}

.protonSwitchActions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: center;
}
</style>
