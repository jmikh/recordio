import React, { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { XButton } from '@shared/components';
import { FaCheck, FaCircleExclamation } from 'react-icons/fa6';

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
    action?: { label: string; href: string };
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

    // Status icon to the left of the title
    const getStatusIcon = () => {
        if (toast.type === 'progress') {
            return (
                <div
                    className="w-5 h-5 shrink-0 rounded-full border-2 border-border"
                    style={{
                        borderTopColor: 'var(--primary)',
                        animation: 'toast-spin 0.8s linear infinite',
                    }}
                />
            );
        }
        if (toast.type === 'success') {
            return <FaCheck className="shrink-0 w-5 h-5 text-success" />;
        }
        if (toast.type === 'info' || toast.type === 'error') {
            return (
                <FaCircleExclamation
                    className={`shrink-0 w-5 h-5 ${toast.type === 'error' ? 'text-destructive' : 'text-text-main'}`}
                />
            );
        }
        return null;
    };

    const handleActionClick = () => {
        window.open(toast.action!.href, '_blank', 'noopener');
        startExit('clicked');
    };

    return (
        <div
            role={toast.type === 'error' ? 'alert' : 'status'}
            className="flex items-center gap-3 min-w-80 max-w-[420px] bg-surface-raised border border-border-selected rounded-xl shadow-float pointer-events-auto"
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
                <div className="text-sm font-bold text-text-main leading-snug">{toast.title}</div>
                {toast.message && <div className="text-xs text-text-muted mt-0.5 leading-snug">{toast.message}</div>}
                {toast.action && (
                    <button
                        className="mt-1.5 text-xs font-bold text-primary bg-transparent border-none p-0 cursor-pointer hover:underline transition-colors"
                        onClick={handleActionClick}
                    >
                        {toast.action.label}
                    </button>
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
            <XButton onClick={toast.onCancel ?? (() => startExit('dismissed'))} />
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
