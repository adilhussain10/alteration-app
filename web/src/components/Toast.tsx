import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';

/**
 * Lightweight toast system. A single ToastProvider is mounted at the app
 * root; any component can call useToast() to push notifications. Toasts
 * stack in the bottom-right corner, auto-dismiss after their `duration`,
 * and support an optional action button (e.g. "Undo", "Retry").
 */

export type ToastTone = 'success' | 'error' | 'info' | 'warning';

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastInput {
  tone?: ToastTone;
  title: string;
  message?: string;
  /** Auto-dismiss after this many ms. Default 3500. Pass 0 to disable. */
  duration?: number;
  action?: ToastAction;
}

interface Toast extends ToastInput {
  id: number;
}

interface ToastContextValue {
  push: (toast: ToastInput) => number;
  dismiss: (id: number) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}

interface ToastProviderProps {
  children: React.ReactNode;
}

export function ToastProvider({ children }: ToastProviderProps) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const idRef = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const push = useCallback((input: ToastInput) => {
    const id = ++idRef.current;
    setToasts((prev) => [...prev, { id, ...input }]);
    return id;
  }, []);

  return (
    <ToastContext.Provider value={{ push, dismiss }}>
      {children}
      <div
        aria-live="polite"
        className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 pointer-events-none"
      >
        {toasts.map((t) => (
          <ToastView key={t.id} toast={t} onDismiss={() => dismiss(t.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

interface ToastViewProps {
  toast: Toast;
  onDismiss: () => void;
}

function ToastView({ toast, onDismiss }: ToastViewProps) {
  const tone = toast.tone ?? 'info';
  const duration = toast.duration ?? 3500;

  useEffect(() => {
    if (duration <= 0) return;
    const t = setTimeout(onDismiss, duration);
    return () => clearTimeout(t);
  }, [duration, onDismiss]);

  const palette: Record<ToastTone, { ring: string; bar: string; iconBg: string; iconColor: string }> = {
    success: {
      ring: 'ring-emerald-200',
      bar: 'bg-emerald-500',
      iconBg: 'bg-emerald-50',
      iconColor: 'text-emerald-600',
    },
    error: {
      ring: 'ring-rose-200',
      bar: 'bg-rose-500',
      iconBg: 'bg-rose-50',
      iconColor: 'text-rose-600',
    },
    info: {
      ring: 'ring-[#C2D4E8]',
      bar: 'bg-[#1a5fa8]',
      iconBg: 'bg-[#F0F6FB]',
      iconColor: 'text-[#1a5fa8]',
    },
    warning: {
      ring: 'ring-amber-200',
      bar: 'bg-amber-500',
      iconBg: 'bg-amber-50',
      iconColor: 'text-amber-600',
    },
  };
  const p = palette[tone];

  return (
    <div
      role="status"
      className={`pointer-events-auto w-80 bg-white rounded-lg shadow-xl ring-1 ring-inset ${p.ring} overflow-hidden`}
    >
      <div className="flex">
        <span className={`w-1 ${p.bar}`} aria-hidden />
        <div className="flex items-start gap-3 p-3 flex-1 min-w-0">
          <div
            className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 ${p.iconBg} ${p.iconColor}`}
            aria-hidden
          >
            <ToastIcon tone={tone} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-gray-900 leading-tight">
              {toast.title}
            </p>
            {toast.message && (
              <p className="mt-0.5 text-xs text-gray-600 leading-snug break-words">
                {toast.message}
              </p>
            )}
            {toast.action && (
              <button
                type="button"
                onClick={() => {
                  toast.action?.onClick();
                  onDismiss();
                }}
                className="mt-1.5 text-xs font-semibold text-[#1a5fa8] hover:underline"
              >
                {toast.action.label}
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Dismiss"
            className="text-gray-400 hover:text-gray-700 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}

function ToastIcon({ tone }: { tone: ToastTone }) {
  switch (tone) {
    case 'success':
      return (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
      );
    case 'error':
      return (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
        </svg>
      );
    case 'warning':
      return (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01" />
        </svg>
      );
    case 'info':
    default:
      return (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      );
  }
}
