/**
 * @fileoverview Capture toast (plans/screenshots).
 *
 * The bottom-centre hint/progress pill shown on the page during region
 * selection and full-page capture. Vanilla DOM (content script), styled
 * like the blur picker's toast so the two read as one system. Callers
 * HIDE it (visibility) right before each captureVisibleTab so it never
 * ends up in the image, and REMOVE it when the session ends.
 */

const STYLE_ID = 'recordio-capture-toast-styles';
const TOAST_ID = 'recordio-capture-toast';

function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
        #${TOAST_ID} {
            all: initial;
            position: fixed;
            bottom: 24px;
            left: 50%;
            transform: translateX(-50%);
            background-color: oklch(0.22 0.025 290);
            color: oklch(0.98 0 0 / 80%);
            padding: 10px 18px;
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
            z-index: 2147483647 !important;
            font-family: system-ui, -apple-system, sans-serif;
            font-size: 13px;
            line-height: 1.3;
            display: flex;
            align-items: center;
            gap: 12px;
            border: 1px solid oklch(0.32 0.015 290);
            animation: recordio-capture-toast-in 0.2s ease-out;
            box-sizing: border-box;
            pointer-events: none;
            user-select: none;
            white-space: nowrap;
        }
        #${TOAST_ID} kbd {
            all: initial;
            visibility: inherit; /* all:initial resets to visible — must follow the parent's hide */
            font-family: system-ui, -apple-system, sans-serif;
            font-size: 11px;
            color: oklch(0.98 0 0 / 90%);
            background: oklch(0.32 0.015 290);
            border-radius: 4px;
            padding: 2px 6px;
        }
        @keyframes recordio-capture-toast-in {
            from { opacity: 0; transform: translate(-50%, 10px); }
            to   { opacity: 1; transform: translate(-50%, 0); }
        }
    `;
    document.head.appendChild(style);
}

export interface CaptureToast {
    el: HTMLElement;
    /** Plain text; `[Esc]`-style tokens become <kbd> chips */
    setText(text: string): void;
    setVisible(visible: boolean): void;
    remove(): void;
}

export function createCaptureToast(text: string): CaptureToast {
    injectStyles();
    document.getElementById(TOAST_ID)?.remove();

    const el = document.createElement('div');
    el.id = TOAST_ID;
    el.setAttribute('data-recordio', 'capture-toast');
    el.setAttribute('role', 'status');
    document.body.appendChild(el);

    const toast: CaptureToast = {
        el,
        setText(next) {
            el.replaceChildren();
            const parts = next.split(/(\[[^\]]+\])/);
            for (const part of parts) {
                if (!part) continue;
                const kbd = part.match(/^\[([^\]]+)\]$/);
                if (kbd) {
                    const chip = document.createElement('kbd');
                    chip.textContent = kbd[1];
                    el.appendChild(chip);
                } else {
                    el.appendChild(document.createTextNode(part));
                }
            }
        },
        // display, not visibility: nothing inside can override it before a capture
        setVisible(visible) {
            el.style.display = visible ? '' : 'none';
        },
        remove() {
            el.remove();
        },
    };
    toast.setText(text);
    return toast;
}
