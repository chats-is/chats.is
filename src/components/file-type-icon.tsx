import {
  FileBraces,
  FileHeadphone,
  FileIcon,
  FilePlay,
  FileSpreadsheet,
  FileText
} from 'lucide-react';

import { DOCUMENT_MEDIA_TYPES } from '@/lib/constant';

/** The icon a file is shown by, from its type. A poster frame or a waveform
 *  would need the file decoded; the icon says what it is. */
function iconFor(contentType = '') {
  if (contentType.startsWith('audio/')) return FileHeadphone;
  if (contentType.startsWith('video/')) return FilePlay;
  switch (contentType) {
    case DOCUMENT_MEDIA_TYPES.csv:
    case DOCUMENT_MEDIA_TYPES.xlsx:
    case DOCUMENT_MEDIA_TYPES.xls:
      return FileSpreadsheet;
    case DOCUMENT_MEDIA_TYPES.json:
      return FileBraces;
    case DOCUMENT_MEDIA_TYPES.pdf:
    case DOCUMENT_MEDIA_TYPES.docx:
    case DOCUMENT_MEDIA_TYPES.txt:
    case DOCUMENT_MEDIA_TYPES.md:
      return FileText;
    default:
      return FileIcon;
  }
}

export function FileTypeIcon({
  contentType,
  className
}: {
  contentType?: string;
  className?: string;
}) {
  const Icon = iconFor(contentType);
  return <Icon className={className} />;
}
