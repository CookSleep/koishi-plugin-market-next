<template>
  <market-dialog
    v-model="visible"
    append-to-body
    class="bundle-uninstall-dialog"
    width="720px"
    destroy-on-close
  >
    <template #header="{ titleId, titleClass }">
      <span :id="titleId" :class="titleClass">{{ title || t('bundle.actions.uninstall') }}</span>
      <div v-if="packageName" class="bundle-meta">
        <template v-if="recordView?.label">{{ recordView.label }} · </template>{{ packageName }}
      </div>
    </template>

    <template v-if="packageName">
      <p class="dialog-intro">{{ t('bundle.messages.uninstallIntro') }}</p>

      <k-comment v-if="recordView?.fallback" type="warning">
        <p>{{ t('bundle.messages.fallbackRecord') }}</p>
      </k-comment>

      <div v-if="loadingRecord" class="bundle-state">{{ t('bundle.loading') }}</div>

      <section v-else-if="memberRows.length" class="dialog-section">
        <div class="dialog-section-title">
          <span>{{ t('bundle.members.title') }}</span>
          <span class="dialog-count">{{ memberRows.length }}</span>
        </div>
        <div class="dialog-list">
          <!-- Works like a select-all: picks the same action for every member, and shows one only while all members match it. -->
          <div class="dialog-list-row bundle-member bundle-all">
            <span class="bundle-all-label">{{ t('bundle.members.all') }}</span>
            <el-radio-group :model-value="commonAction" size="small" class="member-action" @change="setAllActions">
              <el-radio-button value="config" :disabled="!memberRows.some(row => row.hasGroupConfig)">{{ t('bundle.members.cleanGroupConfig') }}</el-radio-button>
              <el-radio-button value="dependency" :disabled="!memberRows.some(row => row.canRemoveDependency)">{{ t('bundle.members.removeDependency') }}</el-radio-button>
              <el-radio-button value="keep">{{ t('bundle.members.keep') }}</el-radio-button>
            </el-radio-group>
          </div>
          <div v-for="row in memberRows" :key="row.package" class="dialog-list-row bundle-member">
            <div class="member-main">
              <div class="member-line">
                <span class="member-name">{{ formatShortname(row.package) }}</span>
                <span class="member-version">{{ row.version || t('bundle.members.notDeclared') }}</span>
                <span class="dialog-tag">{{ row.required ? t('bundle.members.requiredTag') : t('bundle.members.optionalTag') }}</span>
                <span v-if="row.hasGroupConfig" class="dialog-tag">{{ t('bundle.members.groupConfig') }}</span>
                <span v-if="row.hasExternalConfig" class="dialog-tag warning">{{ t('bundle.members.externalConfig') }}</span>
                <span v-if="row.workspace" class="dialog-tag">{{ t('bundle.members.workspace') }}</span>
              </div>
              <div class="member-sub">
                {{ row.package }} · {{ row.installed ? t('bundle.members.dependencyInstalled') : t('bundle.members.dependencyNotInstalled') }}
              </div>
              <p v-if="row.hasExternalConfig" class="member-note warning">{{ t('bundle.conflict.externalNote') }}</p>
            </div>
            <el-radio-group v-model="memberActions[row.package]" size="small" class="member-action">
              <el-radio-button value="config" :disabled="!row.hasGroupConfig">{{ t('bundle.members.cleanGroupConfig') }}</el-radio-button>
              <el-radio-button value="dependency" :disabled="!row.canRemoveDependency">{{ t('bundle.members.removeDependency') }}</el-radio-button>
              <el-radio-button value="keep">{{ t('bundle.members.keep') }}</el-radio-button>
            </el-radio-group>
          </div>
        </div>
      </section>

      <k-comment v-else>
        <p>{{ t('bundle.messages.noMembers') }}</p>
      </k-comment>

      <p class="bundle-summary">
        {{ t('bundle.summary.text', { remove: dependencyRemovalCount, clean: configCleanupCount, keep: keepCount }) }}
        {{ t('bundle.messages.outsideConfig') }}
      </p>
    </template>
    <k-comment v-else type="warning">
      <p>{{ t('bundle.messages.noDependency') }}</p>
    </k-comment>

    <template #footer>
      <el-button @click="visible = false">{{ t('bundle.actions.cancel') }}</el-button>
      <el-button type="danger" :loading="loadingRecord || uninstalling" :disabled="!packageName" @click="uninstallBundle">
        {{ t('bundle.actions.uninstall') }}
      </el-button>
    </template>
  </market-dialog>
</template>

<script setup lang="ts">

import { computed, reactive, ref, watch } from 'vue'
import { message, router, send, store, useConfig, useContext } from '@koishijs/client'
import { getBundleGroupIdent, type PluginBundleRecord } from '../../src/shared/bundle'
import {
  fetchBundleRecord,
  formatShortname,
  getBundleMemberConfigState,
  install,
  pendingBundleUninstalls,
  type BundleRecordView,
  type BundleMemberCleanupTarget,
} from './utils'
import { getBulkMode, getPendingOverrides, getWritableBundleRecords, patchMarketNextData } from '../utils'
import { useMarketNextI18n } from '../i18n'
import MarketDialog from './market-dialog.vue'

type MemberAction = 'config' | 'dependency' | 'keep'

const protectedDeps = new Set(['@koishijs/plugin-console', '@koishijs/plugin-config', '@koishijs/plugin-server'])

const props = defineProps<{
  modelValue: boolean
  packageName?: string
  record?: BundleRecordView | PluginBundleRecord
  title?: string
  redirectToPlugins?: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  done: []
}>()

const config = useConfig()
const { t } = useMarketNextI18n()

// A member that can't take the requested action falls back to the next milder one.
function getAllAction(row: typeof memberRows.value[number], action: MemberAction): MemberAction {
  if (action === 'dependency' && row.canRemoveDependency) return 'dependency'
  if (action !== 'keep' && row.hasGroupConfig) return 'config'
  return 'keep'
}

function setAllActions(action: MemberAction) {
  for (const row of memberRows.value) memberActions[row.package] = getAllAction(row, action)
}

const commonAction = computed(() => {
  return (['keep', 'config', 'dependency'] as const).find(action => {
    return memberRows.value.every(row => memberActions[row.package] === getAllAction(row, action))
  })
})
const ctx = useContext()
const loadingRecord = ref(false)
let loadSerial = 0
const uninstalling = ref(false)
const remoteRecord = ref<BundleRecordView>()
const memberActions = reactive<Record<string, MemberAction>>({})

const packageName = computed(() => props.packageName || '')
const visible = computed({
  get: () => props.modelValue,
  set: value => emit('update:modelValue', value),
})

const recordView = computed(() => {
  if (props.record?.members?.length) return props.record
  if (remoteRecord.value?.package === packageName.value) return remoteRecord.value
  return props.record
})

const memberRows = computed(() => {
  const groupKey = recordView.value?.groupKey || (packageName.value ? `group:${getBundleGroupIdent(packageName.value)}` : undefined)
  return (recordView.value?.members ?? []).map((member) => {
    const dep = store.dependencies?.[member.package]
    const state = getBundleMemberConfigState(ctx, member, groupKey)
    const installed = !!dep
    const blocked = !!dep?.workspace || !!dep?.invalid || protectedDeps.has(member.package)
    const hasExternalConfig = !!state.external.length
    return {
      ...member,
      installed,
      workspace: !!dep?.workspace,
      hasGroupConfig: !!state.group.length,
      hasExternalConfig,
      canRemoveDependency: installed && !blocked && !hasExternalConfig,
    }
  })
})

const dependencyRemovalMembers = computed(() => memberRows.value
  .filter(row => memberActions[row.package] === 'dependency' && row.canRemoveDependency))
const configCleanupMembers = computed(() => memberRows.value
  .filter(row => memberActions[row.package] === 'dependency' || memberActions[row.package] === 'config')
  .filter(row => row.hasGroupConfig))
const dependencyRemovalCount = computed(() => dependencyRemovalMembers.value.length)
const configCleanupCount = computed(() => configCleanupMembers.value.length)
const keepCount = computed(() => Math.max(0, memberRows.value.length - new Set([
  ...dependencyRemovalMembers.value.map(row => row.package),
  ...configCleanupMembers.value.map(row => row.package),
]).size))

watch(visible, async (value, previous) => {
  if (!value) {
    if (!previous) return
    // Drops a load still running for the dialog that just closed.
    loadSerial++
    loadingRecord.value = false
    return
  }
  remoteRecord.value = undefined
  if (await loadRecord()) resetActions()
}, { immediate: true })

watch(memberRows, () => {
  if (visible.value) resetActions(false)
})

// Returns false when a newer load has started, e.g. the dialog was reopened for another bundle.
async function loadRecord() {
  const serial = ++loadSerial
  const name = packageName.value
  if (!name || props.record?.members?.length) return true
  loadingRecord.value = true
  try {
    const record = await fetchBundleRecord(name)
    if (record && serial === loadSerial) remoteRecord.value = record
  } catch (error) {
    console.warn(error)
    if (serial === loadSerial) message.warning(t('bundle.messages.recordFailed'))
  } finally {
    if (serial === loadSerial) loadingRecord.value = false
  }
  return serial === loadSerial
}

function resetActions(force = true) {
  const seen = new Set<string>()
  for (const row of memberRows.value) {
    seen.add(row.package)
    if (!force && memberActions[row.package]) continue
    memberActions[row.package] = getDefaultAction(row)
  }
  for (const key of Object.keys(memberActions)) {
    if (!seen.has(key)) delete memberActions[key]
  }
}

function getDefaultAction(row: (typeof memberRows.value)[number]): MemberAction {
  if (row.hasExternalConfig) return row.hasGroupConfig ? 'config' : 'keep'
  if (row.canRemoveDependency && row.installedByBundle === true) return 'dependency'
  if (row.hasGroupConfig) return 'config'
  return 'keep'
}

function ensureOverride() {
  return getPendingOverrides()
}

function getCleanupTargets(): BundleMemberCleanupTarget[] {
  return configCleanupMembers.value.map(member => ({
    package: member.package,
    plugin: member.plugin,
  }))
}

async function uninstallBundle() {
  const name = packageName.value
  if (!name || uninstalling.value) return
  const members = dependencyRemovalMembers.value.map(member => member.package)
  const configs = getCleanupTargets()
  const override = {
    [name]: '',
    ...Object.fromEntries(members.map(name => [name, ''])),
  }

  if (getBulkMode()) {
    const overrides = ensureOverride()
    Object.assign(overrides, override)
    void patchMarketNextData({ override: { ...overrides } })
    pendingBundleUninstalls.value[name] = {
      members,
      cleanup: !!configs.length,
      configs,
    }
    visible.value = false
    message.success(t('bundle.messages.stagedUninstall', { members: members.length, configs: configs.length }))
    return
  }

  visible.value = false
  uninstalling.value = true
  try {
    await install(override, async () => {
      if (configs.length) {
        await send('market/remove-bundle-configs', {
          package: name,
          members: configs,
          removeEmptyGroup: true,
        })
      }
      const records = getWritableBundleRecords(config.value)
      delete records[name]
      const saved = await patchMarketNextData({ bundleRecords: records })
      if (!saved) message.warning(t('bundle.messages.recordSaveFailed'))
      if (props.redirectToPlugins) await router.replace('/plugins')
      emit('done')
    }, undefined, {
      loadingText: t('bundle.messages.uninstalling'),
      successText: t('bundle.messages.uninstalled'),
      errorText: t('bundle.messages.uninstallFailed'),
      timeoutText: t('bundle.messages.uninstallTimeout'),
    })
  } finally {
    uninstalling.value = false
  }
}

</script>

<style lang="scss">

.bundle-uninstall-dialog {
  // Keeps the title and package name clear of the close button.
  .el-dialog__header {
    padding-right: 36px;
  }

  .bundle-member {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    gap: 0.5rem 1rem;
  }

  .bundle-all {
    background: var(--k-side-bg);
  }

  .bundle-all-label {
    color: var(--fg2);
  }

  .member-main .member-note {
    margin-top: 0.25rem;
  }

  .bundle-summary {
    margin: 1rem 0 0;
    color: var(--fg3);
    font-size: 0.8125rem;
  }

  @media (max-width: 768px) {
    .bundle-member {
      grid-template-columns: minmax(0, 1fr);
    }

    // Long labels (English especially) would wrap the group into broken pieces. A three-column
    // grid keeps it whole, sizes each button to its label and wraps a label only when it must.
    .member-action {
      display: grid;
      grid-template-columns: repeat(3, auto);

      .el-radio-button,
      .el-radio-button__inner {
        display: flex;
        height: 100%;
      }

      .el-radio-button__inner {
        align-items: center;
        justify-content: center;
        width: 100%;
        white-space: normal;
        line-height: 1.3;
      }
    }
  }
}

</style>
