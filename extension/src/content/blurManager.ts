
/**
 * @fileoverview Manages the DOM element blurring feature.
 * 
 * Allows users to hover and click elements to blur them before recording.
 * Blurs are persistent (until page reload) but the interaction mode can be toggled.
 */

export class BlurManager {
    private isEnabled = false;
    private toast: HTMLElement | null = null;
    private overlay: HTMLElement | null = null;
    private overlayLabel: HTMLElement | null = null;
    private highlightedElement: HTMLElement | null = null;


    constructor() {
        this.handleMouseOver = this.handleMouseOver.bind(this);
        this.handleMouseOut = this.handleMouseOut.bind(this);
        this.handleClick = this.handleClick.bind(this);
        this.handleToastClick = this.handleToastClick.bind(this);
        this.handleScroll = this.handleScroll.bind(this);
    }

    public enable() {
        if (this.isEnabled) return;
        this.isEnabled = true;

        this.injectStyles();
        this.createToast();
        this.createOverlay();
        this.addEventListeners();
        document.body.style.cursor = 'default';
    }

    public disable() {
        if (!this.isEnabled) return;
        this.isEnabled = false;

        this.removeToast();
        this.removeOverlay();
        this.removeEventListeners();

        document.body.style.cursor = '';
    }

    private injectStyles() {
        if (document.getElementById('recordio-blur-styles')) return;

        const style = document.createElement('style');
        style.id = 'recordio-blur-styles';
        style.textContent = `
            .recordio-blur {
                filter: blur(8px) !important;
                user-select: none;
                pointer-events: auto !important;
            }
            #recordio-blur-overlay {
                position: fixed;
                z-index: 2147483647 !important; /* Max z-index */
                pointer-events: none;
                border: 2px solid #6166E6;
                background-color: rgba(97, 102, 230, 0.05);
                border-radius: 4px;
                transition: all 0.05s ease-out;
                display: none;
                box-sizing: border-box;
            }
            #recordio-blur-label {
                position: absolute;
                top: -28px;
                left: -2px;
                background-color: #6166E6;
                color: white;
                padding: 4px 8px;
                border-radius: 4px 4px 4px 0;
                font-size: 12px;
                font-family: system-ui, -apple-system, sans-serif;
                font-weight: 500;
                white-space: nowrap;
                pointer-events: none;
                box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            }
            #recordio-blur-toast {
                position: fixed;
                bottom: 24px;
                left: 50%;
                transform: translateX(-50%);
                background-color: oklch(0.21 0 0);
                color: oklch(0.98 0 0 / 80%);
                padding: 12px 24px;
                border-radius: 8px;
                box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
                z-index: 2147483647 !important;
                font-family: 'Satoshi', system-ui, -apple-system, sans-serif;
                display: flex;
                align-items: center;
                gap: 16px;
                border: 1px solid oklch(1 0 0 / 8%);
                animation: recordio-fade-in 0.2s ease-out;
            }
            #recordio-blur-toast button {
                background-color: oklch(0.58 0.19 290);
                color: oklch(0.98 0 0);
                border: none;
                padding: 8px 16px;
                border-radius: 8px;
                font-weight: 500;
                cursor: pointer;
                font-size: 14px;
                transition: background-color 0.2s;
            }
            #recordio-blur-toast button:hover {
                background-color: oklch(0.66 0.20 290);
            }
            @keyframes recordio-fade-in {
                from { opacity: 0; transform: translate(-50%, 10px); }
                to { opacity: 1; transform: translate(-50%, 0); }
            }
        `;
        document.head.appendChild(style);
    }

    private createToast() {
        if (this.toast) return;

        this.toast = document.createElement('div');
        this.toast.id = 'recordio-blur-toast';

        const message = document.createElement('span');
        message.textContent = 'Hover and click elements to blur them.';
        message.style.fontSize = '14px';
        message.style.color = 'oklch(0.98 0 0 / 80%)';

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

    private createOverlay() {
        if (this.overlay) return;

        this.overlay = document.createElement('div');
        this.overlay.id = 'recordio-blur-overlay';

        this.overlayLabel = document.createElement('div');
        this.overlayLabel.id = 'recordio-blur-label';
        this.overlay.appendChild(this.overlayLabel);

        document.body.appendChild(this.overlay);
    }

    private removeOverlay() {
        if (this.overlay) {
            this.overlay.remove();
            this.overlay = null;
            this.overlayLabel = null;
        }
    }

    private addEventListeners() {
        document.addEventListener('mouseover', this.handleMouseOver, true);
        document.addEventListener('mouseout', this.handleMouseOut, true);
        document.addEventListener('click', this.handleClick, true);
        document.addEventListener('scroll', this.handleScroll, true);
    }

    private removeEventListeners() {
        document.removeEventListener('mouseover', this.handleMouseOver, true);
        document.removeEventListener('mouseout', this.handleMouseOut, true);
        document.removeEventListener('click', this.handleClick, true);
        document.removeEventListener('scroll', this.handleScroll, true);
    }

    private updateOverlay(element: HTMLElement) {
        if (!this.overlay || !this.overlayLabel) return;

        const rect = element.getBoundingClientRect();
        const isBlurred = element.classList.contains('recordio-blur');

        this.overlay.style.display = 'block';
        this.overlay.style.top = `${rect.top}px`;
        this.overlay.style.left = `${rect.left}px`;
        this.overlay.style.width = `${rect.width}px`;
        this.overlay.style.height = `${rect.height}px`;

        // Check if label fits on top
        if (rect.top < 30) {
            this.overlayLabel.style.top = '0px';
            this.overlayLabel.style.borderRadius = '0 0 4px 0';
        } else {
            this.overlayLabel.style.top = '-28px';
            this.overlayLabel.style.borderRadius = '4px 4px 4px 0';
        }

        if (isBlurred) {
            // Already blurred: Green theme
            this.overlay.style.borderColor = '#9FDB95';
            this.overlay.style.backgroundColor = 'rgba(159, 219, 149, 0.05)';
            this.overlayLabel.style.backgroundColor = '#9FDB95';
            this.overlayLabel.style.color = '#020617'; // Slate 950
            this.overlayLabel.textContent = 'Click to unblur';
        } else {
            // Not blurred: Purple theme
            this.overlay.style.borderColor = '#6166E6';
            this.overlay.style.backgroundColor = 'rgba(97, 102, 230, 0.05)';
            this.overlayLabel.style.backgroundColor = '#6166E6';
            this.overlayLabel.style.color = 'white';
            this.overlayLabel.textContent = 'Click to blur';
        }
    }

    private handleScroll() {
        if (this.highlightedElement) {
            this.updateOverlay(this.highlightedElement);
        }
    }

    private handleMouseOver(e: MouseEvent) {
        let target = e.target as HTMLElement;
        // Ignore our own UI
        if (this.toast && (this.toast === target || this.toast.contains(target))) return;
        if (this.overlay && (this.overlay === target || this.overlay.contains(target))) return;

        // Redirect to blurred ancestor if exists
        const closestBlurred = target.closest('.recordio-blur');
        if (closestBlurred) {
            target = closestBlurred as HTMLElement;
        }

        this.highlightedElement = target;

        // Show overlay with correct color
        this.updateOverlay(target);

        // Calculate cursor style
        target.style.cursor = 'pointer';
    }

    private handleMouseOut(e: MouseEvent) {
        let target = e.target as HTMLElement;
        const closestBlurred = target.closest('.recordio-blur');
        if (closestBlurred) {
            target = closestBlurred as HTMLElement;
        }

        if (target === this.highlightedElement) {
            // Check if we are moving to a descendant (which means we are still "inside" the target)
            const related = e.relatedTarget as HTMLElement;
            if (related && target.contains(related)) {
                return;
            }

            target.style.cursor = '';
            this.highlightedElement = null;
            if (this.overlay) {
                this.overlay.style.display = 'none';
            }
        }
    }

    private handleClick(e: MouseEvent) {
        let target = e.target as HTMLElement;

        // Allow clicking our own UI
        if (this.toast && (this.toast === target || this.toast.contains(target))) return;

        // Redirect to blurred ancestor if exists
        const closestBlurred = target.closest('.recordio-blur');
        if (closestBlurred) {
            target = closestBlurred as HTMLElement;
        }

        e.preventDefault();
        e.stopPropagation();

        if (target.classList.contains('recordio-blur')) {
            target.classList.remove('recordio-blur');
        } else {
            target.classList.add('recordio-blur');
            // Remove blur from any children to avoid double-blur
            const nestedBlurred = target.querySelectorAll('.recordio-blur');
            nestedBlurred.forEach(el => el.classList.remove('recordio-blur'));
        }

        // Update overlay immediately to reflect new state
        this.updateOverlay(target);
    }

    private handleToastClick(e: MouseEvent) {
        e.stopPropagation();
        this.disable();
    }
}
