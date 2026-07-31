/**
 * Turns a rendered slip into a file — a PNG or a one-page PDF.
 *
 * "Save as PDF" in the browser print dialog is at the mercy of whatever paper
 * size the dialog happens to be set to, so the file a cashier ends up with can
 * be an 80mm column stranded on an A4 sheet. Both exports here fix the page to
 * the roll width, so nothing can reflow the slip: that is what makes them safe
 * to send a customer.
 *
 * The slip is drawn by wrapping the live DOM node in an SVG <foreignObject> and
 * painting that onto a canvas. No library, no network — the app has to keep
 * working with the cable pulled out, and every asset on the slip (the logo) is
 * already a data URL.
 */

/** CSS resolves mm against a fixed 96dpi, so this conversion is exact. */
const PX_PER_MM = 96 / 25.4;

/**
 * Reads the receipt rules straight out of the app's own stylesheet.
 *
 * Copying the rules into this file would mean two sources of truth that drift
 * apart the first time a padding changes, so instead we ask the document what
 * `.receipt` currently looks like. Only top-level style rules are collected —
 * the `@media print` overrides live inside a CSSMediaRule and are skipped,
 * which is what we want: the export is the screen slip, not the printed one.
 */
function collectReceiptCss(): string {
  const parts = [
    // Tailwind's preflight is not present inside the foreignObject, and the
    // receipt's mm widths assume border-box.
    '*,*::before,*::after{box-sizing:border-box}',
    'div,span,table,thead,tbody,tr,td,th,img,hr{margin:0;padding:0}',
    'table{border-collapse:collapse;border-spacing:0}',
    'img{display:block;max-width:100%}',
  ];

  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      // A cross-origin sheet. Nothing of ours lives in one.
      continue;
    }
    for (const rule of Array.from(rules)) {
      if (rule instanceof CSSStyleRule && rule.selectorText.includes('.receipt')) {
        parts.push(rule.cssText);
      }
    }
  }

  return parts.join('\n');
}

/** True if the canvas came back as nothing but white — see renderSlipToPng. */
function isBlank(ctx: CanvasRenderingContext2D, w: number, h: number): boolean {
  const band = ctx.getImageData(0, Math.floor(h * 0.1), w, Math.max(1, Math.floor(h * 0.6))).data;
  for (let i = 0; i < band.length; i += 4) {
    if (band[i] < 240 || band[i + 1] < 240 || band[i + 2] < 240) return false;
  }
  return true;
}

export interface SlipImage {
  blob: Blob;
  width: number;
  height: number;
}

/** Paints the slip at exactly `widthMm`, `scale` device pixels per CSS pixel. */
async function renderSlipToCanvas(
  node: HTMLElement,
  widthMm: 58 | 80,
  scale: number,
): Promise<HTMLCanvasElement> {
  const cssWidth = Math.round(widthMm * PX_PER_MM);
  // A few pixels of slack: the slip re-lays-out inside the SVG and a fractional
  // line-height difference must not shave the footer off. Spare rows come out
  // white and are invisible on the saved image.
  const cssHeight = Math.ceil(node.getBoundingClientRect().height) + 8;

  const clone = node.cloneNode(true) as HTMLElement;
  clone.style.width = `${widthMm}mm`;
  clone.style.margin = '0';
  clone.style.boxShadow = 'none';

  const markup = new XMLSerializer().serializeToString(clone);
  const css = collectReceiptCss();

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${cssWidth * scale}" height="${cssHeight * scale}" ` +
    `viewBox="0 0 ${cssWidth} ${cssHeight}">` +
    `<foreignObject x="0" y="0" width="${cssWidth}" height="${cssHeight}">` +
    `<div xmlns="http://www.w3.org/1999/xhtml" style="width:${cssWidth}px;background:#fff">` +
    `<style><![CDATA[${css}]]></style>${markup}` +
    `</div></foreignObject></svg>`;

  const img = new Image();
  img.decoding = 'sync';
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('The slip could not be drawn in this browser.'));
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  });

  const canvas = document.createElement('canvas');
  canvas.width = cssWidth * scale;
  canvas.height = cssHeight * scale;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('The slip could not be drawn in this browser.');

  // Thermal paper is white and the receipt sets no background of its own on
  // every element, so the sheet is painted first.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  // Some Safari builds load the SVG happily and then draw nothing at all.
  // Better to fail loudly and send the cashier to the print dialog than to
  // hand them a blank slip.
  if (isBlank(ctx, canvas.width, canvas.height)) {
    throw new Error('This browser cannot export the slip. Use Print instead.');
  }

  return canvas;
}

/**
 * @param node    the element carrying `.receipt-58` / `.receipt-80`
 * @param widthMm paper width, so the image is exactly one roll wide
 * @param scale   device pixels per CSS pixel; 3 keeps 10px monospace crisp
 */
export async function renderSlipToPng(
  node: HTMLElement,
  widthMm: 58 | 80,
  scale = 3,
): Promise<SlipImage> {
  const canvas = await renderSlipToCanvas(node, widthMm, scale);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('The image could not be saved.');
  return { blob, width: canvas.width, height: canvas.height };
}

/* ---------------------------------------------------------------------------
   PDF
   The browser's own "Save as PDF" is at the mercy of the print dialog's paper
   size, which is how an 80mm slip ends up stranded on an A4 sheet. So the PDF
   is written here instead: one page, sized to the roll in points, holding the
   slip as a single image. Nothing about the page can reflow, so the file looks
   the same everywhere it is opened — including in WhatsApp's viewer.

   It is assembled by hand rather than with a PDF library: the app must work
   offline and a renderer is a large dependency for one page of one image.
--------------------------------------------------------------------------- */

const PT_PER_MM = 72 / 25.4;

/**
 * A byte array backed by a plain ArrayBuffer. `Uint8Array` on its own is generic
 * over `ArrayBufferLike`, which `BlobPart` will not accept.
 */
type Bytes = Uint8Array<ArrayBuffer>;

function ascii(s: string): Bytes {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
}

/** zlib-wrapped deflate, which is exactly what PDF's /FlateDecode expects. */
async function deflate(bytes: Bytes): Promise<Bytes> {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

interface EmbeddedImage {
  data: Bytes;
  /** FlateDecode for lossless RGB, DCTDecode when the bytes are already JPEG. */
  filter: 'FlateDecode' | 'DCTDecode';
  width: number;
  height: number;
}

async function encodeForPdf(canvas: HTMLCanvasElement): Promise<EmbeddedImage> {
  const { width, height } = canvas;

  // Lossless is worth it: JPEG rings around thin monospace glyphs, and a
  // receipt is mostly flat white, which deflate compresses to very little.
  if (typeof CompressionStream !== 'undefined') {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('The slip could not be read back.');
    const rgba = ctx.getImageData(0, 0, width, height).data;
    // PDF images carry no alpha channel of their own, and the canvas is opaque.
    const rgb = new Uint8Array(width * height * 3);
    for (let i = 0, j = 0; i < rgba.length; i += 4, j += 3) {
      rgb[j] = rgba[i];
      rgb[j + 1] = rgba[i + 1];
      rgb[j + 2] = rgba[i + 2];
    }
    return { data: await deflate(rgb), filter: 'FlateDecode', width, height };
  }

  // Older Safari has no CompressionStream. JPEG keeps the file sane.
  const jpeg = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.95));
  if (!jpeg) throw new Error('The PDF could not be created.');
  return {
    data: new Uint8Array(await jpeg.arrayBuffer()),
    filter: 'DCTDecode',
    width,
    height,
  };
}

/** A one-page PDF, the page being the slip and nothing else. */
export async function renderSlipToPdf(
  node: HTMLElement,
  widthMm: 58 | 80,
  scale = 3,
): Promise<Blob> {
  const canvas = await renderSlipToCanvas(node, widthMm, scale);
  const img = await encodeForPdf(canvas);

  // The page is the paper: as wide as the roll, as tall as the slip came out.
  const pageW = widthMm * PT_PER_MM;
  const pageH = (pageW * img.height) / img.width;
  const w = pageW.toFixed(2);
  const h = pageH.toFixed(2);

  const chunks: Bytes[] = [];
  const offsets: number[] = [];
  let length = 0;

  const push = (part: Bytes) => {
    chunks.push(part);
    length += part.length;
  };

  const obj = (n: number, dict: string, stream?: Bytes) => {
    offsets[n] = length;
    push(ascii(`${n} 0 obj\n${dict}\n`));
    if (stream) {
      push(ascii('stream\n'));
      push(stream);
      push(ascii('\nendstream\n'));
    }
    push(ascii('endobj\n'));
  };

  // The binary comment on line 2 is what tells tools this file is not text.
  push(ascii('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n'));

  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  obj(
    3,
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] ` +
      `/Resources << /XObject << /Im0 5 0 R >> >> /Contents 4 0 R >>`,
  );

  // Scale the unit image up to fill the page exactly — no margin to trim.
  const content = ascii(`q ${w} 0 0 ${h} 0 0 cm /Im0 Do Q\n`);
  obj(4, `<< /Length ${content.length} >>`, content);

  obj(
    5,
    `<< /Type /XObject /Subtype /Image /Width ${img.width} /Height ${img.height} ` +
      `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /${img.filter} ` +
      `/Length ${img.data.length} >>`,
    img.data,
  );

  const startxref = length;
  let table = 'xref\n0 6\n0000000000 65535 f \n';
  for (let n = 1; n <= 5; n++) table += `${String(offsets[n]).padStart(10, '0')} 00000 n \n`;
  table += `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${startxref}\n%%EOF\n`;
  push(ascii(table));

  return new Blob(chunks, { type: 'application/pdf' });
}

/**
 * Bill numbers are commonly written INV/2026/0007, and a slash in a download
 * name is silently dropped or turned into a folder by some browsers.
 */
function safeName(name: string, ext: 'png' | 'pdf'): string {
  const base = name
    .replace(/\.(png|pdf)$/i, '')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `${base || 'slip'}.${ext}`;
}

function saveBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoked well after the click — Safari cancels the download if it goes early.
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Saves the slip as a picture. */
export async function downloadSlipImage(node: HTMLElement, widthMm: 58 | 80, fileName: string) {
  const { blob } = await renderSlipToPng(node, widthMm);
  saveBlob(blob, safeName(fileName, 'png'));
}

/** Saves the slip as a one-page PDF the width of the roll. */
export async function downloadSlipPdf(node: HTMLElement, widthMm: 58 | 80, fileName: string) {
  saveBlob(await renderSlipToPdf(node, widthMm), safeName(fileName, 'pdf'));
}

/** Whether this device can hand a file to WhatsApp and friends directly. */
export function canShareFiles(type = 'image/png'): boolean {
  if (typeof navigator === 'undefined' || !navigator.canShare) return false;
  try {
    const probe = new File([new Blob([''], { type })], `p.${type === 'application/pdf' ? 'pdf' : 'png'}`, {
      type,
    });
    return navigator.canShare({ files: [probe] });
  } catch {
    return false;
  }
}

/** Whether the slip can be put on the clipboard as a picture. */
export function canCopyImage(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    Boolean(navigator.clipboard?.write) &&
    typeof ClipboardItem !== 'undefined'
  );
}

/**
 * Copies the slip to the clipboard as a PNG.
 *
 * This is the desktop route to WhatsApp: `wa.me` links carry text and nothing
 * else, so the way to get a picture into a chat is to paste it there.
 */
export async function copySlipImageToClipboard(node: HTMLElement, widthMm: 58 | 80) {
  if (!canCopyImage()) throw new Error('This browser cannot copy images. Use Save image instead.');

  const render = renderSlipToPng(node, widthMm).then((r) => r.blob);

  try {
    // Safari only allows a clipboard write inside the click that triggered it,
    // so the unresolved promise is handed over rather than awaited first.
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': render })]);
  } catch {
    // Browsers that reject a promised blob take a settled one.
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': await render })]);
  }
}

/** Opens the OS share sheet with the slip attached as a PDF. */
export async function shareSlipPdf(
  node: HTMLElement,
  widthMm: 58 | 80,
  fileName: string,
  title: string,
) {
  const blob = await renderSlipToPdf(node, widthMm);
  const file = new File([blob], safeName(fileName, 'pdf'), { type: 'application/pdf' });
  await navigator.share({ files: [file], title });
}

/** Opens the OS share sheet with the slip attached as a picture. */
export async function shareSlipImage(
  node: HTMLElement,
  widthMm: 58 | 80,
  fileName: string,
  title: string,
) {
  const { blob } = await renderSlipToPng(node, widthMm);
  const file = new File([blob], safeName(fileName, 'png'), { type: 'image/png' });
  await navigator.share({ files: [file], title });
}
