<template>
  <article :class="['dep-item', listMode ? 'is-row' : 'is-card', `is-${statusClass}`]">
    <div class="dep-icon" aria-hidden="true">
      <market-icon :name="icon"></market-icon>
    </div>

    <div class="dep-main">
      <div class="dep-title">
        <h3 :title="name">
          <a v-if="titleLink" :href="titleLink" :title="titleLink" target="_blank" rel="noopener noreferrer">{{ displayName }}</a>
          <template v-else>{{ displayName }}</template>
        </h3>
        <span v-if="showTag" :class="['dep-tag', `is-${statusClass}`]">{{ statusLabel }}</span>
      </div>
      <a v-if="displayName !== name && npmLink" class="dep-name" :href="npmLink" :title="npmLink" target="_blank" rel="noopener noreferrer">{{ name }}</a>
      <span v-else-if="displayName !== name" class="dep-name" :title="name">{{ name }}</span>
      <!-- Rendered even when empty so every card has the same height. -->
      <p v-if="!listMode" class="dep-summary" :title="summaryText">{{ summaryText }}</p>
    </div>

    <p v-if="listMode && summaryText" class="dep-summary" :title="summaryText">{{ summaryText }}</p>

    <!-- The picker takes the place of the target version, so the row keeps its shape while editing. -->
    <div class="dep-version" :title="versionTitle">
      <span>{{ currentText }}</span>
      <template v-if="showPicker">
        <span class="dep-arrow">→</span>
        <version-picker
          v-model="selectedVersion"
          :versions="data"
          :current="dep?.resolved"
          :latest="latestVersion"
          :removable="!!dep"
          :pending="pending"
          :placeholder="t('dependencyCard.picker.placeholder')"
          :remove-value="removeValue"
          :mode-class="modeClass"
        ></version-picker>
      </template>
      <template v-else-if="showTarget">
        <span class="dep-arrow">→</span>
        <strong :class="{ 'is-remove': pendingRemove }">{{ targetText }}</strong>
      </template>
      <span v-if="showVersionControl && !data" class="dep-muted">{{ compactStatusText }}</span>
    </div>

    <p v-if="showDetailText" :class="['dep-detail', { 'is-danger': statusClass === 'error' }]">{{ detailText }}</p>

    <div v-if="showActions" class="dep-actions">
      <el-button v-if="pending" size="small" @click="clearOverride">{{ t('dependencyCard.actions.undo') }}</el-button>
      <el-button v-if="showQuickUpdate" size="small" type="primary" @click="selectedVersion = latestVersion">
        {{ t('dependencyCard.actions.update') }}
      </el-button>
      <el-button v-if="showConfigure" size="small" type="primary" :loading="configuring" @click="configure">
        {{ t('dependencyCard.actions.addConfig') }}
      </el-button>
      <el-button v-if="showBindLocal" size="small" type="primary" :loading="bindingLocal" @click="showLocalBindingDialog = true">
        {{ t('dependencyCard.actions.bindLocal') }}
      </el-button>
      <el-button v-if="showRestoreUpdate" size="small" @click="restoreUpdate">{{ t('dependencyCard.actions.restorePrompt') }}</el-button>
      <el-button v-if="showManageBundle" size="small" @click="openBundlePanel">{{ t('dependencyCard.actions.manage') }}</el-button>
    </div>

    <el-dropdown v-if="menuItems.length" class="dep-menu" trigger="click" placement="bottom-end" @command="onCommand">
      <el-button size="small" class="dep-more" :title="t('dependencyCard.actions.more')" :aria-label="t('dependencyCard.actions.more')">
        <k-icon name="activity:ellipsis"></k-icon>
      </el-button>
      <template #dropdown>
        <el-dropdown-menu>
          <el-dropdown-item
            v-for="item in menuItems"
            :key="item.command"
            :command="item.command"
            :divided="item.danger"
            :class="['dep-menu-item', { 'dep-menu-danger': item.danger }]"
          >
            <k-icon :name="item.icon"></k-icon>
            <span>{{ item.label }}</span>
          </el-dropdown-item>
        </el-dropdown-menu>
      </template>
    </el-dropdown>
  </article>

  <el-dialog
    v-model="showIgnoreDialog"
    class="market-dialog"
    width="520px"
    append-to-body
    destroy-on-close
    :title="t('dependencyCard.ignore.title')"
  >
    <div class="dep-dialog-body">
      <p>{{ t('dependencyCard.ignore.intro', { name: displayName, version: latestVersion }) }}</p>
      <el-radio-group v-model="ignoreMode" class="dep-ignore-mode">
        <el-radio value="version">{{ t('dependencyCard.ignore.thisVersion') }}</el-radio>
        <el-radio value="package">{{ t('dependencyCard.ignore.permanent') }}</el-radio>
      </el-radio-group>
      <template v-if="ignoreMode === 'version'">
        <div class="dep-ignore-field">
          <span>{{ t('dependencyCard.ignore.duration') }}</span>
          <el-select v-model="ignoreDurationPreset">
            <el-option value="forever" :label="t('dependencyCard.ignore.forever')"></el-option>
            <el-option value="1d" :label="t('dependencyCard.ignore.day', { count: 1 })"></el-option>
            <el-option value="7d" :label="t('dependencyCard.ignore.day', { count: 7 })"></el-option>
            <el-option value="30d" :label="t('dependencyCard.ignore.day', { count: 30 })"></el-option>
            <el-option value="custom" :label="t('dependencyCard.ignore.custom')"></el-option>
          </el-select>
        </div>
        <div v-if="ignoreDurationPreset === 'custom'" class="dep-ignore-field">
          <span>{{ t('dependencyCard.ignore.customDays') }}</span>
          <el-input-number v-model="ignoreCustomDays" :min="1" :max="3650" :step="1" controls-position="right"></el-input-number>
        </div>
        <div class="dep-ignore-field">
          <span>{{ t('dependencyCard.ignore.versionCount') }}</span>
          <el-input-number v-model="ignoreCount" :min="1" :max="20" :step="1" controls-position="right"></el-input-number>
        </div>
      </template>
      <p class="dep-dialog-note">
        {{ ignoreMode === 'package' ? t('dependencyCard.ignore.permanentNote') : t('dependencyCard.ignore.durationNote') }}
      </p>
    </div>
    <template #footer>
      <el-button @click="showIgnoreDialog = false">{{ t('dependencyCard.ignore.cancel') }}</el-button>
      <el-button type="primary" :loading="ignoreSaving" @click="confirmIgnoreUpdate">{{ t('dependencyCard.ignore.confirm') }}</el-button>
    </template>
  </el-dialog>

  <el-dialog
    v-model="showLocalBindingDialog"
    class="market-dialog"
    width="520px"
    append-to-body
    destroy-on-close
    :title="t('dependencyCard.localBinding.title')"
  >
    <div class="dep-dialog-body">
      <p>{{ t('dependencyCard.localBinding.description', { name: displayName }) }}</p>
      <k-comment type="warning"><p>{{ t('dependencyCard.localBinding.note') }}</p></k-comment>
    </div>
    <template #footer>
      <el-button @click="showLocalBindingDialog = false">{{ t('dependencyCard.localBinding.cancel') }}</el-button>
      <el-button type="primary" :loading="bindingLocal" @click="confirmLocalBinding">{{ t('dependencyCard.localBinding.confirm') }}</el-button>
    </template>
  </el-dialog>

  <bundle-uninstall
    v-model="showBundleUninstallDialog"
    :package-name="name"
    :record="bundleRecord"
  ></bundle-uninstall>

  <package-history
    v-model="showPackageHistoryDialog"
    :package-name="name"
    :current-version="installedVersion"
    @select-version="selectHistoryVersion"
  ></package-history>
</template>

<script lang="ts" setup>

import { computed, ref } from 'vue'
import { message, send, store, useConfig, useContext } from '@koishijs/client'
import type { SearchObject } from '@koishijs/registry'
import { isBundlePackageName, PLUGIN_PACKAGE_RE } from '../../src/shared/bundle'
import { isLocalDependency } from '../../src/shared/dependency-source'
import { createUpdateIgnoreRule, day, getBundleRecords, getFrontendMode, getIgnoredUpdateVersion, getLatestVersion, getMarketNextPolicy, getPendingOverrides, getWritableMarketNextPolicy, getUpdateIgnoreText, hasUpdate, isUpdateCheckDisabled, isUpdateIgnored, patchMarketNextConfig, patchMarketNextData } from '../utils'
import { activeBundle, analyzeVersions, createLocalBundleRecord, ensureInstalledConfig, expandedDependency, formatEndpoint, formatShortname, getConfigWriter, getRegistryStatus, getRegistryStatusText, pendingBundleUninstalls } from './utils'
import { resolveCategory } from '../market/utils'
import MarketIcon from '../market/icons'
import BundleUninstall from './bundle-uninstall.vue'
import PackageHistory from './package-history.vue'
import VersionPicker from './version-picker.vue'
import { useMarketNextI18n } from '../i18n'
import { getMarketObject } from '../market/state'

type ItemKind = 'pending' | 'bundle' | 'unconfigured' | 'updatable' | 'ignored' | 'check-disabled' | 'invalid' | 'error' | 'local' | 'manual' | 'installed'

const props = defineProps<{
  name: string
  kind?: ItemKind
  listMode?: boolean
}>()

const removeValue = '__market_next_remove__'
const config = useConfig()
const ctx = useContext()
const { t, locale } = useMarketNextI18n()
const modeClass = computed(() => `market-mode-${getFrontendMode(config.value)}`)
const configuring = ref(false)
const editing = computed({
  get: () => expandedDependency.value === props.name,
  set: (value: boolean) => expandedDependency.value = value ? props.name : '',
})
const showIgnoreDialog = ref(false)
const showBundleUninstallDialog = ref(false)
const showPackageHistoryDialog = ref(false)
const showLocalBindingDialog = ref(false)
const bindingLocal = ref(false)
const ignoreMode = ref<'version' | 'package'>('version')
const ignoreDurationPreset = ref<'forever' | '1d' | '7d' | '30d' | 'custom'>('forever')
const ignoreCustomDays = ref(7)
const ignoreCount = ref(1)
const ignoreSaving = ref(false)

const dep = computed(() => store.dependencies?.[props.name])
const local = computed(() => store.packages?.[props.name])
const localDependency = computed(() => {
  return isLocalDependency(dep.value)
    || props.kind === 'local' && !dep.value && !!local.value
})
const bundleRecord = computed(() => getBundleRecords(config.value)[props.name] || createLocalBundleRecord(props.name))

const displayName = computed(() => formatShortname(props.name))

// The plugin name opens its homepage and the package name opens npm. Local and workspace
// packages may differ from the published one, so they get neither link.
const published = computed(() => !localDependency.value && !dep.value?.workspace && !local.value?.workspace)
const marketLinks = computed(() => getMarketObject(props.name)?.package?.links)

const homepageLink = computed(() => {
  if (!published.value) return
  const { homepage, repository } = marketLinks.value ?? {}
  const url = [homepage, repository].find(url => /^(git\+)?https?:\/\//.test(url ?? ''))
  return url?.replace(/^git\+/, '').replace(/\.git$/, '')
})

const npmLink = computed(() => {
  if (!published.value || !marketLinks.value && !store.registry?.[props.name]) return
  const url = marketLinks.value?.npm
  return url && /^https?:\/\//.test(url) ? url : `https://www.npmjs.com/package/${props.name}`
})

// Without a separate package name line, the title falls back to npm.
const titleLink = computed(() => homepageLink.value || (displayName.value === props.name ? npmLink.value : undefined))

const icon = computed(() => {
  if (isBundlePackageName(props.name)) return 'layer-group'
  const category = getMarketObject(props.name)?.category
  if (category) return `solid:${resolveCategory(category)}`
  return props.name.includes('adapter-') ? 'solid:adapter' : 'solid:other'
})

const data = computed(() => {
  if (localDependency.value || dep.value?.invalid) return
  return analyzeVersions(props.name, (name) => getPendingOverrides()[name])
})

const status = computed(() => getRegistryStatus(props.name))

const latestVersion = computed(() => {
  const policy = getMarketNextPolicy(config.value)
  return getLatestVersion(props.name, policy)
    || getIgnoredUpdateVersion(props.name, policy)
    || dep.value?.latest
    || local.value?.package.version
})

const overrideValue = computed(() => {
  const override = getPendingOverrides()
  if (!Object.prototype.hasOwnProperty.call(override, props.name)) return
  return override[props.name]
})

const pending = computed(() => overrideValue.value !== undefined)
const pendingRemove = computed(() => pending.value && !overrideValue.value)
const updateCheckDisabled = computed(() => isUpdateCheckDisabled(props.name, getMarketNextPolicy(config.value)))
const ignoredUpdate = computed(() => updateCheckDisabled.value || isUpdateIgnored(props.name, getMarketNextPolicy(config.value)))
const updatable = computed(() => !!hasUpdate(props.name, getMarketNextPolicy(config.value)))
const bundlePackage = computed(() => !!bundleRecord.value)
const unconfigured = computed(() => {
  if (bundlePackage.value) return false
  const writer = getConfigWriter(ctx)
  return !!writer && !!local.value && PLUGIN_PACKAGE_RE.test(props.name) && !writer.get(props.name)?.length
})

const selectedVersion = computed({
  get() {
    if (pendingRemove.value) return removeValue
    if (overrideValue.value) return overrideValue.value
    return dep.value?.resolved ?? latestVersion.value ?? ''
  },
  set(value: string) {
    if (value === removeValue) {
      getPendingOverrides()[props.name] = ''
    } else if (value === dep.value?.resolved || !value && !dep.value) {
      delete getPendingOverrides()[props.name]
    } else {
      getPendingOverrides()[props.name] = value
    }
    void patchMarketNextData({ override: { ...getPendingOverrides() } })
  },
})

const statusClass = computed<ItemKind>(() => {
  if (pending.value) return 'pending'
  if (localDependency.value) return 'local'
  if (dep.value?.invalid) return 'invalid'
  if (bundlePackage.value && (dep.value || local.value)) return 'bundle'
  if (unconfigured.value) return 'unconfigured'
  if (status.value?.error) return 'error'
  if (!dep.value && !local.value) return 'manual'
  if (updateCheckDisabled.value) return 'check-disabled'
  if (ignoredUpdate.value) return 'ignored'
  if (updatable.value) return 'updatable'
  return props.kind ?? 'installed'
})

const statusLabel = computed(() => {
  if (pendingRemove.value) return t('dependencyCard.status.pendingRemove')
  if (pending.value && dep.value) return t('dependencyCard.status.pendingApply')
  if (pending.value) return t('dependencyCard.status.pendingInstall')
  if (localDependency.value) return t('dependencyCard.status.local')
  if (dep.value?.invalid) return t('dependencyCard.status.unsupported')
  if (bundlePackage.value && (dep.value || local.value)) return t('dependencyCard.status.bundle')
  if (unconfigured.value) return t('dependencyCard.status.unconfigured')
  if (status.value?.error) return t('dependencyCard.status.versionError')
  if (!dep.value && !local.value) return t('dependencyCard.status.manual')
  if (updateCheckDisabled.value) return t('dependencyCard.status.checkDisabled')
  if (ignoredUpdate.value) return t('dependencyCard.status.ignored')
  if (updatable.value) return t('dependencyCard.status.updatable')
  return t('dependencyCard.status.installed')
})

const currentText = computed(() => {
  if (!dep.value) return local.value?.package.version ?? t('dependencyCard.current.notInstalled')
  if (localDependency.value) return dep.value.resolved ? `${dep.value.resolved} · ${t('dependencyCard.current.local')}` : t('dependencyCard.current.local')
  return dep.value.resolved ?? t('dependencyCard.current.installError')
})

const installedVersion = computed(() => dep.value?.resolved ?? local.value?.package.version ?? '')

const showTarget = computed(() => {
  if (pending.value || updatable.value) return true
  if (updateCheckDisabled.value) return false
  return ignoredUpdate.value || !dep.value && !local.value
})

const targetText = computed(() => {
  if (pendingRemove.value) return t('dependencyCard.target.remove')
  return overrideValue.value || latestVersion.value || t('dependencyCard.target.waitingInstall')
})

const sourceText = computed(() => {
  const origin = Object.values(getBundleRecords(config.value)).find(record => record?.members?.some(member => member.package === props.name))
  if (origin) return t('dependencyCard.source.bundle', { name: origin.label || formatShortname(origin.package) })
  if (bundleRecord.value) return t('dependencyCard.source.bundleSelf')
  if (dep.value?.source) return t(`dependencyCard.source.${dep.value.source}`)
  if (dep.value?.workspace || local.value?.workspace) return t('dependencyCard.source.workspace')
  if (localDependency.value || !dep.value && local.value) return t('dependencyCard.source.local')
  return ''
})

// Rarely needed details live in the tooltip so the card itself stays short.
const versionTitle = computed(() => {
  const lines: string[] = []
  if (dep.value?.request && dep.value.request !== dep.value.resolved) lines.push(`${t('common.labels.range')}: ${dep.value.request}`)
  if (sourceText.value) lines.push(`${t('common.labels.source')}: ${sourceText.value}`)
  if (status.value?.endpoint) lines.push(`${t('common.labels.versionSource')}: ${formatEndpoint(status.value.endpoint)}`)
  return lines.join('\n')
})

const detailText = computed(() => {
  if (pendingRemove.value) return t('dependencyCard.detail.pendingRemove')
  if (pending.value) return dep.value ? '' : t('dependencyCard.detail.pendingInstall')
  if (localDependency.value) {
    if (!dep.value) return t('dependencyCard.detail.localDiscovered')
    return dep.value.bound === false
      ? t('dependencyCard.detail.localUnbound')
      : t('dependencyCard.detail.local')
  }
  if (dep.value?.invalid) return t('dependencyCard.detail.unsupported')
  if (bundlePackage.value && (dep.value || local.value)) return t('dependencyCard.detail.bundle')
  if (unconfigured.value) return t('dependencyCard.detail.unconfigured')
  if (status.value?.error || !data.value) return getRegistryStatusText(props.name)
  if (updateCheckDisabled.value) return t('dependencyCard.detail.checkDisabled')
  if (ignoredUpdate.value) return getUpdateIgnoreText(props.name, getMarketNextPolicy(config.value)) || t('dependencyCard.detail.ignored')
  return ''
})

const compactStatusText = computed(() => {
  return status.value?.loading || !status.value ? t('dependencyCard.detail.fetching') : t('dependencyCard.detail.noData')
})

const summaryText = computed(() => {
  const market = getMarketObject(props.name)
  const keys = locale.value.toLowerCase().startsWith('zh') ? ['zh-CN', 'zh', 'en-US', 'en'] : ['en-US', 'en', 'zh-CN', 'zh']
  for (const value of [market?.manifest?.description, market?.package?.description, local.value?.package?.description]) {
    const text = !value || typeof value === 'string' ? value : keys.map(key => value[key]).find(item => item?.trim()) ?? Object.values(value).find(item => item?.trim())
    if (text?.trim()) return text.trim()
  }
  return ''
})

// The group header already names the state, so the tag only appears when it adds something.
const showTag = computed(() => {
  if (statusClass.value === 'installed') return false
  return statusClass.value !== props.kind || pendingRemove.value || pending.value && !dep.value
})

const showDetailText = computed(() => {
  if (!detailText.value || statusClass.value === 'installed') return false
  // These details only repeat the group description.
  return statusClass.value !== props.kind || !['unconfigured', 'bundle', 'invalid', 'check-disabled'].includes(statusClass.value)
})

const showVersionControl = computed(() => {
  if (localDependency.value) return false
  if (!data.value && !status.value?.error) return false
  return editing.value || pending.value || statusClass.value === 'error' || statusClass.value === 'manual'
})

const showPicker = computed(() => showVersionControl.value && !!data.value)

const showManageBundle = computed(() => bundlePackage.value && !!(dep.value || local.value) && !pending.value)

const showQuickUpdate = computed(() => {
  return !pending.value && !unconfigured.value && updatable.value && !!latestVersion.value && !localDependency.value
})

const showRestoreUpdate = computed(() => !pending.value && !localDependency.value && ignoredUpdate.value)

const showConfigure = computed(() => !pending.value && unconfigured.value)

const showBindLocal = computed(() => !pending.value && dep.value?.source === 'unbound' && dep.value?.bound === false)

const menuItems = computed(() => {
  const items: { command: string, label: string, icon: string, danger?: boolean }[] = []
  if (!bundlePackage.value && !pending.value && !localDependency.value && data.value && !['error', 'manual'].includes(statusClass.value)) {
    items.push({ command: 'version', icon: 'market-next:switch', label: editing.value ? t('dependencyCard.actions.hideVersions') : t('dependencyCard.actions.pickVersion') })
  }
  if (dep.value?.resolved && !localDependency.value && !dep.value.invalid) {
    items.push({ command: 'history', icon: 'market-next:history', label: t('dependencyCard.actions.history') })
  }
  if (showQuickUpdate.value) items.push({ command: 'ignore', icon: 'market-next:bell-off', label: t('dependencyCard.actions.ignore') })
  if (!pending.value && dep.value && !dep.value.workspace && !dep.value.invalid) {
    items.push({
      command: 'remove',
      icon: 'market-next:trash',
      label: bundleRecord.value ? t('dependencyCard.actions.uninstallBundle') : t('dependencyCard.actions.uninstall'),
      danger: true,
    })
  }
  return items
})

const showActions = computed(() => {
  return pending.value || showQuickUpdate.value || showConfigure.value || showBindLocal.value
    || showRestoreUpdate.value || showManageBundle.value
})

function onCommand(command: string) {
  if (command === 'version') editing.value = !editing.value
  if (command === 'history') showPackageHistoryDialog.value = true
  if (command === 'ignore') openIgnoreDialog()
  if (command !== 'remove') return
  if (bundleRecord.value) {
    showBundleUninstallDialog.value = true
    return
  }
  selectedVersion.value = removeValue
}

function openBundlePanel() {
  activeBundle.value = getMarketObject(props.name) ?? {
    package: {
      name: props.name,
      version: installedVersion.value || latestVersion.value || '',
      keywords: [],
    },
    shortname: displayName.value,
  } as SearchObject
}

function clearOverride() {
  const override = getPendingOverrides()
  delete override[props.name]
  for (const member of pendingBundleUninstalls.value[props.name]?.members ?? []) {
    delete override[member]
  }
  void patchMarketNextData({ override: { ...override } })
  delete pendingBundleUninstalls.value[props.name]
}

function selectHistoryVersion(version: string) {
  if (!version || version === installedVersion.value) return
  selectedVersion.value = version
}

async function confirmLocalBinding() {
  if (bindingLocal.value) return
  bindingLocal.value = true
  try {
    const result = await send('market/prepare-local-binding', props.name)
    if (!result?.request) throw new Error('invalid local binding result')
    getPendingOverrides()[props.name] = result.request
    const saved = await patchMarketNextData({ override: { ...getPendingOverrides() } })
    if (!saved) {
      delete getPendingOverrides()[props.name]
      throw new Error('failed to save local binding override')
    }
    showLocalBindingDialog.value = false
    message.success(t('dependencyCard.localBinding.prepared'))
  } catch (error) {
    console.error(error)
    message.error(t('dependencyCard.localBinding.failed'))
  } finally {
    bindingLocal.value = false
  }
}

function openIgnoreDialog() {
  const policy = getMarketNextPolicy(config.value)
  const duration = Math.max(0, policy.updateIgnoreDays ?? 0) * day
  ignoreDurationPreset.value = duration === 0 ? 'forever'
    : duration === day ? '1d'
    : duration === 7 * day ? '7d'
    : duration === 30 * day ? '30d'
    : 'custom'
  ignoreCustomDays.value = Math.max(1, Math.ceil(duration / day))
  ignoreCount.value = Math.max(1, Math.min(20, Math.floor(policy.updateIgnoreVersions || 1)))
  ignoreMode.value = 'version'
  showIgnoreDialog.value = true
}

async function confirmIgnoreUpdate() {
  if (ignoreSaving.value) return
  const policy = getWritableMarketNextPolicy(config.value)
  policy.updateIgnored ||= {}
  if (ignoreMode.value === 'package') {
    const names = (policy.updateIgnoredPackages ?? '').split(/[\s,，;；]+/g).filter(Boolean)
    if (!names.some(item => item.toLowerCase() === props.name.toLowerCase())) names.push(props.name)
    policy.updateIgnoredPackages = names.join('\n')
    delete policy.updateIgnored[props.name]
  } else {
    const preset = ignoreDurationPreset.value
    const rule = createUpdateIgnoreRule(props.name, getMarketNextPolicy(config.value), {
      duration: preset === 'custom' ? Math.max(1, Math.min(3650, Math.floor(ignoreCustomDays.value))) * day
        : preset === 'forever' ? 0
        : Number.parseInt(preset) * day,
      count: ignoreCount.value,
    })
    if (!rule) return
    policy.updateIgnored[props.name] = rule
  }
  ignoreSaving.value = true
  const saved = await persistUpdatePolicy()
  ignoreSaving.value = false
  if (!saved) {
    message.error(t('common.messages.saveFailed'))
    return
  }
  showIgnoreDialog.value = false
  message.success(ignoreMode.value === 'package' ? t('dependencyCard.ignore.addedToDisabled') : t('dependencyCard.ignore.saved'))
}

async function restoreUpdate() {
  const policy = getWritableMarketNextPolicy(config.value)
  delete policy.updateIgnored?.[props.name]
  policy.updateIgnoredPackages = (policy.updateIgnoredPackages ?? '')
    .split(/[\s,，;；]+/g)
    .filter(item => item && item.toLowerCase() !== props.name.toLowerCase())
    .join('\n')
  if (!await persistUpdatePolicy()) message.error(t('common.messages.saveFailed'))
}

async function persistUpdatePolicy() {
  const policy = getMarketNextPolicy(config.value)
  const configSaved = await patchMarketNextConfig({
    updateIgnoredPackages: policy.updateIgnoredPackages,
    updateIgnoreDays: policy.updateIgnoreDays,
    updateIgnoreVersions: policy.updateIgnoreVersions,
    updateIgnorePrerelease: policy.updateIgnorePrerelease,
  })
  const dataSaved = await patchMarketNextData({
    updateIgnored: policy.updateIgnored,
  })
  return configSaved && dataSaved
}

async function configure() {
  configuring.value = true
  try {
    await ensureInstalledConfig(ctx, props.name, false)
  } finally {
    configuring.value = false
  }
}

</script>

<style lang="scss">

.dep-menu-item.el-dropdown-menu__item {
  gap: 0.625rem;
  min-width: 9rem;

  .k-icon {
    width: 1rem;
    height: 1rem;
    color: var(--fg3);
  }
}

.dep-menu-danger.el-dropdown-menu__item:not(.is-disabled) {
  color: var(--danger);

  .k-icon {
    color: inherit;
  }

  &:hover, &:focus {
    color: var(--danger);
    background: color-mix(in srgb, var(--danger) 10%, transparent);
  }
}

.dep-dialog-body {
  display: grid;
  gap: 0.875rem;

  p {
    margin: 0;
    line-height: 1.6;
  }

  .dep-ignore-mode {
    display: grid;
    gap: 0.25rem;

    .el-radio {
      margin-right: 0;
    }
  }

  .dep-ignore-field {
    display: grid;
    grid-template-columns: 8rem minmax(0, 12rem);
    align-items: center;
    gap: 0.75rem;

    > span {
      color: var(--fg2);
    }

    .el-input-number,
    .el-select {
      width: 100%;
    }
  }

  .dep-dialog-note {
    color: var(--fg3);
    font-size: 0.875rem;
  }
}

@media (max-width: 480px) {
  .dep-dialog-body .dep-ignore-field {
    grid-template-columns: 1fr;
    gap: 0.375rem;
  }
}

</style>

<style lang="scss" scoped>

.dep-item {
  min-width: 0;
  box-sizing: border-box;
  background: var(--k-card-bg);
}

.dep-icon {
  display: grid;
  place-items: center;
  width: 2rem;
  height: 2rem;
  border-radius: 6px;
  color: var(--fg2);
  background: var(--k-side-bg);

  .market-icon {
    width: 1rem;
    height: 1rem;
  }
}

.dep-main {
  min-width: 0;
}

.dep-title {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  min-width: 0;

  h3 {
    margin: 0;
    min-width: 0;
    font-size: 0.9375rem;
    font-weight: 600;
    line-height: 1.4;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;

    a {
      color: inherit;
      text-decoration: none;
    }
  }
}

.dep-title h3 a:hover,
a.dep-name:hover {
  color: var(--k-color-primary);
  text-decoration: underline;
}

.dep-tag {
  flex: 0 0 auto;
  border-radius: 4px;
  padding: 0 0.375rem;
  color: var(--fg2);
  background: var(--k-side-bg);
  font-size: 0.75rem;
  line-height: 1.25rem;
  white-space: nowrap;

  &.is-pending,
  &.is-manual {
    color: var(--k-color-primary);
    background: color-mix(in srgb, var(--k-color-primary) 12%, transparent);
  }

  &.is-updatable {
    color: var(--k-color-success);
    background: color-mix(in srgb, var(--k-color-success) 12%, transparent);
  }

  &.is-error {
    color: var(--danger);
    background: color-mix(in srgb, var(--danger) 12%, transparent);
  }

  &.is-unconfigured,
  &.is-invalid,
  &.is-local {
    color: var(--warning);
    background: color-mix(in srgb, var(--warning) 12%, transparent);
  }
}

.dep-name {
  display: block;
  width: fit-content;
  max-width: 100%;
  text-decoration: none;
  color: var(--fg3);
  font-size: 0.8125rem;
  line-height: 1.4;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dep-summary {
  margin: 0;
  color: var(--fg2);
  font-size: 0.8125rem;
  line-height: 1.5;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dep-version {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.375rem;
  min-width: 0;
  color: var(--fg2);
  font-size: 0.875rem;
  font-variant-numeric: tabular-nums;

  > span,
  strong {
    white-space: nowrap;
  }

  strong {
    color: var(--fg1);
    font-weight: 600;
  }

  .dep-arrow {
    color: var(--fg3);
  }

  .is-remove {
    color: var(--danger);
  }
}

.is-updatable .dep-version strong {
  color: var(--k-color-success);
}

.is-pending .dep-version strong:not(.is-remove) {
  color: var(--k-color-primary);
}

.dep-detail {
  margin: 0;
  color: var(--fg2);
  font-size: 0.8125rem;
  line-height: 1.5;
  overflow-wrap: anywhere;

  &.is-danger {
    color: var(--danger);
  }
}

.dep-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 0.5rem;

  .el-button + .el-button {
    margin-left: 0;
  }
}

.dep-muted {
  color: var(--fg3);
  font-size: 0.8125rem;
}

.dep-more {
  padding: 0 0.5rem;

  .k-icon {
    width: 1rem;
    height: 1rem;
  }
}

.dep-icon { grid-area: icon; }
.dep-main { grid-area: main; }
.dep-version { grid-area: version; }
.dep-detail { grid-area: detail; }
.dep-actions { grid-area: actions; }
.dep-menu {
  grid-area: menu;
  justify-self: end;
}

.is-row > .dep-summary { grid-area: summary; }

.is-card .dep-summary {
  min-height: 1.5em;
  margin-top: 0.25rem;
}

@mixin card-layout {
  display: grid;
  grid-template-columns: 2rem minmax(0, 1fr) auto;
  grid-template-areas:
    'icon main menu'
    'icon version actions'
    'icon detail detail';
  column-gap: 0.75rem;
  align-content: start;
  align-items: center;
  padding: 0.75rem 0.875rem;

  .dep-icon,
  .dep-menu {
    align-self: start;
  }

  // Empty grid rows would still add a gap, so spacing goes on the items.
  .dep-version,
  .dep-actions,
  .dep-detail {
    margin-top: 0.375rem;
  }
}

.is-card {
  @include card-layout;
  border: 1px solid var(--k-color-border);
  border-radius: 8px;
}

// Fixed columns keep versions and buttons aligned from row to row.
.is-row {
  display: grid;
  grid-template-columns: 2rem minmax(10rem, 2fr) minmax(0, 3fr) 14rem 7rem 2.25rem;
  grid-template-areas:
    'icon main summary version actions menu'
    'icon detail detail detail detail menu';
  column-gap: 1rem;
  align-items: center;
  padding: 0.5rem 1rem;

  > .dep-summary {
    color: var(--fg3);
  }

  .dep-version {
    flex-wrap: nowrap;
  }

  .dep-detail {
    margin-top: 0.125rem;
  }
}

@media (max-width: 768px) {
  .is-row {
    @include card-layout;

    > .dep-summary {
      display: none;
    }
  }
}

</style>
