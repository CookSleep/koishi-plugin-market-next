<template>
  <el-dialog
    v-model="showEnvironmentVersions"
    append-to-body
    destroy-on-close
    :class="['market-dialog', 'environment-versions-dialog']"
    :title="t('environment.title')"
    width="1000px"
  >
    <p class="environment-intro">{{ t('environment.intro') }}</p>

    <div v-if="!snapshots.some(snapshot => !snapshot.current)" class="environment-state" :class="{ error: loadError }">
      {{ loading ? t('environment.reading') : loadError || t('environment.empty') }}
    </div>

    <div v-else class="environment-layout">
      <div class="snapshot-list">
        <button
          v-for="snapshot in snapshots"
          :key="snapshot.id"
          type="button"
          :class="['snapshot-row', { active: snapshot.id === selectedId }]"
          @click="selectSnapshot(snapshot.id)"
        >
          <span class="snapshot-title">
            {{ snapshot.current ? t('environment.currentEnvironment') : formatDate(snapshot.createdAt) }}
            <span v-if="snapshot.current" class="current-tag">{{ t('environment.current') }}</span>
          </span>
          <span class="snapshot-meta">
            <template v-if="snapshot.current">{{ formatDate(snapshot.createdAt) }} · </template>
            {{ sourceText(snapshot.source) }} · {{ t('environment.dependencies', { count: snapshot.dependencyCount }) }}
          </span>
        </button>
      </div>

      <section class="snapshot-detail">
        <div v-if="previewLoading" class="environment-state">{{ t('environment.readingPreview') }}</div>
        <div v-else-if="previewError" class="environment-state error">{{ previewError }}</div>
        <div v-else-if="preview?.snapshot.current" class="environment-state">{{ t('environment.isCurrent') }}</div>
        <template v-else-if="preview">
          <header class="preview-header">
            <h3>{{ formatDate(preview.snapshot.createdAt) }}</h3>
            <p>
              {{ t('environment.changedCount', { count: changedCount }) }}
              <span v-if="preview.unsupportedCount" class="blocked"> · {{ t('environment.unsupportedCount', { count: preview.unsupportedCount }) }}</span>
            </p>
          </header>

          <p v-if="!changedCount" class="environment-state">{{ t('environment.noChanges') }}</p>
          <div v-if="visibleChanges.length" class="diff-list">
            <div v-for="change in visibleChanges" :key="change.name" :class="['diff-row', change.status]">
              <strong :title="change.name">{{ change.name }}</strong>
              <span class="diff-versions">
                <span>{{ versionText(change.currentVersion) }}</span>
                <span class="version-arrow">→</span>
                <span class="target">{{ versionText(change.targetVersion) }}</span>
              </span>
              <span :class="['change-status', change.status]">{{ statusText(change.status) }}</span>
              <small v-if="change.reason" class="change-reason">{{ reasonText(change.reason) }}</small>
            </div>
          </div>

          <el-button v-if="unchangedCount" class="toggle-unchanged" type="primary" text size="small" @click="showUnchanged = !showUnchanged">
            {{ showUnchanged ? t('environment.hideUnchanged') : t('environment.showUnchanged', { count: unchangedCount }) }}
          </el-button>
        </template>
      </section>
    </div>

    <template #footer>
      <el-button class="environment-refresh" :loading="loading" @click="loadSnapshots(true)">{{ t('environment.refresh') }}</el-button>
      <el-button @click="showEnvironmentVersions = false">{{ t('common.actions.close') }}</el-button>
      <el-button v-if="preview && !preview.snapshot.current" type="primary" :disabled="!canApply" @click="confirmVisible = true">
        {{ t('environment.restore') }}
      </el-button>
    </template>
  </el-dialog>

  <el-dialog
    v-model="confirmVisible"
    append-to-body
    :class="['market-dialog', 'environment-confirm-dialog']"
    :title="t('environment.confirmTitle')"
    width="520px"
  >
    <p>{{ t('environment.confirmText', { count: preview?.actionableCount ?? 0 }) }}</p>
    <k-comment type="warning">{{ t('environment.scopeWarning') }}</k-comment>
    <k-comment v-if="removedCount" type="danger">
      {{ t('environment.removeWarning', { count: removedCount }) }}
    </k-comment>
    <template #footer>
      <el-button @click="confirmVisible = false">{{ t('common.actions.cancel') }}</el-button>
      <el-button type="primary" @click="applySnapshot">{{ t('environment.confirmRestore') }}</el-button>
    </template>
  </el-dialog>
</template>

<script lang="ts" setup>
import { computed, ref, watch } from 'vue'
import { send } from '@koishijs/client'
import type {
  EnvironmentChangeStatus,
  EnvironmentSnapshotChange,
  EnvironmentSnapshotPreview,
  EnvironmentSnapshotSource,
  EnvironmentSnapshotSummary,
} from 'koishi-plugin-market-next'
import { applyEnvironmentSnapshot, showEnvironmentVersions } from './utils'
import { useMarketNextI18n } from '../i18n'

const { t, locale } = useMarketNextI18n()
const snapshots = ref<EnvironmentSnapshotSummary[]>([])
const selectedId = ref('')
const preview = ref<EnvironmentSnapshotPreview>()
const loading = ref(false)
const previewLoading = ref(false)
const loadError = ref('')
const previewError = ref('')
const confirmVisible = ref(false)
const showUnchanged = ref(false)
let previewSerial = 0

watch(showEnvironmentVersions, (visible) => {
  if (visible) void loadSnapshots()
  else confirmVisible.value = false
})

const statusOrder: Record<EnvironmentChangeStatus, number> = {
  unsupported: 0,
  removed: 1,
  downgrade: 2,
  upgrade: 3,
  added: 4,
  changed: 5,
  unchanged: 6,
}

const orderedChanges = computed(() => [...(preview.value?.changes ?? [])].sort((left, right) => {
  return statusOrder[left.status] - statusOrder[right.status] || left.name.localeCompare(right.name)
}))

const visibleChanges = computed(() => showUnchanged.value ? orderedChanges.value : orderedChanges.value.filter(change => change.status !== 'unchanged'))

const changedCount = computed(() => preview.value?.changes.filter(change => change.status !== 'unchanged').length ?? 0)
const unchangedCount = computed(() => preview.value?.changes.filter(change => change.status === 'unchanged').length ?? 0)
const removedCount = computed(() => preview.value?.changes.filter(change => change.status === 'removed').length ?? 0)
const canApply = computed(() => !!preview.value
  && !preview.value.snapshot.current
  && preview.value.actionableCount > 0
  && preview.value.unsupportedCount === 0)

async function loadSnapshots(preserveSelection = false) {
  if (loading.value) return
  loading.value = true
  loadError.value = ''
  try {
    snapshots.value = await (send('market/environment-snapshots') ?? Promise.resolve([]))
    const previous = preserveSelection && snapshots.value.some(snapshot => snapshot.id === selectedId.value)
      ? selectedId.value
      : ''
    const target = previous || snapshots.value.find(snapshot => !snapshot.current)?.id || ''
    if (target) await selectSnapshot(target, true)
    else {
      selectedId.value = ''
      preview.value = undefined
    }
  } catch (error) {
    console.error(error)
    loadError.value = t('environment.loadFailed')
  } finally {
    loading.value = false
  }
}

async function selectSnapshot(id: string, force = false) {
  if (!force && id === selectedId.value && preview.value) return
  selectedId.value = id
  showUnchanged.value = false
  preview.value = undefined
  previewError.value = ''
  previewLoading.value = true
  const serial = ++previewSerial
  try {
    const result = await (send('market/environment-snapshot-preview', id) ?? Promise.resolve(undefined))
    if (serial !== previewSerial) return
    if (!result) throw new Error('environment snapshot not found')
    preview.value = result
  } catch (error) {
    if (serial !== previewSerial) return
    console.error(error)
    previewError.value = t('environment.previewFailed')
  } finally {
    if (serial === previewSerial) previewLoading.value = false
  }
}

function applySnapshot() {
  if (!canApply.value || !preview.value) return
  const id = preview.value.snapshot.id
  const selfUpdate = preview.value.changes.some(change => {
    return change.name === 'koishi-plugin-market-next' && change.status !== 'unchanged'
  })
  confirmVisible.value = false
  void applyEnvironmentSnapshot(id, selfUpdate)
}

function formatDate(value: number) {
  if (!Number.isFinite(value) || value <= 0) return t('common.messages.timeUnknown')
  return new Date(value).toLocaleString(locale.value)
}

function sourceText(source: EnvironmentSnapshotSource) {
  switch (source) {
    case 'startup': return t('environment.sourceStartup')
    case 'operation': return t('environment.sourceOperation')
    default: return t('environment.sourceExternal')
  }
}

function versionText(version?: string) {
  return version || t('environment.notInstalled')
}

function statusText(status: EnvironmentChangeStatus) {
  return t(`environment.change.${status}`)
}

function reasonText(reason: NonNullable<EnvironmentSnapshotChange['reason']>) {
  return t(`environment.reason.${reason}`)
}
</script>

<style lang="scss">
.environment-versions-dialog {
  .environment-intro {
    margin: 0 0 1rem;
    color: var(--fg2);
    line-height: 1.6;
  }

  .environment-state {
    margin: 0;
    padding: 3rem 1rem;
    color: var(--fg3);
    text-align: center;

    &.error {
      color: var(--danger);
    }
  }

  .environment-layout {
    display: grid;
    grid-template-columns: 16rem minmax(0, 1fr);
    height: min(30rem, calc(100vh - 18rem));
    border: 1px solid var(--k-color-border);
    border-radius: 8px;
    overflow: hidden;
  }

  .snapshot-list {
    min-height: 0;
    overflow-y: auto;
    border-right: 1px solid var(--k-color-border);
  }

  .snapshot-row {
    display: grid;
    gap: 0.125rem;
    width: 100%;
    border: 0;
    border-bottom: 1px solid var(--k-color-divider);
    padding: 0.625rem 0.875rem;
    color: var(--fg1);
    background: transparent;
    font: inherit;
    text-align: left;
    cursor: pointer;

    &:hover {
      background: var(--k-hover-bg);
    }

    &.active {
      background: color-mix(in srgb, var(--k-color-primary) 10%, transparent);
    }
  }

  .snapshot-title {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-weight: 600;
  }

  .snapshot-meta {
    color: var(--fg3);
    font-size: 0.8125rem;
  }

  .current-tag {
    border-radius: 4px;
    padding: 0 0.375rem;
    color: var(--k-color-success);
    background: color-mix(in srgb, var(--k-color-success) 12%, transparent);
    font-size: 0.75rem;
    font-weight: normal;
    line-height: 1.25rem;
  }

  .snapshot-detail {
    min-width: 0;
    min-height: 0;
    overflow-y: auto;
    padding: 1rem 1.25rem;
  }

  .preview-header {
    margin-bottom: 1rem;

    h3 {
      margin: 0;
      font-size: 1rem;
    }

    p {
      margin: 0.25rem 0 0;
      color: var(--fg3);
      font-size: 0.8125rem;
    }

    .blocked {
      color: var(--danger);
    }
  }

  .diff-list {
    border: 1px solid var(--k-color-border);
    border-radius: 8px;
    overflow: hidden;
  }

  .diff-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, auto) 4rem;
    align-items: baseline;
    gap: 0.25rem 1rem;
    margin-top: -1px;
    border-top: 1px solid var(--k-color-divider);
    padding: 0.5rem 0.875rem;

    strong {
      min-width: 0;
      overflow: hidden;
      font-weight: 500;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  }

  .diff-versions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.375rem;
    min-width: 0;
    color: var(--fg2);
    font-variant-numeric: tabular-nums;
    overflow-wrap: anywhere;

    .version-arrow {
      color: var(--fg3);
    }

    .target {
      color: var(--fg1);
      font-weight: 600;
    }
  }

  .change-status {
    color: var(--fg3);
    font-size: 0.8125rem;
    text-align: right;

    &.upgrade,
    &.added {
      color: var(--k-color-success);
    }

    &.downgrade,
    &.changed {
      color: var(--warning);
    }

    &.removed,
    &.unsupported {
      color: var(--danger);
    }
  }

  .change-reason {
    grid-column: 1 / -1;
    color: var(--fg3);
  }

  .toggle-unchanged {
    margin-top: 0.5rem;
  }

  .environment-refresh {
    margin-right: auto;
  }
}

.environment-confirm-dialog p {
  margin-top: 0;
}

@media (max-width: 768px) {
  .environment-versions-dialog {
    .environment-layout {
      grid-template-columns: 1fr;
      height: auto;
    }

    .snapshot-list {
      max-height: 12rem;
      border-right: 0;
      border-bottom: 1px solid var(--k-color-border);
    }

    .snapshot-detail {
      overflow: visible;
      padding: 0.875rem;
    }

    .diff-row {
      grid-template-columns: minmax(0, 1fr) auto;

      strong {
        grid-column: 1 / -1;
      }
    }
  }
}
</style>
