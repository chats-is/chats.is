import { type Model } from './model'

export interface SystemDefaults {
  chatModelId: string | null
  imageModelId: string | null
  imageEditModelId: string | null
  videoModelId: string | null
  videoImageModelId: string | null
  videoEditModelId: string | null
  ttsModelId: string | null
  sttModelId: string | null
}

export interface SystemSettings {
  appName: string
  appSubtitle: string
  appDescription: string
  speechEnabled: boolean
  chatModels: Model[]
  imageModels: Model[]
  videoModels: Model[]
  ttsModels: Model[]
  sttModels: Model[]
  defaults: SystemDefaults
}
