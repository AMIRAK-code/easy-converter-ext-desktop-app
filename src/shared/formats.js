// Format registry shared by the desktop app and the Chrome extension.
// Every format is keyed by its canonical lowercase extension.

export const FORMATS = {
  // Documents
  pdf: { label: 'PDF', family: 'document', mime: 'application/pdf' },
  docx: { label: 'DOCX', family: 'document', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
  doc: { label: 'DOC', family: 'document', mime: 'application/msword' },
  rtf: { label: 'RTF', family: 'document', mime: 'application/rtf' },
  odt: { label: 'ODT', family: 'document', mime: 'application/vnd.oasis.opendocument.text' },
  txt: { label: 'TXT', family: 'document', mime: 'text/plain' },
  md: { label: 'MD', family: 'document', mime: 'text/markdown' },
  html: { label: 'HTML', family: 'document', mime: 'text/html' },
  xps: { label: 'XPS', family: 'document', mime: 'application/vnd.ms-xpsdocument', outputOnly: true },

  // Spreadsheets & data
  xlsx: { label: 'XLSX', family: 'sheet', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
  xls: { label: 'XLS', family: 'sheet', mime: 'application/vnd.ms-excel' },
  xlsm: { label: 'XLSM', family: 'sheet', mime: 'application/vnd.ms-excel.sheet.macroEnabled.12', inputOnly: true },
  xlsb: { label: 'XLSB', family: 'sheet', mime: 'application/vnd.ms-excel.sheet.binary.macroEnabled.12', inputOnly: true },
  ods: { label: 'ODS', family: 'sheet', mime: 'application/vnd.oasis.opendocument.spreadsheet' },
  csv: { label: 'CSV', family: 'sheet', mime: 'text/csv' },
  tsv: { label: 'TSV', family: 'sheet', mime: 'text/tab-separated-values' },
  json: { label: 'JSON', family: 'sheet', mime: 'application/json' },

  // Presentations
  pptx: { label: 'PPTX', family: 'slides', mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' },
  ppt: { label: 'PPT', family: 'slides', mime: 'application/vnd.ms-powerpoint' },
  odp: { label: 'ODP', family: 'slides', mime: 'application/vnd.oasis.opendocument.presentation' },

  // Images
  png: { label: 'PNG', family: 'image', mime: 'image/png' },
  jpg: { label: 'JPG', family: 'image', mime: 'image/jpeg' },
  webp: { label: 'WEBP', family: 'image', mime: 'image/webp' },
  avif: { label: 'AVIF', family: 'image', mime: 'image/avif' },
  heic: { label: 'HEIC', family: 'image', mime: 'image/heic', inputOnly: true },
  tiff: { label: 'TIFF', family: 'image', mime: 'image/tiff' },
  gif: { label: 'GIF', family: 'image', mime: 'image/gif' },
  bmp: { label: 'BMP', family: 'image', mime: 'image/bmp' },
  ico: { label: 'ICO', family: 'image', mime: 'image/x-icon' },
  svg: { label: 'SVG', family: 'image', mime: 'image/svg+xml', inputOnly: true },

  // Video
  mp4: { label: 'MP4', family: 'video', mime: 'video/mp4' },
  mov: { label: 'MOV', family: 'video', mime: 'video/quicktime' },
  webm: { label: 'WEBM', family: 'video', mime: 'video/webm' },
  mkv: { label: 'MKV', family: 'video', mime: 'video/x-matroska' },
  avi: { label: 'AVI', family: 'video', mime: 'video/x-msvideo' },
  wmv: { label: 'WMV', family: 'video', mime: 'video/x-ms-wmv' },

  // Audio
  mp3: { label: 'MP3', family: 'audio', mime: 'audio/mpeg' },
  wav: { label: 'WAV', family: 'audio', mime: 'audio/wav' },
  m4a: { label: 'M4A', family: 'audio', mime: 'audio/mp4' },
  aac: { label: 'AAC', family: 'audio', mime: 'audio/aac' },
  ogg: { label: 'OGG', family: 'audio', mime: 'audio/ogg' },
  flac: { label: 'FLAC', family: 'audio', mime: 'audio/flac' },
  opus: { label: 'OPUS', family: 'audio', mime: 'audio/opus' },
  wma: { label: 'WMA', family: 'audio', mime: 'audio/x-ms-wma' },
};

export const ALIASES = {
  jpeg: 'jpg', jpe: 'jpg', jfif: 'jpg', pjpeg: 'jpg',
  tif: 'tiff', heif: 'heic', hif: 'heic',
  htm: 'html', xhtml: 'html', markdown: 'md', mkd: 'md', text: 'txt', log: 'txt',
  m4v: 'mp4', qt: 'mov', ppsx: 'pptx', pps: 'ppt', oga: 'ogg', weba: 'webm',
};

const MIME_TO_EXT = Object.fromEntries(
  Object.entries(FORMATS).map(([ext, f]) => [f.mime, ext]),
);
Object.assign(MIME_TO_EXT, {
  'image/jpg': 'jpg', 'image/x-ms-bmp': 'bmp', 'image/vnd.microsoft.icon': 'ico',
  'image/heif': 'heic', 'audio/x-wav': 'wav', 'audio/wave': 'wav', 'audio/x-m4a': 'm4a',
  'audio/mp3': 'mp3', 'application/x-pdf': 'pdf', 'text/x-markdown': 'md',
  'application/vnd.ms-excel.sheet.macroenabled.12': 'xlsm',
});

/** Canonical format for a file name, extension or MIME type; null when unknown. */
export function formatOf(nameOrExtOrMime) {
  if (!nameOrExtOrMime) return null;
  const s = String(nameOrExtOrMime).toLowerCase().trim();
  if (s.includes('/') && !s.includes('.') && MIME_TO_EXT[s]) return MIME_TO_EXT[s];
  const ext = s.includes('.') ? s.slice(s.lastIndexOf('.') + 1) : s;
  const canon = ALIASES[ext] || ext;
  return FORMATS[canon] ? canon : null;
}

export function familyOf(fmt) {
  return FORMATS[fmt]?.family ?? null;
}

export function labelOf(fmt) {
  return FORMATS[fmt]?.label ?? String(fmt).toUpperCase();
}

export function mimeOf(fmt) {
  return FORMATS[fmt]?.mime ?? 'application/octet-stream';
}

/**
 * Which target families make sense for a source family. Conversions outside
 * this map are never offered even when the planner could chain a route
 * (e.g. an MP3 "to PDF").
 */
export const FAMILY_TARGETS = {
  document: ['document', 'sheet', 'slides', 'image'],
  sheet: ['sheet', 'document', 'image'],
  slides: ['slides', 'document', 'image', 'video'],
  image: ['image', 'document', 'slides'],
  video: ['video', 'audio'],
  audio: ['audio'],
};

/** Per-format exceptions to FAMILY_TARGETS (extra target formats). */
export const EXTRA_TARGETS = {
  gif: ['mp4', 'webm'],
  mp4: ['gif'], mov: ['gif'], webm: ['gif'], mkv: ['gif'], avi: ['gif'], wmv: ['gif'],
};

export function targetAllowed(src, dst) {
  if (src === dst) return false;
  const sf = familyOf(src), df = familyOf(dst);
  if (!sf || !df || FORMATS[dst].inputOnly) return false;
  if (EXTRA_TARGETS[src]?.includes(dst)) return true;
  // Images only go to PDF / DOCX among documents, and only to PPTX among slides.
  if (sf === 'image' && df === 'document' && !['pdf', 'docx'].includes(dst)) return false;
  if (sf === 'image' && df === 'slides' && dst !== 'pptx') return false;
  // Slides only become video as MP4.
  if (df === 'video' && sf === 'slides' && dst !== 'mp4') return false;
  // A document only becomes a GIF/ICO/etc. via raster pages; keep it to common ones.
  if (sf !== 'image' && df === 'image' && !['png', 'jpg', 'webp', 'tiff'].includes(dst)) return false;
  // Documents/sheets/slides -> slides only as PPTX.
  if (sf !== 'slides' && df === 'slides' && dst !== 'pptx') return false;
  return FAMILY_TARGETS[sf]?.includes(df) ?? false;
}

/** Display order for targets. Earlier = closer to the top of the wheel. */
export const POPULARITY = [
  'pdf', 'docx', 'jpg', 'png', 'xlsx', 'txt', 'pptx', 'webp', 'mp4', 'mp3',
  'csv', 'html', 'md', 'heic', 'avif', 'gif', 'tiff', 'bmp', 'ico', 'json',
  'wav', 'm4a', 'mov', 'webm', 'mkv', 'ogg', 'flac', 'opus', 'aac', 'avi',
  'doc', 'rtf', 'odt', 'xls', 'ods', 'tsv', 'ppt', 'odp', 'xps', 'wmv', 'wma',
];

const POP_INDEX = Object.fromEntries(POPULARITY.map((f, i) => [f, i]));

/** Family-specific favourites shown first, overriding global popularity. */
const FAVOURITES = {
  pdf: ['docx', 'jpg', 'png', 'txt', 'xlsx', 'pptx', 'html'],
  docx: ['pdf', 'txt', 'jpg', 'png', 'html', 'md', 'odt'],
  doc: ['docx', 'pdf', 'txt', 'jpg', 'png', 'html', 'rtf'],
  xlsx: ['pdf', 'docx', 'csv', 'json', 'html', 'png', 'jpg'],
  xls: ['xlsx', 'pdf', 'docx', 'csv', 'json', 'html', 'png'],
  csv: ['xlsx', 'json', 'pdf', 'docx', 'html', 'md', 'tsv'],
  json: ['xlsx', 'csv', 'pdf', 'docx', 'html', 'md', 'tsv'],
  pptx: ['pdf', 'png', 'jpg', 'docx', 'mp4', 'ppt', 'odp'],
  ppt: ['pptx', 'pdf', 'png', 'jpg', 'docx', 'mp4', 'odp'],
  md: ['pdf', 'docx', 'html', 'txt', 'png', 'jpg', 'odt'],
  txt: ['pdf', 'docx', 'html', 'md', 'png', 'jpg', 'odt'],
  html: ['pdf', 'docx', 'md', 'txt', 'png', 'jpg', 'odt'],
  jpg: ['png', 'webp', 'pdf', 'heic', 'avif', 'tiff', 'docx', 'ico', 'bmp', 'gif', 'pptx'],
  png: ['jpg', 'webp', 'pdf', 'ico', 'avif', 'tiff', 'docx', 'bmp', 'gif', 'pptx'],
  heic: ['jpg', 'png', 'webp', 'pdf', 'avif', 'tiff', 'docx'],
  svg: ['png', 'jpg', 'webp', 'pdf', 'ico', 'avif', 'tiff'],
  mp4: ['mp3', 'gif', 'mov', 'webm', 'mkv', 'wav', 'm4a', 'avi'],
  mov: ['mp4', 'mp3', 'gif', 'webm', 'mkv', 'wav', 'm4a'],
  mp3: ['wav', 'm4a', 'ogg', 'flac', 'opus', 'aac'],
  wav: ['mp3', 'm4a', 'flac', 'ogg', 'opus', 'aac'],
};

export function sortTargets(src, targets) {
  const fav = FAVOURITES[src] || [];
  const rank = (f) => {
    const i = fav.indexOf(f);
    return i >= 0 ? i - 1000 : (POP_INDEX[f] ?? 999);
  };
  return [...targets].sort((a, b) => rank(a) - rank(b));
}

/** "Report.final.docx" -> { base: "Report.final", ext: "docx" } */
export function splitName(name) {
  const slash = Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\'));
  const file = name.slice(slash + 1);
  const dot = file.lastIndexOf('.');
  if (dot <= 0) return { base: file, ext: '' };
  return { base: file.slice(0, dot), ext: file.slice(dot + 1) };
}
