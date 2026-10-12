import { UPLOAD_CONFIG } from '@/lib/constant';

export type UploadType = keyof typeof UPLOAD_CONFIG;

export function isUploadType(value: unknown): value is UploadType {
  return typeof value === 'string' && value in UPLOAD_CONFIG;
}

const VIDEO_EXTENSIONS = ['.mp4', '.mov', '.webm'];

/**
 * The ceiling for one file. A token is signed for a single pathname before the
 * bytes exist, so the size limit has to be decided from the name — video gets
 * the larger allowance, everything else the ordinary one.
 */
export function maxSizeForPathname(type: UploadType, pathname: string): number {
  const config = UPLOAD_CONFIG[type];
  if (!('videoMaxSize' in config)) return config.maxSize;

  const isVideo = VIDEO_EXTENSIONS.some(ext =>
    pathname.toLowerCase().endsWith(ext)
  );
  return isVideo ? config.videoMaxSize : config.maxSize;
}
