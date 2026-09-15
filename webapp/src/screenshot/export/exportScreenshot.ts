/**
 * Client-side export of a screenshot (plans/screenshots Step 9): the
 * rendered view (crop + annotations, via renderToCanvas) as a clipboard
 * image, a PNG download or a PDF sized to the image.
 */
import type { ScreenshotDoc } from '@shared/types/screenshot';
import { renderToCanvas } from '../render/renderScreenshot';

/** jsPDF refuses pages above 14400 pt; at 0.75 pt/px that is 19200 px. */
const PDF_MAX_PAGE_PX = 19200;

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
