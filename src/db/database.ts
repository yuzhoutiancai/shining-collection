import type { Asset, AssetListItem, AssetTag, StoredImage, Tag } from '../types/asset'

const DB_NAME = 'shining-collection'
const DB_VERSION = 1
const STORES = { assets: 'assets', tags: 'tags', assetTags: 'assetTags', images: 'images', settings: 'settings', meta: 'meta' } as const

type StoredAssetTag = AssetTag & { id: string }
type AssetInput = Omit<Asset, 'id' | 'nameNormalized' | 'createdAt' | 'updatedAt' | 'imageIds'> & { name: string; tags: string[] }

function request<T>(value: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => { value.onsuccess = () => resolve(value.result); value.onerror = () => reject(value.error ?? new Error('数据库操作失败')) })
}

function done(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => { transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error ?? new Error('数据库事务失败')); transaction.onabort = () => reject(transaction.error ?? new Error('数据库事务已取消')) })
}

function normalize(value: string) { return value.trim().toLocaleLowerCase('zh-CN') }
function createId() { return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}` }

async function openDatabase(): Promise<IDBDatabase> {
  const open = indexedDB.open(DB_NAME, DB_VERSION)
  open.onupgradeneeded = () => {
    const db = open.result
    const assets = db.createObjectStore(STORES.assets, { keyPath: 'id' })
    assets.createIndex('type', 'type')
    assets.createIndex('favorite', 'favorite')
    assets.createIndex('createdAt', 'createdAt')
    assets.createIndex('updatedAt', 'updatedAt')
    const tags = db.createObjectStore(STORES.tags, { keyPath: 'id' })
    tags.createIndex('nameNormalized', 'nameNormalized', { unique: true })
    const assetTags = db.createObjectStore(STORES.assetTags, { keyPath: 'id' })
    assetTags.createIndex('assetId', 'assetId')
    assetTags.createIndex('tagId', 'tagId')
    db.createObjectStore(STORES.images, { keyPath: 'id' }).createIndex('assetId', 'assetId')
    db.createObjectStore(STORES.settings, { keyPath: 'key' })
    db.createObjectStore(STORES.meta, { keyPath: 'key' })
  }
  return request(open)
}

async function withDb<T>(callback: (db: IDBDatabase) => Promise<T>) {
  if (!('indexedDB' in globalThis)) throw new Error('当前浏览器不支持 IndexedDB，请使用系统浏览器打开。')
  const db = await openDatabase()
  try { return await callback(db) } finally { db.close() }
}

async function readList(db: IDBDatabase): Promise<AssetListItem[]> {
  const tx = db.transaction([STORES.assets, STORES.tags, STORES.assetTags], 'readonly')
  const [assets, tags, links] = await Promise.all([
    request(tx.objectStore(STORES.assets).getAll()) as Promise<Asset[]>,
    request(tx.objectStore(STORES.tags).getAll()) as Promise<Tag[]>,
    request(tx.objectStore(STORES.assetTags).getAll()) as Promise<StoredAssetTag[]>,
  ])
  await done(tx)
  const tagById = new Map(tags.map((tag) => [tag.id, tag]))
  const tagIdsByAsset = new Map<string, string[]>()
  links.forEach((link) => tagIdsByAsset.set(link.assetId, [...(tagIdsByAsset.get(link.assetId) ?? []), link.tagId]))
  return assets.map((asset) => ({ ...asset, tags: (tagIdsByAsset.get(asset.id) ?? []).map((id) => tagById.get(id)).filter((tag): tag is Tag => Boolean(tag)) }))
}

export const db = {
  async exportBackupData() { return withDb(async (database) => { const tx = database.transaction([STORES.assets, STORES.tags, STORES.assetTags, STORES.images], 'readonly'); const [assets,tags,assetTags,images] = await Promise.all([request(tx.objectStore(STORES.assets).getAll()),request(tx.objectStore(STORES.tags).getAll()),request(tx.objectStore(STORES.assetTags).getAll()),request(tx.objectStore(STORES.images).getAll())]); await done(tx); return {assets:assets as Asset[],tags:tags as Tag[],assetTags:assetTags as StoredAssetTag[],images:images as StoredImage[]} }) },
  async storageSummary() { const data = await this.exportBackupData(); const referenced = new Set(data.assets.flatMap((asset) => asset.imageIds)); return { assetCount: data.assets.length, imageCount: data.images.length, imageBytes: data.images.reduce((sum, image) => sum + image.size + image.thumbnailSize, 0), orphanCount: data.images.filter((image) => !referenced.has(image.id)).length } },
  async clearOrphanImages() { return withDb(async (database) => { const tx=database.transaction([STORES.assets,STORES.images],'readwrite'); const assets=await request(tx.objectStore(STORES.assets).getAll()) as Asset[]; const images=await request(tx.objectStore(STORES.images).getAll()) as StoredImage[]; const refs=new Set(assets.flatMap(asset=>asset.imageIds)); const orphans=images.filter(image=>!refs.has(image.id)); orphans.forEach(image=>tx.objectStore(STORES.images).delete(image.id)); await done(tx); return orphans.length }) },
  async replaceBackupData(data: { assets: Array<Record<string, unknown>>; tags: Array<Record<string, unknown>>; assetTags: Array<Record<string, unknown>> }) { return withDb(async (database) => { const tx = database.transaction([STORES.assets, STORES.tags, STORES.assetTags, STORES.images], 'readwrite'); [STORES.assets, STORES.tags, STORES.assetTags, STORES.images].forEach((store) => tx.objectStore(store).clear()); data.assets.forEach((item) => tx.objectStore(STORES.assets).put({ ...item, imageIds: [] })); data.tags.forEach((item) => tx.objectStore(STORES.tags).put(item)); data.assetTags.forEach((item) => tx.objectStore(STORES.assetTags).put(item)); await done(tx) }) },
  async listAssets(): Promise<AssetListItem[]> { return withDb(readList) },
  async listTags(): Promise<Tag[]> { return withDb(async (database) => { const tx = database.transaction(STORES.tags, 'readonly'); const tags = await request(tx.objectStore(STORES.tags).getAll()) as Tag[]; await done(tx); return tags }) },
  async saveAsset(input: AssetInput, existing?: Asset): Promise<Asset> {
    return withDb(async (database) => {
      const tx = database.transaction([STORES.assets, STORES.tags, STORES.assetTags], 'readwrite')
      const now = Date.now()
      const asset: Asset = { ...existing, ...input, id: existing?.id ?? createId(), name: input.name.trim(), nameNormalized: normalize(input.name), imageIds: existing?.imageIds ?? [], createdAt: existing?.createdAt ?? now, updatedAt: now }
      tx.objectStore(STORES.assets).put(asset)
      const links = tx.objectStore(STORES.assetTags)
      const existingLinks = (await request(links.getAll()) as StoredAssetTag[]).filter((link) => link.assetId === asset.id)
      existingLinks.forEach((link) => links.delete(link.id))
      for (const rawName of input.tags) {
        const name = rawName.replace(/^#/, '').trim()
        if (!name) continue
        const normalized = normalize(name)
        const tagsStore = tx.objectStore(STORES.tags)
        const tag = await request(tagsStore.index('nameNormalized').get(normalized)) as Tag | undefined
        const tagId = tag?.id ?? createId()
        if (!tag) tagsStore.put({ id: tagId, name, nameNormalized: normalized, createdAt: now } satisfies Tag)
        links.put({ id: createId(), assetId: asset.id, tagId } satisfies StoredAssetTag)
      }
      await done(tx)
      return asset
    })
  },
  async deleteAsset(assetId: string) {
    return withDb(async (database) => {
      const tx = database.transaction([STORES.assets, STORES.assetTags, STORES.images], 'readwrite')
      tx.objectStore(STORES.assets).delete(assetId)
      const links = await request(tx.objectStore(STORES.assetTags).getAll()) as StoredAssetTag[]
      links.filter((link) => link.assetId === assetId).forEach((link) => tx.objectStore(STORES.assetTags).delete(link.id))
      const images = await request(tx.objectStore(STORES.images).getAll()) as StoredImage[]
      images.filter((image) => image.assetId === assetId).forEach((image) => tx.objectStore(STORES.images).delete(image.id))
      await done(tx)
    })
  },
  async setFavorite(asset: Asset, favorite: boolean) {
    return withDb(async (database) => {
      const tx = database.transaction(STORES.assets, 'readwrite')
      tx.objectStore(STORES.assets).put({ ...asset, favorite, updatedAt: Date.now() })
      await done(tx)
    })
  },
  async addImages(assetId: string, images: StoredImage[]) {
    return withDb(async (database) => {
      const tx = database.transaction([STORES.assets, STORES.images], 'readwrite')
      const asset = await request(tx.objectStore(STORES.assets).get(assetId)) as Asset | undefined
      if (!asset) throw new Error('素材不存在')
      images.forEach((image) => tx.objectStore(STORES.images).put(image))
      const imageIds = [...asset.imageIds, ...images.map((image) => image.id)]
      tx.objectStore(STORES.assets).put({ ...asset, imageIds, coverImageId: asset.coverImageId ?? images[0]?.id, updatedAt: Date.now() })
      await done(tx)
    })
  },
  async getImage(imageId: string) { return withDb(async (database) => { const tx = database.transaction(STORES.images, 'readonly'); const image = await request(tx.objectStore(STORES.images).get(imageId)) as StoredImage | undefined; await done(tx); return image }) },
  async deleteImage(assetId: string, imageId: string) {
    return withDb(async (database) => { const tx = database.transaction([STORES.assets, STORES.images], 'readwrite'); const asset = await request(tx.objectStore(STORES.assets).get(assetId)) as Asset | undefined; if (!asset) throw new Error('素材不存在'); tx.objectStore(STORES.images).delete(imageId); const imageIds = asset.imageIds.filter((id) => id !== imageId); tx.objectStore(STORES.assets).put({ ...asset, imageIds, coverImageId: asset.coverImageId === imageId ? imageIds[0] : asset.coverImageId, updatedAt: Date.now() }); await done(tx) })
  },
  async updateImageOrder(asset: Asset, imageIds: string[], coverImageId?: string) {
    return withDb(async (database) => { const tx = database.transaction(STORES.assets, 'readwrite'); tx.objectStore(STORES.assets).put({ ...asset, imageIds, coverImageId: coverImageId ?? asset.coverImageId, updatedAt: Date.now() }); await done(tx) })
  },
}
