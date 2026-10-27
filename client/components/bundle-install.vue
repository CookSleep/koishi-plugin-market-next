<template>
  <el-dialog
    :model-value="!!activeBundle"
    append-to-body
    :class="['market-dialog', 'bundle-install-panel']"
    width="800px"
    destroy-on-close
    @update:model-value="close"
  >
    <template #header="{ titleId, titleClass }">
      <div class="bundle-title">
        <span :id="titleId" :class="titleClass">{{ title }}</span>
        <span class="bundle-badge">{{ t('bundle.label') }}</span>
      </div>
      <div v-if="activeBundle" class="bundle-meta">{{ activeBundle.package.name }} · {{ bundleVersion }}</div>
    </template>

    <template v-if="activeBundle">
      <div v-if="loading" class="bundle-state">{{ t('bundle.loading') }}</div>
      <k-comment v-else-if="error" type="danger">
        <p>{{ error }}</p>
      </k-comment>

      <template v-else-if="bundle">
        <p v-if="bundle.description" class="bundle-description">{{ bundle.description }}</p>

        <k-comment v-if="validationErrors.length" type="danger">
          <p v-for="item in validationErrors" :key="item">{{ item }}</p>
        </k-comment>
        <k-comment v-if="validationWarnings.length" type="warning">
          <p v-for="item in validationWarnings" :key="item">{{ item }}</p>
        </k-comment>

        <div v-if="selectedMembers.length" class="bundle-bulk">
          <span>{{ t('bundle.bulk.label') }}</span>
          <el-button type="primary" text size="small" @click="batchSetCreateConfig(true)">{{ t('bundle.bulk.createAll') }}</el-button>
          <el-button type="primary" text size="small" @click="batchSetCreateConfig(false)">{{ t('bundle.bulk.skipAll') }}</el-button>
          <template v-if="selectedMembers.some(m => hasPreset(m))">
            <el-button type="primary" text size="small" @click="batchSetUsePreset(true)">{{ t('bundle.bulk.enablePresets') }}</el-button>
            <el-button type="primary" text size="small" @click="batchSetUsePreset(false)">{{ t('bundle.bulk.disablePresets') }}</el-button>
          </template>
        </div>

        <section v-for="section in sections" :key="section.key" class="bundle-section">
          <div class="bundle-section-title">
            <span>{{ section.label }}</span>
            <span class="bundle-section-count">{{ section.members.length }}</span>
            <el-button v-if="section.key === 'optional'" type="primary" text size="small" @click="toggleAllOptional">
              {{ allOptionalSelected ? t('bundle.members.optionalToggleNone') : t('bundle.members.optionalToggleAll') }}
            </el-button>
          </div>
          <div class="bundle-member-list">
            <div
              v-for="member in section.members"
              :key="member.package + ':' + member.plugin"
              :class="['bundle-member', { selected: member.selected }]"
            >
              <div class="member-row">
                <el-checkbox v-model="member.selected" :disabled="member.required" :aria-label="member.package"></el-checkbox>
                <div :class="['member-main', { toggle: !member.required }]" @click="!member.required && (member.selected = !member.selected)">
                  <div class="member-line">
                    <span class="member-name">{{ formatShortname(member.package) }}</span>
                    <span class="member-version">{{ member.version }}</span>
                    <span v-for="tag in riskTags(member)" :key="tag.label" :class="['member-risk', tag.type]">{{ tag.label }}</span>
                  </div>
                  <div class="member-sub">{{ member.package }} · {{ getInstalledText(member.package) }}</div>
                  <p v-if="getPackageDescription(member.package)" class="member-desc">
                    {{ getPackageDescription(member.package) }}
                  </p>
                </div>
              </div>

              <template v-if="member.selected">
                <div class="member-options">
                  <el-checkbox v-model="member.createConfig" :disabled="member.conflict === 'same-group'">{{ t('bundle.members.createConfig') }}</el-checkbox>
                  <el-checkbox v-if="member.conflict === 'other-config'" v-model="member.move">{{ t('bundle.members.moveConfig') }}</el-checkbox>
                  <el-checkbox v-model="member.usePreset" :disabled="!member.createConfig || member.move || !hasPreset(member)">{{ t('bundle.members.usePreset') }}</el-checkbox>
                </div>

                <k-comment v-if="member.conflict === 'package-mismatch'" type="danger" class="member-warning">
                  <p>{{ t('bundle.conflict.version', { current: store.dependencies?.[member.package]?.resolved, range: member.version }) }}</p>
                </k-comment>
                <k-comment v-if="member.conflict === 'other-config'" type="warning" class="member-warning">
                  <p>{{ t('bundle.conflict.config') }}</p>
                </k-comment>
                <k-comment v-if="member.conflict === 'same-group'" type="primary" class="member-warning">
                  <p>{{ t('bundle.conflict.sameGroup') }}</p>
                </k-comment>

                <div v-if="member.usePreset && sensitiveFields(member).length" class="sensitive-fields">
                  <div class="editor-title">{{ t('bundle.editor.sensitive') }}</div>
                  <label v-for="field in sensitiveFields(member)" :key="field" class="editor-field">
                    <span>{{ field }}</span>
                    <el-input
                      v-model="member.config[field]"
                      size="small"
                      :placeholder="t('bundle.editor.placeholder', { field })"
                      show-password
                    ></el-input>
                  </label>
                </div>

                <details v-if="hasPreset(member)" class="member-config">
                  <summary>{{ t('bundle.editor.viewPreset') }}</summary>
                  <textarea
                    class="raw-json-editor"
                    :value="formatConfig(member.config)"
                    rows="8"
                    @input="onJsonInput(member, $event.target.value)"
                  ></textarea>
                  <div v-if="memberJsonErrors[getMemberKey(member)]" class="json-error-text">
                    {{ t('bundle.editor.jsonError', { error: memberJsonErrors[getMemberKey(member)] }) }}
                  </div>
                </details>
              </template>
            </div>
          </div>
        </section>

        <div class="bundle-diff">
          <div class="bundle-diff-title">{{ t('bundle.diff.title') }}</div>
          <dl>
            <div>
              <dt>{{ t('bundle.diff.install') }}</dt>
              <dd>{{ installList.join(t('common.format.listSeparator')) }}</dd>
            </div>
            <div v-if="configList.length">
              <dt>{{ t('bundle.diff.config') }}</dt>
              <dd>
                {{ configList.map(item => presetList.includes(item) ? t('bundle.diff.withPreset', { name: item }) : item).join(t('common.format.listSeparator')) }}
              </dd>
            </div>
            <div v-if="moveList.length">
              <dt>{{ t('bundle.diff.move') }}</dt>
              <dd>{{ moveList.join(t('common.format.listSeparator')) }}</dd>
            </div>
            <div v-if="skippedConfigList.length">
              <dt>{{ t('bundle.diff.skip') }}</dt>
              <dd>{{ skippedConfigList.join(t('common.format.listSeparator')) }}</dd>
            </div>
          </dl>
        </div>
      </template>
    </template>

    <template #footer>
      <el-button @click="close">{{ t('bundle.actions.cancel') }}</el-button>
      <el-button type="primary" :loading="installing" :disabled="!canInstall" @click="confirmInstall">
        {{ t('bundle.actions.install') }}<template v-if="selectedMembers.length"> ({{ selectedMembers.length }})</template>
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">

import { computed, reactive, ref, watch } from 'vue'
import { message, send, socket, store, useContext } from '@koishijs/client'
import type { Registry } from '@koishijs/registry'
import {
  BundleInstallMember,
  BundleInstallResult,
  PluginBundleManifest,
  hasBundleKeyword,
  parseBundleManifest,
  scanSensitiveConfig,
  validateBundleManifest,
  getBundleGroupIdent,
} from '../../src/shared/bundle'
import {
  activeBundle,
  formatShortname,
  getBundleMemberConfigState,
  installProgressState,
  prepareInstallFallbackRetry,
  resetInstallFallbackState,
  type InstallOptions,
} from './utils'
import { satisfies } from 'semver'
import { useMarketNextI18n } from '../i18n'
import { getMarketObject, loadMarketObjects } from '../market/state'

const loading = ref(false)
const installing = ref(false)
const error = ref('')
const registry = ref<Registry>()
const bundle = ref<PluginBundleManifest>()
const resolvedBundleVersion = ref('')
const members = reactive<BundleInstallMember[]>([])
const ctx = useContext()
const { t, locale } = useMarketNextI18n()


const title = computed(() => activeBundle.value?.shortname || activeBundle.value?.package.name || t('bundle.label'))
const bundleVersion = computed(() => resolvedBundleVersion.value || activeBundle.value?.package.version || '')
const validation = computed(() => {
  if (!activeBundle.value || !bundle.value) return { valid: false, errors: [], warnings: [] }
  return validateBundleManifest(activeBundle.value.package.name, bundle.value, {
    keyword: hasBundleKeyword(activeBundle.value.package.keywords),
  })
})
const validationErrors = computed(() => validation.value.errors)
const validationWarnings = computed(() => validation.value.warnings)
const selectedMembers = computed(() => members.filter(member => member.selected))
const optionalMembers = computed(() => members.filter(m => !m.required))
const sections = computed(() => [
  { key: 'required', label: t('bundle.members.required'), members: members.filter(m => m.required) },
  { key: 'optional', label: t('bundle.members.optional'), members: optionalMembers.value },
].filter(section => section.members.length))
const allOptionalSelected = computed(() => optionalMembers.value.length > 0 && optionalMembers.value.every(m => m.selected))

function toggleAllOptional() {
  const target = !allOptionalSelected.value
  for (const m of optionalMembers.value) m.selected = target
}

const installList = computed(() => {
  if (!activeBundle.value) return []
  return [
    `${activeBundle.value.package.name}@${bundleVersion.value}`,
    ...selectedMembers.value.map(member => `${member.package}@${member.version}`),
  ]
})
const configList = computed(() => selectedMembers.value
  .filter(member => member.createConfig && !member.move)
  .map(member => member.plugin))
const moveList = computed(() => selectedMembers.value
  .filter(member => member.move)
  .map(member => member.plugin))
const presetList = computed(() => selectedMembers.value
  .filter(member => member.createConfig && member.usePreset && !member.move)
  .map(member => member.plugin))
const skippedConfigList = computed(() => selectedMembers.value
  .filter(member => !member.createConfig && !member.move)
  .map(member => member.plugin))

const memberJsonErrors = reactive<Record<string, string>>({})

function getMemberKey(member: BundleInstallMember) {
  return `${member.package}:${member.plugin}`
}

function onJsonInput(member: BundleInstallMember, value: string) {
  const key = getMemberKey(member)
  try {
    const parsed = JSON.parse(value)
    member.config = parsed
    delete memberJsonErrors[key]
  } catch (err) {
    memberJsonErrors[key] = (err as Error).message
  }
}

const canInstall = computed(() => {
  return !!activeBundle.value 
    && !!bundle.value 
    && validation.value.valid 
    && selectedMembers.value.length > 0 
    && !loading.value
    && Object.keys(memberJsonErrors).length === 0
})

watch(activeBundle, async (value) => {
  error.value = ''
  registry.value = undefined
  bundle.value = undefined
  resolvedBundleVersion.value = ''
  members.splice(0)
  Object.keys(memberJsonErrors).forEach(key => delete memberJsonErrors[key])
  if (!value) return
  loading.value = true
  try {
    const data = await send('market/package', value.package.name) as Registry
    if (!data?.versions) {
      error.value = t('bundle.messages.noMetadata')
      return
    }
    registry.value = data
    const remoteEntry = data.versions?.[value.package.version]
      ? [value.package.version, data.versions[value.package.version]] as const
      : Object.entries(data.versions ?? {})[0]
    if (!remoteEntry) {
      error.value = t('bundle.messages.noMetadata')
      return
    }
    const [remoteVersion, remote] = remoteEntry
    const parsed = parseBundleManifest(remote?.koishi?.bundle)
    if (!parsed) {
      error.value = t('bundle.messages.noManifest')
      return
    }
    resolvedBundleVersion.value = remoteVersion
    bundle.value = parsed
    void loadMarketObjects(parsed.members.map(member => member.package)).catch(error => {
      console.error('[market-next] failed to load bundle member metadata', error)
    })
    const groupKey = `group:${getBundleGroupIdent(value.package.name)}`
    for (const member of parsed.members) {
      const state = getBundleMemberConfigState(ctx, member, groupKey)
      const hasConfig = !!(state.group.length || state.external.length)
      const conflictType = state.group.length ? 'same-group' : state.external.length ? 'other-config' : undefined
      
      const dep = store.dependencies?.[member.package]
      const isMismatch = dep?.resolved && !satisfies(dep.resolved, member.version, { includePrerelease: true })
      
      members.push({
        ...member,
        selected: !!member.required || (!!dep && !isMismatch),
        createConfig: !hasConfig && conflictType !== 'same-group',
        usePreset: !hasConfig && !!member.config && Object.keys(member.config).length > 0,
        move: false,
        conflict: conflictType || (isMismatch ? 'package-mismatch' : undefined),
      })
    }
    const names = parsed.members.map(member => member.package).filter(name => !store.registry?.[name])
    if (names.length) {
      const result = await (send('market/registry', names) ?? Promise.resolve(undefined)).catch(() => undefined)
      if (result) store.registry = { ...store.registry, ...result }
    }
  } catch (err) {
    console.error(err)
    error.value = err instanceof Error ? err.message : t('bundle.messages.loadFailed')
  } finally {
    loading.value = false
  }
}, { immediate: true })

function memberInfo(name: string) {
  return getMarketObject(name)
}

function getPackageDescription(name: string) {
  const data = memberInfo(name)
  const description = data?.manifest?.description || data?.package?.description
  if (typeof description === 'string') return description
  if (description && typeof description === 'object') {
    const preferred = locale.value.toLowerCase().startsWith('zh')
      ? ['zh-CN', 'zh', 'en-US', 'en']
      : ['en-US', 'en', 'zh-CN', 'zh']
    for (const key of preferred) {
      const text = description[key]
      if (text) return text
    }
    return Object.values(description).find(Boolean)
  }
}

function getInstalledText(name: string) {
  const dep = store.dependencies?.[name]
  if (dep?.resolved) return t('bundle.members.installed', { version: dep.resolved })
  if (store.packages?.[name]) return t('bundle.members.loaded', { version: store.packages[name].package.version })
  return t('bundle.members.notInstalled')
}

function versionMeta(member: BundleInstallMember) {
  return store.registry?.[member.package]?.[member.version]
}

function riskTags(member: BundleInstallMember) {
  const data = memberInfo(member.package)
  const tags: Array<{ label: string, type: string }> = []
  if (!data) tags.push({ label: t('bundle.members.marketMissing'), type: 'warning' })
  if (data?.verified) tags.push({ label: t('bundle.members.verified'), type: 'success' })
  if (data?.insecure) tags.push({ label: t('bundle.members.insecure'), type: 'danger' })
  if (data?.deprecated || versionMeta(member)?.deprecated) tags.push({ label: t('bundle.members.deprecated'), type: 'danger' })
  if (data?.manifest?.preview) tags.push({ label: t('bundle.members.preview'), type: 'warning' })
  if (data?.portable) tags.push({ label: t('bundle.members.portable'), type: 'info' })
  if (hasPreset(member)) tags.push({ label: t('bundle.members.hasPreset'), type: 'warning' })
  return tags
}

function hasPreset(member: BundleInstallMember) {
  return !!member.config && Object.keys(member.config).length > 0
}

function sensitiveFields(member: BundleInstallMember) {
  return scanSensitiveConfig(member.config)
}

function formatConfig(value: unknown) {
  return JSON.stringify(value ?? {}, null, 2)
}

function close() {
  if (installing.value) return
  activeBundle.value = undefined
}

function batchSetCreateConfig(value: boolean) {
  for (const m of selectedMembers.value) {
    if (m.conflict !== 'same-group') {
      m.createConfig = value
      if (!value) {
        m.usePreset = false
      }
    }
  }
}

function batchSetUsePreset(value: boolean) {
  for (const m of selectedMembers.value) {
    if (hasPreset(m) && m.createConfig && !m.move) {
      m.usePreset = value
    }
  }
}

async function confirmInstall() {
  if (!activeBundle.value || !bundle.value || installing.value) return
  installing.value = true

  installProgressState.title = t('bundle.messages.installing')
  installProgressState.logs = []
  installProgressState.status = 'running'
  installProgressState.visible = true
  installProgressState.selfUpdate = false
  installProgressState.environmentRestore = false
  resetInstallFallbackState()
  installProgressState.logs.push({
    type: 'stdout',
    line: t('bundle.messages.submitted'),
  })

  const request = {
    package: activeBundle.value!.package.name,
    version: bundleVersion.value,
    bundle: bundle.value!,
    members: members.map(member => ({
      ...member,
      createConfig: member.createConfig || !!member.move,
    })),
  }

  const runInstall = async (options?: InstallOptions) => {
    installing.value = true
    let disconnectedBeforeResponse = false
    let resolveDisconnected: (value: undefined) => void
    const disconnected = new Promise<undefined>((resolve) => {
      resolveDisconnected = resolve
    })
    const dispose = watch(socket, (value, previous) => {
      if (value || !previous) return
      disconnectedBeforeResponse = true
      resolveDisconnected(undefined)
      dispose()
    })
    const waitTimer = setTimeout(() => {
      if (installProgressState.status !== 'running') return
      installProgressState.logs.push({
        type: 'stdout',
        line: t('bundle.messages.waiting'),
      })
    }, 8000)
    try {
      const task = send('market/install-bundle', request, undefined, options ?? {}) as Promise<BundleInstallResult> | undefined
      const result = await Promise.race([task ?? Promise.resolve(undefined), disconnected])
      if (disconnectedBeforeResponse) {
        installProgressState.status = 'error'
        reportInstallError(t('bundle.messages.disconnected'))
        return undefined
      }
      if (!result) {
        installProgressState.status = 'error'
        reportInstallError(t('bundle.messages.disconnected'))
        return undefined
      }
      if (result?.code) {
        installProgressState.status = 'error'
        reportInstallError(t('bundle.messages.exitCode', { code: result.code }))
        await prepareInstallFallbackRetry(runInstall, options?.installEndpoint)
        return result.code
      }
      installProgressState.status = 'success'
      const moved = result?.moved?.length ? t('bundle.messages.moved', { count: result.moved.length }) : ''
      const skipped = result?.skipped?.length ? t('bundle.messages.skipped', { count: result.skipped.length }) : ''
      message.success(t('bundle.messages.completed', { moved, skipped }))
      activeBundle.value = undefined
      return 0
    } finally {
      clearTimeout(waitTimer)
      dispose()
      installing.value = false
    }
  }

  try {
    await runInstall()
  } catch (err) {
    console.error(err)
    installProgressState.status = 'error'
    reportInstallError(formatInstallError(err))
  }
}

function reportInstallError(detail: string) {
  const text = detail || t('bundle.messages.unknownError')
  installProgressState.logs.push({
    type: 'stderr',
    line: t('bundle.messages.installFailed', { detail: text }),
  })
  message.error(t('bundle.messages.installFailed', { detail: text }))
}

function formatInstallError(error: unknown) {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  if (error && typeof error === 'object') {
    const value = error as any
    if (typeof value.message === 'string') return value.message
    if (typeof value.error === 'string') return value.error
  }
  return String(error || t('bundle.messages.unknownError'))
}

</script>

<style lang="scss">
.bundle-install-panel {
  .el-dialog__header {
    padding-right: 36px;
  }

  .bundle-title {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
  }

  .bundle-badge {
    border-radius: 4px;
    padding: 0 0.375rem;
    color: var(--k-color-primary);
    background: color-mix(in srgb, var(--k-color-primary) 12%, transparent);
    font-size: 0.75rem;
    line-height: 1.25rem;
  }

  .bundle-meta {
    margin-top: 0.25rem;
    color: var(--fg3);
    font-size: 0.8125rem;
    overflow-wrap: anywhere;
  }

  .bundle-state {
    padding: 2rem 1rem;
    color: var(--fg3);
    text-align: center;
  }

  .bundle-description {
    margin: 0 0 0.75rem;
    color: var(--fg2);
    line-height: 1.6;
  }

  .bundle-bulk {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.25rem;
    margin-bottom: 0.75rem;
    color: var(--fg3);
    font-size: 0.8125rem;

    .el-button {
      margin-left: 0;
    }
  }

  .bundle-section + .bundle-section {
    margin-top: 1rem;
  }

  .bundle-section-title {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 0.5rem;
    font-weight: 600;

    .el-button {
      margin-left: auto;
    }
  }

  .bundle-section-count {
    border-radius: 10px;
    padding: 0 0.375rem;
    color: var(--fg2);
    background: var(--k-side-bg);
    font-size: 0.75rem;
    font-weight: normal;
    line-height: 1.25rem;
  }

  .bundle-member-list {
    border: 1px solid var(--k-color-border);
    border-radius: 8px;
    overflow: hidden;
  }

  .bundle-member {
    display: grid;
    gap: 0.5rem;
    margin-top: -1px;
    border-top: 1px solid var(--k-color-divider);
    padding: 0.75rem 0.875rem;
  }

  .member-row {
    display: flex;
    align-items: flex-start;
    gap: 0.75rem;

    .el-checkbox {
      height: 1.5rem;
    }
  }

  .member-main {
    min-width: 0;
    flex: 1 1 auto;

    &.toggle {
      cursor: pointer;
    }
  }

  .member-line {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.375rem;
  }

  .member-name {
    font-weight: 600;
  }

  .member-version {
    color: var(--fg3);
    font-size: 0.8125rem;
  }

  .member-risk {
    border-radius: 4px;
    padding: 0 0.375rem;
    color: var(--fg2);
    background: var(--k-side-bg);
    font-size: 0.75rem;
    line-height: 1.25rem;

    &.success {
      color: var(--k-color-success);
      background: color-mix(in srgb, var(--k-color-success) 12%, transparent);
    }

    &.warning {
      color: var(--warning);
      background: color-mix(in srgb, var(--warning) 12%, transparent);
    }

    &.danger {
      color: var(--danger);
      background: color-mix(in srgb, var(--danger) 12%, transparent);
    }
  }

  .member-sub {
    color: var(--fg3);
    font-size: 0.8125rem;
    overflow-wrap: anywhere;
  }

  .member-desc {
    margin: 0.25rem 0 0;
    color: var(--fg2);
    font-size: 0.8125rem;
    line-height: 1.5;
  }

  .member-options {
    display: flex;
    flex-wrap: wrap;
    gap: 0 1.25rem;
    padding-left: 1.75rem;

    .el-checkbox {
      margin-right: 0;
    }
  }

  .member-warning {
    margin: 0 0 0 1.75rem;
  }

  .sensitive-fields {
    display: grid;
    gap: 0.5rem;
    margin-left: 1.75rem;

    .editor-title {
      color: var(--fg2);
      font-size: 0.8125rem;
    }
  }

  .editor-field {
    display: grid;
    grid-template-columns: minmax(6rem, auto) minmax(0, 1fr);
    align-items: center;
    gap: 0.75rem;

    > span {
      color: var(--fg2);
      font-size: 0.8125rem;
      overflow-wrap: anywhere;
    }
  }

  .member-config {
    margin-left: 1.75rem;

    summary {
      color: var(--k-color-primary);
      font-size: 0.8125rem;
      cursor: pointer;
    }
  }

  .raw-json-editor {
    box-sizing: border-box;
    width: 100%;
    margin-top: 0.5rem;
    border: 1px solid var(--k-color-border);
    border-radius: 4px;
    padding: 0.5rem 0.75rem;
    color: var(--fg1);
    background: var(--k-side-bg);
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 0.8125rem;
    resize: vertical;

    &:focus {
      border-color: var(--k-color-primary);
      outline: none;
    }
  }

  .json-error-text {
    margin-top: 0.25rem;
    color: var(--danger);
    font-size: 0.8125rem;
  }

  .bundle-diff {
    margin-top: 1rem;
    border: 1px solid var(--k-color-border);
    border-radius: 8px;
    padding: 0.75rem 0.875rem;

    dl {
      display: grid;
      gap: 0.375rem;
      margin: 0.5rem 0 0;
    }

    dl div {
      display: grid;
      grid-template-columns: 6rem minmax(0, 1fr);
      gap: 0.75rem;
    }

    dt {
      color: var(--fg3);
    }

    dd {
      margin: 0;
      overflow-wrap: anywhere;
    }
  }

  .bundle-diff-title {
    font-weight: 600;
  }
}

@media (max-width: 768px) {
  .bundle-install-panel {
    .member-options,
    .member-warning,
    .sensitive-fields,
    .member-config {
      margin-left: 0;
      padding-left: 0;
    }

    .editor-field,
    .bundle-diff dl div {
      grid-template-columns: 1fr;
      gap: 0.25rem;
    }
  }
}
</style>
