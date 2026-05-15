/**
 * @fileoverview Countdown Overlay
 *
 * Vanilla DOM translation of the React CountdownOverlay design.
 * Class structure and CSS mirror the React component exactly so the visual
 * output is identical. React can't be used here because this runs as a content
 * script injected into arbitrary host pages.
 *
 * Sound is sent to the offscreen document (already open during countdown)
 * to avoid content-script autoplay restrictions.
 */

import { MSG_TYPES } from '../shared/messageTypes';

const COUNTDOWN_START = 3;
const CIRCUMFERENCE = 2 * Math.PI * 72; // r=72 inside 160×160 viewBox — matches React component

// ── Styles (injected once per page) ───────────────────────────────────────

const STYLE_ID = 'recordio-countdown-styles';

function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
        /* ── Root ──────────────────────────────────────────────────────── */
        .recordio-countdown {
            position: fixed;
            inset: 0;
            z-index: 2147483647;
            display: flex;
            align-items: center;
            justify-content: center;
            font-family: system-ui, -apple-system, sans-serif;
            animation: recordio-enter 0.2s ease-out forwards;
            pointer-events: none;
        }
        .recordio-countdown--exiting {
            animation: recordio-exit 0.25s ease-in forwards !important;
        }
        @keyframes recordio-enter {
            from { opacity: 0; transform: scale(0.96); }
            to   { opacity: 1; transform: scale(1); }
        }
        @keyframes recordio-exit {
            from { opacity: 1; transform: scale(1); }
            to   { opacity: 0; transform: scale(0.94); }
        }

        /* ── Backdrop ───────────────────────────────────────────────────── */
        .recordio-countdown__backdrop {
            position: absolute;
            inset: 0;
            background: oklch(0 0 0 / 55%);
            backdrop-filter: blur(2px);
            pointer-events: none;
        }

        /* ── Center column ──────────────────────────────────────────────── */
        .recordio-countdown__center {
            position: relative;
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 16px;
            pointer-events: auto;
        }

        /* ── Disc ───────────────────────────────────────────────────────── */
        .recordio-countdown__disc {
            position: relative;
            width: 160px;
            height: 160px;
            border-radius: 50%;
            background: oklch(0.22 0.025 290);
            border: 1px solid oklch(0.32 0.015 290);
            box-shadow:
                0 0 0 1px oklch(0.62 0.22 290 / 20%),
                0 24px 48px oklch(0 0 0 / 55%),
                0 8px 16px oklch(0 0 0 / 35%),
                inset 0 1px 0 oklch(1 0 0 / 6%);
        }

        /* ── SVG ring ───────────────────────────────────────────────────── */
        .recordio-countdown__ring {
            position: absolute;
            inset: 0;
            width: 100%;
            height: 100%;
            overflow: visible;
        }
        .recordio-countdown__ring-track {
            fill: none;
            stroke: oklch(0.62 0.22 290 / 14%);
            stroke-width: 4;
        }
        .recordio-countdown__ring-progress {
            fill: none;
            stroke: oklch(0.62 0.22 290);
            stroke-width: 4;
            stroke-linecap: round;
            stroke-dasharray: ${CIRCUMFERENCE};
            stroke-dashoffset: 0;
            transform: rotate(-90deg);
            transform-box: fill-box;
            transform-origin: center;
        }
        @keyframes recordio-ring-drain {
            from { stroke-dashoffset: 0; }
            to   { stroke-dashoffset: ${CIRCUMFERENCE}; }
        }

        /* ── Number ─────────────────────────────────────────────────────── */
        .recordio-countdown__number {
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            font-size: 72px;
            font-weight: 700;
            color: oklch(0.95 0 0);
            line-height: 1;
            text-align: center;
            font-variant-numeric: tabular-nums;
            user-select: none;
            pointer-events: none;
            animation: recordio-number-pop 0.4s cubic-bezier(0.2, 0.9, 0.2, 1);
        }
        @keyframes recordio-number-pop {
            0%   { transform: translate(-50%, -50%) scale(1.18); opacity: 0.5; }
            100% { transform: translate(-50%, -50%) scale(1);    opacity: 1; }
        }

        /* ── Label ──────────────────────────────────────────────────────── */
        .recordio-countdown__label {
            font-size: 13px;
            font-weight: 500;
            color: oklch(0.95 0 0 / 65%);
            letter-spacing: 0.02em;
            text-align: center;
            user-select: none;
        }

        /* ── Cancel button ──────────────────────────────────────────────── */
        .recordio-countdown__cancel {
            height: 32px;
            padding: 0 18px;
            border-radius: 8px;
            background: transparent;
            border: 1px solid oklch(0.32 0.015 290);
            color: oklch(0.95 0 0 / 55%);
            font-size: 12px;
            font-weight: 500;
            font-family: inherit;
            cursor: pointer;
            transition: background 0.15s, color 0.15s, border-color 0.15s;
        }
        .recordio-countdown__cancel:hover {
            background: oklch(0.95 0 0 / 8%);
            color: oklch(0.95 0 0);
            border-color: oklch(0.42 0.01 290);
        }

        /* ── Reduced motion ─────────────────────────────────────────────── */
        @media (prefers-reduced-motion: reduce) {
            .recordio-countdown,
            .recordio-countdown--exiting,
            .recordio-countdown__number {
                animation: none !important;
            }
            .recordio-countdown__ring-progress {
                transition: none !important;
            }
        }
    `;
    document.head.appendChild(style);
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Show the countdown overlay.
 *
 * @param onComplete  Called when the countdown reaches 0 (recording should start).
 * @param onCancel    Called when the user cancels (Cancel button or Escape key).
 * @returns           A cleanup function that removes the overlay and stops timers.
 */
export function showCountdown(
    onComplete: () => void,
    onCancel: () => void,
): () => void {
    injectStyles();

    let count = COUNTDOWN_START;
    let intervalId: ReturnType<typeof setInterval> | null = null;
    let removed = false;
    let exiting = false;

    // ── Build DOM ──────────────────────────────────────────────────────────

    // Root
    const root = document.createElement('div');
    root.className = 'recordio-countdown';
    root.setAttribute('data-recordio-countdown', 'true');

    // Backdrop
    const backdrop = document.createElement('div');
    backdrop.className = 'recordio-countdown__backdrop';
    root.appendChild(backdrop);

    // Center column
    const center = document.createElement('div');
    center.className = 'recordio-countdown__center';

    // Disc
    const disc = document.createElement('div');
    disc.className = 'recordio-countdown__disc';

    // SVG ring
    const SVG_NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', 'recordio-countdown__ring');
    svg.setAttribute('viewBox', '0 0 160 160');
    svg.setAttribute('aria-hidden', 'true');

    const trackCircle = document.createElementNS(SVG_NS, 'circle');
    trackCircle.setAttribute('class', 'recordio-countdown__ring-track');
    trackCircle.setAttribute('cx', '80');
    trackCircle.setAttribute('cy', '80');
    trackCircle.setAttribute('r', '72');

    const progressCircle = document.createElementNS(SVG_NS, 'circle');
    progressCircle.setAttribute('class', 'recordio-countdown__ring-progress');
    progressCircle.setAttribute('cx', '80');
    progressCircle.setAttribute('cy', '80');
    progressCircle.setAttribute('r', '72');

    svg.appendChild(trackCircle);
    svg.appendChild(progressCircle);
    disc.appendChild(svg);

    // Number
    const numberEl = document.createElement('div');
    numberEl.className = 'recordio-countdown__number';
    numberEl.setAttribute('aria-live', 'polite');
    numberEl.textContent = String(count);
    disc.appendChild(numberEl);

    center.appendChild(disc);

    // Label
    const label = document.createElement('div');
    label.className = 'recordio-countdown__label';
    label.textContent = 'Recording starts';
    center.appendChild(label);

    // Cancel button
    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'recordio-countdown__cancel';
    cancelBtn.textContent = 'Cancel';
    center.appendChild(cancelBtn);

    root.appendChild(center);
    document.body.appendChild(root);

    // Start the ring drain animation after the element is in the rendering tree.
    // Applying it via rAF (not via CSS class) avoids a race where the browser
    // hasn't resolved the injected stylesheet by the time the element first paints.
    requestAnimationFrame(() => {
        progressCircle.style.animation = `recordio-ring-drain ${COUNTDOWN_START}s linear forwards`;
    });

    // ── Number animation ───────────────────────────────────────────────────
    // Vanilla equivalent of key={count}: remove + re-add the animation class to
    // force a restart via reflow, same effect as React remounting the element.

    function animateNumber() {
        numberEl.style.animation = 'none';
        void numberEl.offsetWidth; // force reflow
        numberEl.style.animation = '';
    }

    // ── Exit ───────────────────────────────────────────────────────────────

    function triggerExit(callback: () => void) {
        if (exiting) return;
        exiting = true;
        root.classList.add('recordio-countdown--exiting');
        setTimeout(() => {
            cleanup();
            callback();
        }, 250);
    }

    // ── Cleanup ────────────────────────────────────────────────────────────

    function cleanup() {
        if (removed) return;
        removed = true;
        if (intervalId !== null) { clearInterval(intervalId); intervalId = null; }
        document.removeEventListener('keydown', handleKeyDown, true);
        if (root.parentNode) root.parentNode.removeChild(root);
    }

    // ── Event handlers ─────────────────────────────────────────────────────

    cancelBtn.addEventListener('click', () => triggerExit(onCancel));

    const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            triggerExit(onCancel);
        }
    };
    document.addEventListener('keydown', handleKeyDown, true);

    // ── Countdown timer ────────────────────────────────────────────────────

    intervalId = setInterval(() => {
        count -= 1;

        // Show 0 before finishing — counts 3, 2, 1, 0 then exits.
        numberEl.textContent = String(count);
        animateNumber();
        if (count === 1) {
            setTimeout(() => {
                chrome.runtime.sendMessage({ type: MSG_TYPES.CONTENT_PLAY_COUNTDOWN_SOUND }).catch(() => {});
            }, 500);
        }

        if (count <= 0) {
            if (intervalId !== null) { clearInterval(intervalId); intervalId = null; }
            if (!exiting) {
                exiting = true;
                root.classList.add('recordio-countdown--exiting');
            }
            cleanup();
            onComplete();
        }
    }, 1000);

    return cleanup;
}
