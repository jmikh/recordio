
/**
 * @fileoverview Manages the DOM element blurring feature.
 * 
 * Allows users to hover and click elements to blur them before recording.
 * Blurs are persistent (until page reload) but the interaction mode can be toggled.
 */

export class BlurManager {
    private isEnabled = false;
    private toast: HTMLElement | null = null;
    private highlightedElement: HTMLElement | null = null;


    constructor() {
        this.handleMouseOver = this.handleMouseOver.bind(this);
        this.handleMouseOut = this.handleMouseOut.bind(this);
        this.handleClick = this.handleClick.bind(this);
        this.handleToastClick = this.handleToastClick.bind(this);
    }

    public enable() {
        if (this.isEnabled) return;
        this.isEnabled = true;

        this.injectStyles();
        this.createToast();
        this.addEventListeners();
        document.body.style.cursor = 'crosshair';
    }

    public disable() {
        if (!this.isEnabled) return;
        this.isEnabled = false;

        this.removeToast();
        this.removeEventListeners();

        // Remove highlight if exists
        if (this.highlightedElement) {
            this.highlightedElement.classList.remove('recordo-highlight');
            this.highlightedElement = null;
        }
        document.body.style.cursor = '';
    }

    private injectStyles() {
        if (document.getElementById('recordo-blur-styles')) return;

        const style = document.createElement('style');
        style.id = 'recordo-blur-styles';
        style.textContent = `
            .recordo-blur {
                filter: blur(8px) !important;
                user-select: none;
            }
            .recordo-highlight {
                box-shadow: 0 0 0 2px #FF4081, inset 0 0 0 2px rgba(255, 64, 129, 0.2) !important;
                background-color: rgba(255, 64, 129, 0.1) !important;
                cursor: crosshair !important;
                z-index: 10000;
                border-radius: 2px;
            }
            .recordo-blur {
                filter: blur(8px) !important;
                user-select: none;
                pointer-events: auto !important;
                z-index: 10001;
            }
            #recordo-blur-toast {
                position: fixed;
                bottom: 24px;
                left: 50%;
                transform: translateX(-50%);
                background-color: #0F172A;
                color: white;
                padding: 12px 24px;
                border-radius: 8px;
                box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
                z-index: 2147483647; /* Max z-index */
                font-family: system-ui, -apple-system, sans-serif;
                display: flex;
                align-items: center;
                gap: 16px;
                border: 1px solid #334155;
                animation: recordo-fade-in 0.2s ease-out;
            }
            #recordo-blur-toast button {
                background-color: #3B82F6;
                color: white;
                border: none;
                padding: 6px 12px;
                border-radius: 4px;
                font-weight: 500;
                cursor: pointer;
                font-size: 14px;
            }
            #recordo-blur-toast button:hover {
                background-color: #2563EB;
            }
            @keyframes recordo-fade-in {
                from { opacity: 0; transform: translate(-50%, 10px); }
                to { opacity: 1; transform: translate(-50%, 0); }
            }
        `;
        document.head.appendChild(style);
    }

    private createToast() {
        if (this.toast) return;

        this.toast = document.createElement('div');
        this.toast.id = 'recordo-blur-toast';

        const message = document.createElement('span');
        message.textContent = 'Hover and click elements to blur them.';
        message.style.fontSize = '14px';
        message.style.color = '#E2E8F0';

        const doneBtn = document.createElement('button');
        doneBtn.textContent = 'Done';
        doneBtn.addEventListener('click', this.handleToastClick);

        this.toast.appendChild(message);
        this.toast.appendChild(doneBtn);
        document.body.appendChild(this.toast);
    }

    private removeToast() {
        if (this.toast) {
            this.toast.remove();
            this.toast = null;
        }
    }

    private addEventListeners() {
        document.addEventListener('mouseover', this.handleMouseOver, true);
        document.addEventListener('mouseout', this.handleMouseOut, true);
        document.addEventListener('click', this.handleClick, true);
    }

    private removeEventListeners() {
        document.removeEventListener('mouseover', this.handleMouseOver, true);
        document.removeEventListener('mouseout', this.handleMouseOut, true);
        document.removeEventListener('click', this.handleClick, true);
    }

    private handleMouseOver(e: MouseEvent) {
        const target = e.target as HTMLElement;
        // Ignore our own UI
        if (this.toast && (this.toast === target || this.toast.contains(target))) return;

        // Remove prev highlight
        if (this.highlightedElement && this.highlightedElement !== target) {
            this.highlightedElement.classList.remove('recordo-highlight');
        }

        // Check if target is inside a blurred element
        if (target.closest('.recordo-blur') && !target.classList.contains('recordo-blur')) {
            return;
        }

        this.highlightedElement = target;
        this.highlightedElement.classList.add('recordo-highlight');
    }

    private handleMouseOut(e: MouseEvent) {
        const target = e.target as HTMLElement;
        if (target === this.highlightedElement) {
            target.classList.remove('recordo-highlight');
            this.highlightedElement = null;
        }
    }

    private handleClick(e: MouseEvent) {
        const target = e.target as HTMLElement;

        // Allow clicking our own UI
        if (this.toast && (this.toast === target || this.toast.contains(target))) return;

        e.preventDefault();
        e.stopPropagation();

        if (target.classList.contains('recordo-blur')) {
            target.classList.remove('recordo-blur');
            return;
        }

        // Check if we are clicking something inside a blurred element (shouldn't happen with pointer-events fix, but safe to check)
        const closestBlurred = target.closest('.recordo-blur');
        if (closestBlurred) {
            closestBlurred.classList.remove('recordo-blur');
            return;
        }

        target.classList.add('recordo-blur');
        target.classList.remove('recordo-highlight'); // Remove highlight immediately for visual feedback
    }

    private handleToastClick(e: MouseEvent) {
        e.stopPropagation(); // Just in case
        this.disable();
    }
}
