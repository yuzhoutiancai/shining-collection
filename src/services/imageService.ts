import type { StoredImage } from '../types/asset'

const FULL_EDGE = 1920
const THUMB_EDGE = 480
const MAX_FILES = 9

const id = () => crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`
const canvasBlob = (canvas: HTMLCanvasElement, type: string, quality: number) => new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('图片编码失败')), type, quality))

async function resize(file: File, edge: number) {
  const bitmap = await createImageBitmap(file)
  const ratio = Math.min(1, edge / Math.max(bitmap.width, bitmap.height))
  const width = Math.max(1, Math.round(bitmap.width * ratio)), height = Math.max(1, Math.round(bitmap.height * ratio))
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, width, height); bitmap.close()
  const supportsWebp = canvas.toDataURL('image/webp').startsWith('data:image/webp')
  const mimeType = supportsWebp ? 'image/webp' : 'image/jpeg'
  return { blob: await canvasBlob(canvas, mimeType, edge === THUMB_EDGE ? .78 : .84), width, height, mimeType }
}

export async function processImages(assetId: string, files: File[], onProgress?: (done: number, total: number) => void): Promise<StoredImage[]> {
  if (!files.length) return []
  if (files.length > MAX_FILES) throw new Error(`一次最多选择 ${MAX_FILES} 张图片`)
  const result: StoredImage[] = []
  for (const [index, file] of files.entries()) {
    if (!file.type.startsWith('image/')) throw new Error('请选择可读取的图片文件')
    const [full, thumbnail] = await Promise.all([resize(file, FULL_EDGE), resize(file, THUMB_EDGE)])
    result.push({ id: id(), assetId, fullBlob: full.blob, thumbnailBlob: thumbnail.blob, mimeType: full.mimeType, width: full.width, height: full.height, size: full.blob.size, thumbnailSize: thumbnail.blob.size, createdAt: Date.now() })
    onProgress?.(index + 1, files.length)
  }
  return result
}

export const blobUrl = (blob?: Blob) => blob ? URL.createObjectURL(blob) : undefined
