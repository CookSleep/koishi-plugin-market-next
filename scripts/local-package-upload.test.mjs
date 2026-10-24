import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { gzipSync } from 'node:zlib'
import { create, Header } from 'tar'

import {
  getLocalPackageOperation,
  LocalPackageUploadStore,
} from '../src/node/local-upload.ts'

async function createPackageArchive(root, manifest, payload = 'module.exports = {}\n') {
  const source = join(root, 'source')
  const packageRoot = join(source, 'package')
  await mkdir(packageRoot, { recursive: true })
  await writeFile(join(packageRoot, 'package.json'), JSON.stringify(manifest, null, 2))
  await writeFile(join(packageRoot, 'index.js'), payload)
  const archive = join(root, 'plugin.tgz')
  await create({ cwd: source, file: archive, gzip: true }, ['package'])
  return archive
}

async function uploadArchive(store, archive) {
  const content = await readFile(archive)
  const started = await store.start({ filename: 'plugin.tgz', size: content.length })
  let index = 0
  for (let offset = 0; offset < content.length; offset += started.chunkSize) {
    await store.append({
      uploadId: started.uploadId,
      index: index++,
      data: content.subarray(offset, offset + started.chunkSize).toString('base64'),
    })
  }
  return { started, content }
}

test('uploads, validates, and commits an npm-packed Koishi plugin', async () => {
  const root = await mkdtemp(join(tmpdir(), 'market-next-local-upload-'))
  const warnings = []
  const store = new LocalPackageUploadStore(root, message => warnings.push(message))
  try {
    const archive = await createPackageArchive(root, {
      name: 'koishi-plugin-local-example',
      version: '1.2.3',
      description: 'local package test',
      main: 'index.js',
      scripts: { postinstall: 'node setup.js' },
    })
    const { started, content } = await uploadArchive(store, archive)
    const preview = await store.finish({ uploadId: started.uploadId })
    assert.equal(preview.manifest.name, 'koishi-plugin-local-example')
    assert.equal(preview.manifest.version, '1.2.3')
    assert.equal(preview.size, content.length)
    assert.match(preview.hash, /^[a-f0-9]{64}$/)
    assert.match(preview.targetFilename, /^koishi-plugin-local-example-1\.2\.3-[a-f0-9]{12}\.tgz$/)

    const committed = await store.commit(started.uploadId)
    assert.equal(committed.name, 'koishi-plugin-local-example')
    assert.equal(committed.version, '1.2.3')
    assert.equal(committed.request, `file:.yarn/local/${committed.filename}`)
    assert.deepEqual(await readFile(join(root, '.yarn', 'local', committed.filename)), content)
    assert.deepEqual(warnings, [])
  } finally {
    await store.dispose()
    await rm(root, { recursive: true, force: true })
  }
})

test('serializes concurrent chunks and finish for the same upload', async () => {
  const root = await mkdtemp(join(tmpdir(), 'market-next-local-upload-concurrent-'))
  const store = new LocalPackageUploadStore(root, () => {})
  try {
    const archive = await createPackageArchive(root, {
      name: 'koishi-plugin-concurrent', version: '1.0.0', main: 'index.js',
    })
    const content = await readFile(archive)
    const first = content.subarray(0, Math.floor(content.length / 2))
    const second = content.subarray(first.length)
    const { uploadId } = await store.start({ filename: 'plugin.tgz', size: content.length })
    const [one, two, preview] = await Promise.all([
      store.append({ uploadId, index: 0, data: first.toString('base64') }),
      store.append({ uploadId, index: 1, data: second.toString('base64') }),
      store.finish({ uploadId }),
    ])
    assert.equal(one.received, first.length)
    assert.equal(two.received, content.length)
    assert.equal(preview.size, content.length)
    const committed = await store.commit(uploadId)
    assert.deepEqual(await readFile(join(root, '.yarn', 'local', committed.filename)), content)
  } finally {
    await store.dispose()
    await rm(root, { recursive: true, force: true })
  }
})

test('uploads large archives in 32 KiB chunks below a 48 KiB Console message ceiling', async () => {
  const root = await mkdtemp(join(tmpdir(), 'market-next-local-upload-chunks-'))
  const store = new LocalPackageUploadStore(root, () => {})
  try {
    const archive = await createPackageArchive(root, {
      name: 'koishi-plugin-upload-chunks', version: '1.0.0', main: 'index.js',
    }, randomBytes(128 * 1024 + 7))
    const content = await readFile(archive)
    assert.ok(content.length > 100 * 1024)
    const started = await store.start({ filename: 'plugin.tgz', size: content.length })
    assert.equal(started.chunkSize, 32 * 1024)
    assert.equal(started.maxSize, 64 * 1024 * 1024)
    await assert.rejects(store.append({
      uploadId: started.uploadId, index: 0,
      data: content.subarray(0, started.chunkSize + 1).toString('base64'),
    }), /分块大小无效/)

    let index = 0
    for (let offset = 0; offset < content.length; offset += started.chunkSize) {
      const end = Math.min(content.length, offset + started.chunkSize)
      const request = {
        uploadId: started.uploadId, index: index++,
        data: content.subarray(offset, end).toString('base64'),
      }
      const message = JSON.stringify({
        id: '1234567', type: 'market/local-package-upload-chunk', args: [request],
      })
      assert.ok(Buffer.byteLength(message) < 48 * 1024)
      assert.deepEqual(await store.append(request), { received: end, size: content.length })
    }
    assert.ok(index > 1)
    const preview = await store.finish({ uploadId: started.uploadId })
    assert.equal(preview.manifest.name, 'koishi-plugin-upload-chunks')
    const committed = await store.commit(started.uploadId)
    assert.deepEqual(await readFile(join(root, '.yarn', 'local', committed.filename)), content)
  } finally {
    await store.dispose()
    await rm(root, { recursive: true, force: true })
  }
})

test('rejects archives that are not Koishi plugins', async () => {
  const root = await mkdtemp(join(tmpdir(), 'market-next-local-upload-invalid-'))
  const store = new LocalPackageUploadStore(root, () => {})
  try {
    const archive = await createPackageArchive(root, {
      name: 'ordinary-package',
      version: '1.0.0',
      main: 'index.js',
    })
    const { started } = await uploadArchive(store, archive)
    await assert.rejects(
      store.finish({ uploadId: started.uploadId }),
      /不是有效的 Koishi 插件名称/,
    )
  } finally {
    await store.dispose()
    await rm(root, { recursive: true, force: true })
  }
})

function archiveEntry(path, content, fields = {}) {
  const data = Buffer.isBuffer(content) ? content : Buffer.from(content)
  const header = new Header({ path, type: 'File', mode: 0o644, size: data.length, ...fields })
  header.encode()
  return Buffer.concat([header.block, data, Buffer.alloc((512 - data.length % 512) % 512)])
}

const manifestEntry = archiveEntry('package/package.json', JSON.stringify({
  name: 'koishi-plugin-archive-validation', version: '1.0.0',
}))
const payloadEntry = archiveEntry('package/index.js', randomBytes(128 * 1024))
const validEntries = [manifestEntry, payloadEntry]
const invalidArchives = [
  ['unsafe paths', [...validEntries, archiveEntry('../outside.txt', 'x')], '非法路径'],
  ['symbolic links', [...validEntries, archiveEntry('package/link', '', {
    type: 'SymbolicLink', linkpath: 'index.js',
  })], '不允许的条目类型'],
  ['duplicate manifests', [...validEntries, manifestEntry], '重复的 package.json'],
  ['empty manifests', [payloadEntry, archiveEntry('package/package.json', '')], 'package.json 大小无效'],
  ['oversized manifests', [payloadEntry, archiveEntry('package/package.json', ' '.repeat(1024 * 1024 + 1))], 'package.json 大小无效'],
  ['too many entries', [...validEntries, ...Array.from({ length: 8191 }, (_, i) => archiveEntry(`package/asset-${i}`, ''))], '文件数量过多'],
  ['excessive expanded size', [...validEntries, archiveEntry('package/huge.bin', '', {
    size: 256 * 1024 * 1024 + 1,
  })], '解压后内容过大'],
  ['missing manifests', [payloadEntry], '缺少 package/package.json'],
  ['invalid manifest JSON', [payloadEntry, archiveEntry('package/package.json', '{')], '不是有效的 JSON'],
].map(([label, entries, pattern]) => [label, gzipSync(Buffer.concat([...entries, Buffer.alloc(1024)])), pattern])
invalidArchives.push(
  ['corrupt archives', randomBytes(128 * 1024), '无法读取本地插件归档'],
  ['truncated gzip', gzipSync(Buffer.concat([...validEntries, Buffer.alloc(1024)])).subarray(0, 1024), '无法读取本地插件归档'],
)

// Isolate these regressions: an exception escaping the parser must fail the test, not kill its runner.
const archiveValidationWorker = `
  import assert from 'node:assert/strict'
  import { readFile, readdir } from 'node:fs/promises'
  import { join } from 'node:path'
  import { LocalPackageUploadStore } from './src/node/local-upload.ts'

  const [root, pattern] = process.argv.slice(1)
  const warnings = []
  const store = new LocalPackageUploadStore(root, message => warnings.push(message))
  async function upload(filename) {
    const content = await readFile(join(root, filename))
    const started = await store.start({ filename, size: content.length })
    let index = 0
    for (let offset = 0; offset < content.length; offset += started.chunkSize) {
      await store.append({
        uploadId: started.uploadId, index: index++,
        data: content.subarray(offset, offset + started.chunkSize).toString('base64'),
      })
    }
    return started.uploadId
  }
  try {
    const uploadId = await upload('invalid.tgz')
    await assert.rejects(store.finish({ uploadId }), new RegExp(pattern))
    assert.equal(await store.cancel(uploadId), false)
    await store.pruneExpired()
    assert.deepEqual(await readdir(join(root, '.yarn', 'local', '.market-next-upload')), [])
    const nextId = await upload('valid.tgz')
    const preview = await store.finish({ uploadId: nextId })
    assert.equal(preview.manifest.name, 'koishi-plugin-archive-validation')
    assert.equal(await store.cancel(nextId), true)
    assert.deepEqual(warnings, [])
  } finally {
    await store.dispose()
  }
`

for (const [label, archive, pattern] of invalidArchives) {
  test(`rejects ${label} without crashing or blocking upload cleanup`, { timeout: 15000 }, async () => {
    const root = await mkdtemp(join(tmpdir(), 'market-next-archive-validation-'))
    try {
      await writeFile(join(root, 'invalid.tgz'), archive)
      await writeFile(join(root, 'valid.tgz'), gzipSync(Buffer.concat([...validEntries, Buffer.alloc(1024)])))
      await promisify(execFile)(process.execPath, [
        '--import', 'tsx', '--input-type=module', '-e', archiveValidationWorker, root, pattern,
      ], { cwd: fileURLToPath(new URL('..', import.meta.url)), timeout: 10000 })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
}

test('classifies same-name local package changes as version operations', () => {
  assert.equal(getLocalPackageOperation(undefined, undefined, '1.0.0'), 'install')
  assert.equal(getLocalPackageOperation('^1.0.0', '1.0.0', '2.0.0'), 'upgrade')
  assert.equal(getLocalPackageOperation('file:.yarn/local/example-2.0.0.tgz', '2.0.0', '1.5.0'), 'downgrade')
  assert.equal(getLocalPackageOperation('file:.yarn/local/example-a.tgz', '1.0.0', '1.0.0'), 'replace')
})
