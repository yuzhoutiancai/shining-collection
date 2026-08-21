// Uses the workspace-bundled JSZip during development; production will declare it as a normal dependency.
import JSZip from 'jszip'
import { db } from '../db/database'
import { processImages } from './imageService'

export const BACKUP_FORMAT = 'shining-collection-backup'
export const SCHEMA_VERSION = 1

export async function exportBackup() {
  const data = await db.exportBackupData()
  const zip = new JSZip()
  const images = zip.folder('images')!
  for (const image of data.images) images.file(`${image.id}.${image.mimeType.includes('png') ? 'png' : image.mimeType.includes('jpeg') ? 'jpg' : 'webp'}`, image.fullBlob)
  zip.file('manifest.json', JSON.stringify({ format: BACKUP_FORMAT, appVersion: '0.0.1', schemaVersion: SCHEMA_VERSION, exportDate: new Date().toISOString(), assetCount: data.assets.length, imageCount: data.images.length }, null, 2))
  zip.file('data.json', JSON.stringify({ assets: data.assets, tags: data.tags, assetTags: data.assetTags, images: data.images.map(({ fullBlob, thumbnailBlob, ...meta }) => meta) }, null, 2))
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' })
}

export function downloadBackup(blob: Blob) { const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `shining-collection-backup-${new Date().toISOString().slice(0,10)}.zip`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000) }

export async function restoreBackup(file: File, onProgress?: (done: number, total: number) => void) {
  const zip = await JSZip.loadAsync(file)
  const manifestText = await zip.file('manifest.json')?.async('text')
  const dataText = await zip.file('data.json')?.async('text')
  if (!manifestText || !dataText) throw new Error('备份缺少 manifest.json 或 data.json')
  const manifest = JSON.parse(manifestText) as { format?: string; schemaVersion?: number; imageCount?: number }
  const data = JSON.parse(dataText) as { assets?: Array<Record<string, unknown>>; tags?: Array<Record<string, unknown>>; assetTags?: Array<Record<string, unknown>>; images?: Array<{ id: string; assetId: string; mimeType: string }> }
  if (manifest.format !== BACKUP_FORMAT || manifest.schemaVersion !== SCHEMA_VERSION || !Array.isArray(data.assets) || !Array.isArray(data.images)) throw new Error('不是兼容的闪亮收藏备份')
  if (manifest.imageCount !== data.images.length) throw new Error('备份图片数量不一致')
  const files = await Promise.all(data.images.map(async (image) => { const entry = Object.values(zip.files).find((x) => x.name.startsWith(`images/${image.id}.`)); if (!entry) throw new Error('备份图片不完整'); return { image, blob: await entry.async('blob') } }))
  await db.replaceBackupData({ assets: data.assets, tags: data.tags ?? [], assetTags: data.assetTags ?? [] })
  for (const [index, item] of files.entries()) { const source = new File([item.blob], `restore.${item.image.mimeType.includes('png') ? 'png' : 'webp'}`, { type: item.image.mimeType }); await db.addImages(item.image.assetId, await processImages(item.image.assetId, [source])); onProgress?.(index + 1, files.length) }
}
