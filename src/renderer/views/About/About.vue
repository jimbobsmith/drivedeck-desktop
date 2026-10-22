<template>
  <div>
    <FtCard class="card">
      <h2>
        <FontAwesomeIcon
          :icon="['fas', 'info-circle']"
          class="headingIcon"
        />
        {{ $t("About.About") }}
      </h2>
      <section class="brand">
        <FtLogoFull class="logo" />
        <div class="version">
          {{ versionNumber }} {{ $t("DDUpdates.Preview") }}
        </div>
      </section>
      <section class="about-chunks">
        <figure
          v-for="chunk in chunks"
          :key="chunk.title"
          class="chunk"
        >
          <FontAwesomeIcon
            class="icon"
            :icon="chunk.icon"
          />
          <h3 class="title">
            {{ chunk.title }}
          </h3>
          <div
            v-safer-html="chunk.content"
            class="content"
          />
        </figure>
      </section>
    </FtCard>
  </div>
</template>

<script setup>
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import FtCard from '../../components/ft-card/ft-card.vue'
import FtLogoFull from '../../components/FtLogoFull/FtLogoFull.vue'
import { vSaferHtml } from '../../directives/vSaferHtml.js'

import packageDetails from '../../../../package.json'

const { t } = useI18n()

const versionNumber = `v${packageDetails.version}`

const chunks = computed(() => [
  {
    icon: ['fab', 'github'],
    title: t('About.Source code'),
    content: [
      '<a href="https://github.com/jimbobsmith/drivedeck-desktop" lang="en" dir="ltr">GitHub: DD FreeTube</a>',
      '<a href="https://github.com/FreeTubeApp/FreeTube" lang="en" dir="ltr">Upstream: FreeTubeApp/FreeTube</a>',
      t('About.Licensed under the {licenseLink}', {
        licenseLink: `<a href="https://www.gnu.org/licenses/agpl-3.0.en.html">${t('About.AGPLv3')}</a>`,
      }),
    ].join('<br>'),
  },
  {
    icon: ['fas', 'file-download'],
    title: t('About.Downloads / Changelog'),
    content: `<a href="https://github.com/jimbobsmith/drivedeck-desktop/releases">${t('About.GitHub releases')}</a>`,
  },
  {
    icon: ['fas', 'question-circle'],
    title: t('DDUpdates.UpstreamGuides'),
    content: [
      `<a href="https://docs.freetubeapp.io/">${t('About.FreeTube Wiki')}</a>`,
      `<a href="https://docs.freetubeapp.io/faq/">${t('About.FAQ')}</a>`
    ].join(' / '),
  },
  {
    icon: ['fas', 'exclamation-circle'],
    title: t('About.Report a problem'),
    content: [
      `<a href="https://github.com/jimbobsmith/drivedeck-desktop/issues">${t('About.GitHub issues')}</a>`,
      t('About.Please check for duplicates before posting'),
    ].join('<br>'),
  },
  {
    icon: ['fas', 'globe'],
    title: t('About.Website'),
    content: '<a href="https://github.com/jimbobsmith/drivedeck-desktop">DD FreeTube</a>',
  },
  {
    icon: ['fas', 'users'],
    title: t('About.Credits'),
    content: t('About.FreeTube is made possible by {creditsPageLink}', {
      creditsPageLink: `<a href="https://docs.freetubeapp.io/credits/">${t('About.these people and projects')}</a>`,
    }),
  }
])
</script>

<style scoped src="./About.css" />
