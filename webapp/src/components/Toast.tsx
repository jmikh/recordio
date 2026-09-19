import React, { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { XButton } from '@shared/components';
import { LuCheck, LuCircleAlert } from 'react-icons/lu';

// Toast types
export type ToastType = 'info' | 'success' | 'error' | 'progress';

export type ToastDismissReason = 'expired' | 'dismissed' | 'clicked';

export interface Toast {
    id: string;
    type: ToastType;
    title: string;
    message?: string;
    progress?: number; // 0-1 for progress type
    duration?: number; // ms, 0 = persistent
    onCancel?: () => void;
    /** Inline action after the message: a link (`href`) or a callback (`onClick`); either dismisses the toast */
    action?: { label: string; href?: string; onClick?: () => void };
    onDismiss?: (reason: ToastDismissReason) => void;
}

interface ToastContextType {
    addToast: (toast: Omit<Toast, 'id'>) => string;
    updateToast: (id: string, updates: Partial<Toast>) => void;
    removeToast: (id: string) => void;
}

const ToastContext = createContext<ToastContextType | null>(null);

export const useToast = () => {
    const context = useContext(ToastContext);
    if (!context) {
        throw new Error('useToast must be used within a ToastProvider');
    }
    return context;
};

// Inject keyframes once
const STYLE_ID = 'toast-keyframes';
const ensureKeyframes = () => {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
        @keyframes toast-slide-in {
            from { opacity: 0; transform: translateY(-100%); }
            to { opacity: 1; transform: translateY(0); }
        }
        @keyframes toast-spin {
            to { transform: rotate(360deg); }
        }
    `;
    document.head.appendChild(style);
};

// Toast Item Component
const ToastItem: React.FC<{ toast: Toast; onRemove: () => void }> = ({ toast, onRemove }) => {
    const timerRef = useRef<number | null>(null);
    const [isExiting, setIsExiting] = useState(false);
    const dismissReasonRef = useRef<ToastDismissReason>('expired');

    useEffect(ensureKeyframes, []);

    const startExit = useCallback((reason: ToastDismissReason) => {
        dismissReasonRef.current = reason;
        setIsExiting(true);
        setTimeout(() => {
            toast.onDismiss?.(reason);
            onRemove();
        }, 300);
    }, [toast, onRemove]);

    useEffect(() => {
        // Auto-dismiss non-progress toasts after duration
        if (toast.type !== 'progress' && toast.duration !== 0) {
            const duration = toast.duration ?? 5000;
            timerRef.current = window.setTimeout(() => {
                startExit('expired');
            }, duration);
        }

        return () => {
            if (timerRef.current) {
                clearTimeout(timerRef.current);
            }
        };
    }, [toast.type, toast.duration, startExit]);

    // Status icon on the left, vertically centered on the whole toast (self-center)
    const getStatusIcon = () => {
        if (toast.type === 'progress') {
            return (
                <div
                    className="w-5 h-5 shrink-0 self-center rounded-full border-2 border-border"
                    style={{
                        borderTopColor: 'var(--primary)',
                        animation: 'toast-spin 0.8s linear infinite',
                    }}
                />
            );
        }
        if (toast.type === 'success') {
            return <LuCheck className="icon-lg shrink-0 self-center text-success" />;
        }
        if (toast.type === 'info' || toast.type === 'error') {
            return (
                <LuCircleAlert
                    className={`icon-lg shrink-0 self-center ${toast.type === 'error' ? 'text-destructive' : 'text-text-main'}`}
                />
            );
        }
        return null;
    };

    // The anchor itself does the navigating; this only dismisses the toast behind it.
    const handleActionClick = () => {
        startExit('clicked');
    };

    return (
        <div
            role={toast.type === 'error' ? 'alert' : 'status'}
            className="flex items-start gap-3 min-w-80 max-w-[420px] bg-surface-raised border border-border-selected rounded-xl shadow-float pointer-events-auto"
            style={{
                padding: '14px 16px',
                animation: isExiting ? undefined : 'toast-slide-in 0.3s ease-out',
                opacity: isExiting ? 0 : undefined,
                transform: isExiting ? 'translateY(-100%)' : undefined,
                transition: 'opacity 0.3s ease-out, transform 0.3s ease-out',
            }}
        >
            {getStatusIcon()}
            <div className="flex-1 min-w-0">
                {/* Close shares the title row so the message below spans the full width */}
                <div className="flex items-start gap-3">
                    <div className="flex-1 min-w-0 text-sm font-bold text-text-main leading-snug">{toast.title}</div>
                    <XButton className="shrink-0" onClick={toast.onCancel ?? (() => startExit('dismissed'))} />
                </div>
                {(toast.message || toast.action) && (
                    <div className="text-xs text-text-muted mt-0.5 leading-snug">
                        {toast.message}
                        {/* Action reads as an inline hyperlink continuing the message, not a separate line */}
                        {toast.action && (
                            <>
                                {toast.message && ' '}
                                {toast.action.href ? (
                                    <a
                                        href={toast.action.href}
                                        target="_blank"
                                        rel="noopener"
                                        className="text-primary underline"
                                        onClick={handleActionClick}
                                    >
                                        {toast.action.label}
                                    </a>
                                ) : (
                                    // Styled as the same inline link — a Button would break the sentence
                                    <button
                                        type="button"
                                        className="text-primary underline cursor-pointer"
                                        onClick={() => { toast.action?.onClick?.(); handleActionClick(); }}
                                    >
                                        {toast.action.label}
                                    </button>
                                )}
                            </>
                        )}
                    </div>
                )}
                {toast.type === 'progress' && toast.progress !== undefined && (
                    <div className="mt-2.5 h-1 bg-surface rounded-sm overflow-hidden">
                        <div
                            className="h-full rounded-sm transition-[width] duration-200 ease-out"
                            style={{
                                width: `${Math.round(toast.progress * 100)}%`,
                                background: 'linear-gradient(90deg, var(--primary), var(--secondary))',
                            }}
                        />
                    </div>
                )}
            </div>
        </div>
    );
};

// Toast Container
const ToastContainer: React.FC<{ toasts: Toast[]; onRemove: (id: string) => void }> = ({ toasts, onRemove }) => {
    if (toasts.length === 0) return null;

    return createPortal(
        <div className="fixed top-16 left-1/2 -translate-x-1/2 z-[10000] flex flex-col gap-3 pointer-events-none">
            {toasts.map(toast => (
                <ToastItem
                    key={toast.id}
                    toast={toast}
                    onRemove={() => onRemove(toast.id)}
                />
            ))}
        </div>,
        document.body
    );
};

// Toast Provider
export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [toasts, setToasts] = useState<Toast[]>([]);

    const addToast = useCallback((toast: Omit<Toast, 'id'>): string => {
        const id = crypto.randomUUID();
        setToasts(prev => [...prev, { ...toast, id }]);
        return id;
    }, []);

    const updateToast = useCallback((id: string, updates: Partial<Toast>) => {
        setToasts(prev => prev.map(t => t.id === id ? { ...t, ...updates } : t));
    }, []);

    const removeToast = useCallback((id: string) => {
        setToasts(prev => prev.filter(t => t.id !== id));
    }, []);

    return (
        <ToastContext.Provider value={{ addToast, updateToast, removeToast }}>
            {children}
            <ToastContainer toasts={toasts} onRemove={removeToast} />
        </ToastContext.Provider>
    );
};
