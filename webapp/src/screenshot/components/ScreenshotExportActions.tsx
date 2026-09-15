/**
 * Header actions: Copy image, Download (PNG / PDF). Rendered by the
 * editor inside ScreenshotHeader once the source image is decoded.
 */
import { useState } from 'react';
import { LuCopy, LuDownload } from 'react-icons/lu';
import { Button, Dropdown, type DropdownOption } from '@shared/components';
import { useToast } from '../../components/Toast';
import { captureError } from '../../lib/sentry';
import { trackScreenshotExported } from '../../analytics';
import { useScreenshotStore } from '../store/useScreenshotStore';
import { useScreenshotMetaStore } from '../store/useScreenshotMetaStore';
import { clipboardImageSupported, copyImageToClipboard, downloadPdf, downloadPng } from '../export/exportScreenshot';

type DownloadFormat = 'png' | 'pdf';

const DOWNLOAD_OPTIONS: DropdownOption<DownloadFormat | ''>[] = [
    { value: 'png', label: 'PNG image' },
    { value: 'pdf', label: 'PDF document' },
];

export function ScreenshotExportActions({ image }: { image: HTMLImageElement }) {
    const { addToast } = useToast();
    const [busy, setBusy] = useState<'copy' | DownloadFormat | null>(null);
    const canCopy = clipboardImageSupported();

    const run = async (kind: 'copy' | DownloadFormat) => {
        const doc = useScreenshotStore.getState().doc;
        const name = useScreenshotStore.getState().name;
        const meta = useScreenshotMetaStore.getState().meta;
        if (!doc || busy) return;
        setBusy(kind);
        try {
            if (kind === 'copy') {
                await copyImageToClipboard(image, doc);
                addToast({ type: 'success', title: 'Image copied to clipboard' });
            } else if (kind === 'png') {
                await downloadPng(image, doc, name);
            } else {
                await downloadPdf(image, doc, name);
            }
            trackScreenshotExported({ format: kind, screenshot_id: meta?.id ?? doc.id, success: true });
        } catch (err) {
            captureError(err, { flow: 'screenshot_export', phase: kind, extra: { screenshotId: doc.id } });
            trackScreenshotExported({
                format: kind, screenshot_id: meta?.id ?? doc.id, success: false,
                error: err instanceof Error ? err.message : 'export failed',
            });
            addToast({
                type: 'error',
                title: kind === 'copy' ? 'Could not copy the image' : `Could not export the ${kind.toUpperCase()}`,
                message: kind === 'copy' ? 'Try "Download" → PNG instead.' : undefined,
            });
        } finally {
            setBusy(null);
        }
    };

    return (
        <>
            {canCopy && (
                <Button variant="ghost" icon={LuCopy} onClick={() => void run('copy')} disabled={busy !== null} title="Copy image to clipboard">
                    {busy === 'copy' ? 'Copying…' : 'Copy'}
                </Button>
            )}
            <Dropdown<DownloadFormat | ''>
                options={DOWNLOAD_OPTIONS}
                value=""
                placeholder={busy === 'png' || busy === 'pdf' ? 'Exporting…' : 'Download'}
                onChange={format => { if (format) void run(format); }}
                fullWidth={false}
                ariaLabel="Download"
                disabled={busy !== null}
                suffix={<LuDownload className="icon-sm text-text-muted" />}
            />
        </>
    );
}
