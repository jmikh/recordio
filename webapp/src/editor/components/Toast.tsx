import React, { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { XButton } from '@shared/components';

// Toast types
export type ToastType = 'info' | 'success' | 'error' | 'progress';

export interface Toast {
    id: string;
    type: ToastType;
    title: string;
    message?: string;
    progress?: number; // 0-1 for progress type
    duration?: number; // ms, 0 = persistent
    onCancel?: () => void;
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

// Toast Item Component
const ToastItem: React.FC<{ toast: Toast; onRemove: () => void }> = ({ toast, onRemove }) => {
    const timerRef = useRef<number | null>(null);

    useEffect(() => {
        // Auto-dismiss non-progress toasts
        if (toast.type !== 'progress' && toast.duration !== 0) {
            const duration = toast.duration ?? 4000;
            timerRef.current = window.setTimeout(onRemove, duration);
        }

        return () => {
            if (timerRef.current) {
                clearTimeout(timerRef.current);
            }
        };
    }, [toast.type, toast.duration, onRemove]);

    // For success/error on progress toasts, auto-dismiss after delay
    useEffect(() => {
        if (toast.type === 'success' || toast.type === 'error') {
            timerRef.current = window.setTimeout(onRemove, 3000);
        }
    }, [toast.type, onRemove]);

    const getIcon = () => {
        switch (toast.type) {
            case 'success':
                return (
                    <svg className="toast-icon toast-icon-success" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                );
            case 'error':
                return (
                    <svg className="toast-icon toast-icon-error" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="12" cy="12" r="10" />
                        <path strokeLinecap="round" d="M15 9l-6 6M9 9l6 6" />
                    </svg>
                );
            case 'progress':
                return (
                    <div className="toast-spinner" />
                );
            default:
                return (
                    <svg className="toast-icon toast-icon-info" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="12" cy="12" r="10" />
                        <path strokeLinecap="round" d="M12 16v-4M12 8h.01" />
                    </svg>
                );
        }
    };

    return (
        <div className={`toast toast-${toast.type}`}>
            <div className="toast-icon-container">
                {getIcon()}
            </div>
            <div className="toast-content">
                <div className="toast-title">{toast.title}</div>
                {toast.message && <div className="toast-message">{toast.message}</div>}
                {toast.type === 'progress' && toast.progress !== undefined && (
                    <div className="toast-progress-container">
                        <div
                            className="toast-progress-bar"
                            style={{ width: `${Math.round(toast.progress * 100)}%` }}
                        />
                    </div>
                )}
            </div>
            {toast.onCancel && toast.type === 'progress' && (
                <XButton onClick={toast.onCancel} />
            )}
        </div>
    );
};

// Toast Container
const ToastContainer: React.FC<{ toasts: Toast[]; onRemove: (id: string) => void }> = ({ toasts, onRemove }) => {
    if (toasts.length === 0) return null;

    return createPortal(
        <div className="toast-container">
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
