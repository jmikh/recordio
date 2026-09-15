/**
 * Client-side export of a screenshot (plans/screenshots Step 9): the
 * rendered view (crop + annotations, via renderToCanvas) as a clipboard
 * image, a PNG download, a PDF sized to the image, or a PDF split into
 * A4 pages.
 */
import type { ScreenshotDoc } from '@shared/types/screenshot';
import { renderToCanvas } from '../render/renderScreenshot';

/** jsPDF refuses pages above 14400 pt; at 0.75 pt/px that is 19200 px. */
const PDF_MAX_PAGE_PX = 19200;

/** Page margin around the image on A4 pages (≈ 10 mm at jsPDF's 96 dpi px). */
const A4_MARGIN_PX = 38;

/** A safe file name from the row name. */
export function exportFileName(name: string, ext: 'png' | 'pdf'): string {
    const base = name.trim().replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, ' ').slice(0, 80) || 'screenshot';
    return `${base}.${ext}`;
}

function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
    return new Promise((resolve, reject) => {
        canvas.toBlob(blob => (blob ? resolve(blob) : reject(new Error('PNG encoding failed'))), 'image/png');
    });
}

export function downloadBlob(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Let the click consume the URL before revoking
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function clipboardImageSupported(): boolean {
    return typeof ClipboardItem !== 'undefined' && !!navigator.clipboard?.write;
}

/**
 * Writes the rendered PNG to the clipboard. The ClipboardItem receives the
 * Blob PROMISE so the write starts inside the user gesture (Safari
 * requires this); rendering happens while the promise is pending.
 */
export async function copyImageToClipboard(image: CanvasImageSource, doc: ScreenshotDoc): Promise<void> {
    if (!clipboardImageSupported()) throw new Error('Clipboard images are not supported in this browser');
    const png = Promise.resolve().then(() => canvasToPngBlob(renderToCanvas(image, doc)));
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
}

export async function downloadPng(image: CanvasImageSource, doc: ScreenshotDoc, name: string): Promise<void> {
    const blob = await canvasToPngBlob(renderToCanvas(image, doc));
    downloadBlob(blob, exportFileName(name, 'png'));
}

/**
 * One PDF page sized to the image (px units). Images taller than the
 * jsPDF ceiling are split into full-width bands, one per page.
 */
export async function downloadPdf(image: CanvasImageSource, doc: ScreenshotDoc, name: string): Promise<void> {
    const canvas = renderToCanvas(image, doc);
    const { jsPDF } = await import('jspdf');
    const { width, height } = canvas;
    const bandHeight = Math.min(height, PDF_MAX_PAGE_PX);
    const pageCount = Math.ceil(height / bandHeight);

    let pdf: InstanceType<typeof jsPDF> | null = null;
    for (let page = 0; page < pageCount; page++) {
        const y = page * bandHeight;
        const h = Math.min(bandHeight, height - y);
        const format: [number, number] = [width, h];
        const orientation = width >= h ? 'landscape' : 'portrait';
        if (!pdf) {
            pdf = new jsPDF({ unit: 'px', format, orientation, hotfixes: ['px_scaling'], compress: true });
        } else {
            pdf.addPage(format, orientation);
        }

        let source: HTMLCanvasElement = canvas;
        if (pageCount > 1) {
            source = document.createElement('canvas');
            source.width = width;
            source.height = h;
            source.getContext('2d')?.drawImage(canvas, 0, y, width, h, 0, 0, width, h);
        }
        pdf.addImage(source, 'PNG', 0, 0, width, h, undefined, 'FAST');
    }
    if (!pdf) return;
    downloadBlob(pdf.output('blob'), exportFileName(name, 'pdf'));
}

/**
 * A4 pages: the image is scaled to the printable width (landscape when
 * the image is wider than tall) and cut into page-height bands, one per
 * page, so a long capture prints as a normal multi-page document.
 */
export async function downloadPdfA4(image: CanvasImageSource, doc: ScreenshotDoc, name: string): Promise<void> {
    const canvas = renderToCanvas(image, doc);
    const { jsPDF } = await import('jspdf');
    const { width, height } = canvas;

    const orientation = width > height ? 'landscape' : 'portrait';
    const pdf = new jsPDF({ unit: 'px', format: 'a4', orientation, hotfixes: ['px_scaling'], compress: true });
    const printable = {
        width: pdf.internal.pageSize.getWidth() - 2 * A4_MARGIN_PX,
        height: pdf.internal.pageSize.getHeight() - 2 * A4_MARGIN_PX,
    };

    // Scale the image to the printable width, then slice it (in source px) into
    // bands that each fill one page's printable height
    const scale = printable.width / width;
    const bandHeight = Math.max(1, Math.floor(printable.height / scale));
    const pageCount = Math.ceil(height / bandHeight);

    for (let i = 0; i < pageCount; i++) {
        if (i > 0) pdf.addPage('a4', orientation);
        const y = i * bandHeight;
        const h = Math.min(bandHeight, height - y);
        const band = document.createElement('canvas');
        band.width = width;
        band.height = h;
        band.getContext('2d')?.drawImage(canvas, 0, y, width, h, 0, 0, width, h);
        pdf.addImage(band, 'PNG', A4_MARGIN_PX, A4_MARGIN_PX, printable.width, h * scale, undefined, 'FAST');
    }
    downloadBlob(pdf.output('blob'), exportFileName(name, 'pdf'));
}
