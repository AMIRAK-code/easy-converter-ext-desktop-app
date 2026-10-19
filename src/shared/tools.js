// The "Tools" ring of the wheel: actions that edit a file rather than change its format.
// `editor` tools open the image editor; the rest run directly.

import { familyOf } from './formats.js';

const OFFICE_ZIP = ['docx', 'xlsx', 'pptx'];

export const TOOLS = {
  crop: { label: 'Crop', icon: 'crop', editor: true, for: (f) => isRaster(f) },
  addbg: { label: 'Add BG', icon: 'background', editor: true, for: (f) => isRaster(f) },
  redact: { label: 'Redact', icon: 'eyeOff', editor: true, for: (f) => isRaster(f) },
  annotate: { label: 'Annotate', icon: 'pen', editor: true, for: (f) => isRaster(f) },
  edit: { label: 'Edit', icon: 'sliders', editor: true, for: (f) => isRaster(f) },
  compress: {
    label: 'Compress', icon: 'compress', suffix: 'Compressed',
    for: (f) => isRaster(f) || f === 'pdf' || ['video', 'audio'].includes(familyOf(f)) || OFFICE_ZIP.includes(f),
  },
  metadata: { label: 'Metadata', icon: 'tag', suffix: 'No Metadata', for: (f) => isRaster(f) || f === 'pdf' },
  rotate: { label: 'Rotate', icon: 'rotate', suffix: 'Rotated', for: (f) => f === 'pdf' || familyOf(f) === 'video' },
  split: { label: 'Split', icon: 'split', for: (f) => f === 'pdf' },
  mute: { label: 'Mute', icon: 'mute', suffix: 'Muted', for: (f) => familyOf(f) === 'video' },
  snapshot: { label: 'Snapshot', icon: 'camera', suffix: 'Snapshot', for: (f) => familyOf(f) === 'video' },
  normalize: { label: 'Normalize', icon: 'wave', suffix: 'Normalized', for: (f) => familyOf(f) === 'audio' },
  merge: { label: 'Merge PDF', icon: 'merge', multi: true, for: (f, canPdf) => canPdf },
};

function isRaster(f) {
  return familyOf(f) === 'image' && f !== 'svg';
}

/**
 * Tool ids for a selection. `canPdf(fmt)` tells whether a format can become a PDF
 * (needed for Merge). Editor tools only work on a single file.
 */
export function toolsFor(formats, { canPdf = () => false, platform = 'desktop' } = {}) {
  const multi = formats.length > 1;
  return Object.entries(TOOLS)
    .filter(([id, t]) => {
      if (t.multi && !multi) return false;
      if (t.editor && multi) return false;
      if (platform === 'extension' && EXTENSION_UNSUPPORTED.has(id)) return false;
      return formats.every((f) => t.for(f, canPdf(f)));
    })
    .map(([id]) => id);
}

// The browser has no ffmpeg or Office: media and Office tools are desktop-only.
const EXTENSION_UNSUPPORTED = new Set(['mute', 'snapshot', 'normalize']);

/** "Holiday.jpg" + "Cropped" -> "Holiday Cropped.jpg" */
export function suffixed(base, suffix) {
  return suffix ? `${base} ${suffix}` : base;
}
