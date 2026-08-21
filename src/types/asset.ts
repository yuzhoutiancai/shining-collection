export type AssetType = 'face' | 'dye' | 'template' | 'board' | 'body' | string

export interface Asset {
  id: string
  type: AssetType
  name: string
  nameNormalized: string
  code: string
  imageIds: string[]
  coverImageId?: string
  favorite: boolean
  sourcePlatform?: string
  sourceAuthor?: string
  sourceUrl?: string
  note?: string
  createdAt: number
  updatedAt: number
}

export interface Tag {
  id: string
  name: string
  nameNormalized: string
  createdAt: number
}

export interface AssetTag {
  assetId: string
  tagId: string
}

export interface StoredImage {
  id: string
  assetId: string
  fullBlob: Blob
  thumbnailBlob: Blob
  mimeType: string
  width: number
  height: number
  size: number
  thumbnailSize: number
  createdAt: number
}

export interface AssetListItem extends Asset {
  tags: Tag[]
}

export const assetTypes = [
  { id: 'face', name: '脸码', icon: '◌', tint: 'rose' },
  { id: 'dye', name: '染色码', icon: '✦', tint: 'butter' },
  { id: 'template', name: '模板码', icon: '◇', tint: 'lilac' },
  { id: 'board', name: '看板码', icon: '▱', tint: 'peach' },
  { id: 'body', name: '身体码', icon: '♡', tint: 'mint' },
] as const

export const typeName = (type: AssetType) => assetTypes.find((item) => item.id === type)?.name ?? type
