/**
 * What each kind of upload accepts, shared by the browser (which picks the
 * file) and the route that signs the token (which is what actually enforces
 * it — the browser's copy is a courtesy, not a control).
 *
 * Uploads go straight from the browser to blob storage: a Vercel function
 * cannot receive more than 4.5 MB of request body on any plan, which no video
 * and few audio files fit inside.
 */
export const UPLOAD_CONFIG = {
  avatar: {
    folder: 'avatars',
    allowedTypes: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
    maxSize: 5 * 1024 * 1024,
  },
  attachment: {
    folder: 'attachments',
    allowedTypes: [
      'image/jpeg',
      'image/png',
      'image/gif',
      'image/webp',
      // Audio attachments feed the chat transcribe_audio (STT) tool.
      'audio/mpeg',
      'audio/mp3',
      'audio/wav',
      'audio/x-wav',
      'audio/mp4',
      'audio/x-m4a',
      'audio/ogg',
      'audio/webm',
      'audio/flac',
      // Video attachments feed the chat edit_video tool.
      'video/mp4',
      'video/quicktime',
      'video/webm',
    ],
    maxSize: 10 * 1024 * 1024,
    /** Video is the reason client uploads exist here; a clip needs the room. */
    videoMaxSize: 100 * 1024 * 1024,
  },
  prompts: {
    folder: 'prompts',
    allowedTypes: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
    maxSize: 5 * 1024 * 1024,
  },
} as const

export type UploadType = keyof typeof UPLOAD_CONFIG

export function isUploadType(value: unknown): value is UploadType {
  return typeof value === 'string' && value in UPLOAD_CONFIG
}

const VIDEO_EXTENSIONS = ['.mp4', '.mov', '.webm']

/**
 * The ceiling for one file. A token is signed for a single pathname before the
 * bytes exist, so the size limit has to be decided from the name — video gets
 * the larger allowance, everything else the ordinary one.
 */
export function maxSizeForPathname(type: UploadType, pathname: string): number {
  const config = UPLOAD_CONFIG[type]
  if (!('videoMaxSize' in config)) return config.maxSize

  const isVideo = VIDEO_EXTENSIONS.some((ext) =>
    pathname.toLowerCase().endsWith(ext),
  )
  return isVideo ? config.videoMaxSize : config.maxSize
}
