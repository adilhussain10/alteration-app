import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useApi } from '../hooks/useApi';
import type { VoucherAlterationResponse } from '../features/alteration/alteration';
import { Skeleton, SkeletonRow } from '../components/Skeleton';
import { ErrorBanner } from '../components/ErrorBanner';
import { AlterationItemsGrid } from '../features/alteration/AlterationItemsGrid';
import { AlterationActions } from '../features/alteration/AlterationActions';
import { useToast } from '../components/Toast';
import {
  useAlterationForm,
  validateAlterQty,
} from '../features/alteration/useAlterationForm';
import { useSaveAlteration } from '../features/alteration/useSaveAlteration';
import type { SaveItemBody } from '../features/alteration/useSaveAlteration';
import { formatVoucherDate } from '../features/alteration/formatters';
import { AlterationReportsPage } from './AlterationReportsPage';

function friendlyError(raw: string | undefined | null): string {
  if (!raw) return 'Unexpected error. Please try again.';
  return raw;
}

function handleEnterAsTab(e: React.KeyboardEvent<HTMLElement>) {
  if (e.key !== 'Enter' || e.defaultPrevented) return;
  const target = e.target as HTMLElement;
  const tag = target.tagName;
  if (tag !== 'INPUT' && tag !== 'SELECT') return;
  if (tag === 'INPUT') {
    const t = (target as HTMLInputElement).type.toLowerCase();
    if (t === 'button' || t === 'submit') return;
  }
  e.preventDefault();
  const root = e.currentTarget;
  const focusable = Array.from(
    root.querySelectorAll<HTMLElement>(
      'input:not([disabled]):not([readonly]):not([type="hidden"]), select:not([disabled]), button:not([disabled])',
    ),
  ).filter((el) => el.tabIndex !== -1);
  const idx = focusable.indexOf(target);
  if (idx >= 0 && idx < focusable.length - 1) {
    const next = focusable[idx + 1];
    if (next) {
      next.focus();
      if (next.tagName === 'INPUT') {
        const t = (next as HTMLInputElement).type.toLowerCase();
        if (t !== 'checkbox' && t !== 'radio' && t !== 'date') {
          (next as HTMLInputElement).select?.();
        }
      }
    }
  }
}

export function AlterationPage() {
  const [params] = useSearchParams();
  const p1 = params.get('p1') ?? '';
  const p2 = params.get('p2') ?? '';
  const p3 = params.get('p3') ?? '';

  if (p3 === 'reports') {
    return <AlterationReportsPage />;
  }
  if (p1 === '') {
    return (
      <div className="min-h-screen bg-[#C2D4E8] p-6">
        <p className="max-w-3xl mx-auto bg-white rounded-xl shadow-sm border border-[#C2D4E8] p-6 text-sm text-gray-600">
          No voucher selected. <a href="/" className="text-[#1a5fa8] hover:underline">Back to picker</a>.
        </p>
      </div>
    );
  }
  return <AlterationPageWithVoucher qbguid={p1} returnMode={p2} />;
}

interface AlterationPageWithVoucherProps {
  qbguid: string;
  returnMode: string;
}

function AlterationPageWithVoucher({ qbguid, returnMode }: AlterationPageWithVoucherProps) {
  const navigate = useNavigate();
  const path = `/api/voucher/${encodeURIComponent(qbguid)}/alteration`;
  const { data, loading, error, refetch } = useApi<VoucherAlterationResponse>(path);

  const form = useAlterationForm(data?.items ?? []);
  const saver = useSaveAlteration();
  const toast = useToast();

  const [confirmDialog, setConfirmDialog] = useState<
    | { title: string; message: string; tone: 'danger' | 'warning'; onConfirm: () => void }
    | null
  >(null);

  const [validationErrors, setValidationErrors] = useState<string[]>([]);

  const existingLoadedRef = useRef(false);
  useEffect(() => {
    if (data?.existingAlteration && !existingLoadedRef.current) {
      form.loadExisting(
        data.existingAlteration.internalRefNo ?? '',
        data.existingAlteration.alteredItems.map((it) => {
          const row = {
            voucherItemGuid: it.voucherItemGuid,
            alterationQty: it.alterationQty,
            remarks: it.remarks ?? '',
            deliveryDate: it.deliveryDate ?? '',
          };
          if (it.status !== undefined) {
            return { ...row, itemStatus: it.status };
          }
          return row;
        }),
      );
      existingLoadedRef.current = true;
    }
  }, [data, form]);

  useEffect(() => {
    function handleBeforeUnload(e: BeforeUnloadEvent) {
      if (!form.dirty) return;
      e.preventDefault();
      e.returnValue = '';
    }
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [form.dirty]);

  function performBack() {
    const target = returnMode
      ? `/?p2=${encodeURIComponent(returnMode)}`
      : '/';
    navigate(target);
  }

  function handleBack() {
    if (form.dirty) {
      setConfirmDialog({
        title: 'Go back without saving?',
        message:
          'You have unsaved changes. If you go back now those changes will be lost.',
        tone: 'warning',
        onConfirm: () => {
          setConfirmDialog(null);
          performBack();
        },
      });
      return;
    }
    performBack();
  }

  function performClearWithUndo() {
    const snap = form.snapshot();
    form.clear();
    toast.push({
      tone: 'warning',
      title: 'All changes cleared',
      message: 'Click Undo within 5 seconds to bring them back.',
      duration: 5000,
      action: {
        label: 'Undo',
        onClick: () => form.restore(snap),
      },
    });
  }

  function handleClear() {
    if (form.dirty) {
      setConfirmDialog({
        title: 'Clear all changes?',
        message:
          'Every checked item, alter quantity, remark and delivery date will be reset. You can undo for 5 seconds afterwards.',
        tone: 'danger',
        onConfirm: () => {
          setConfirmDialog(null);
          performClearWithUndo();
        },
      });
      return;
    }
    form.clear();
  }

  function handleExit() {
    if (form.dirty) {
      setConfirmDialog({
        title: 'Exit without saving?',
        message:
          'You have unsaved changes. If you exit now those changes will be lost.',
        tone: 'warning',
        onConfirm: () => {
          setConfirmDialog(null);
          performBack();
        },
      });
      return;
    }
    performBack();
  }

  async function handleSave() {
    if (!data) return;

    const errors = computeSaveErrors(data, form);
    if (errors.length > 0) {
      setValidationErrors(errors);
      return;
    }
    setValidationErrors([]);

    const items: SaveItemBody[] = [];
    for (const item of data.items) {
      const alt = form.getItemAlteration(item.qbguid);
      if (!alt.alterRequired) continue;
      const body: SaveItemBody = {
        voucherItemGuid: item.qbguid,
        alterationQty: Number(alt.alterQty),
        remarks: alt.remarks,
        deliveryDate: alt.deliveryDate,
      };
      if (alt.itemStatus !== undefined) body.status = alt.itemStatus;
      items.push(body);
    }

    const result = await saver.save(qbguid, {
      internalRefNo: form.internalRefNo,
      items,
    });
    if (result) {
      toast.push({
        tone: 'success',
        title: result.isUpdate ? 'Alteration updated' : 'Alteration saved',
        message: `${result.voucherNo} — ${result.itemCount} ${
          result.itemCount === 1 ? 'item' : 'items'
        } recorded.`,
      });
      form.clear();
      navigate(
        returnMode
          ? `/?p2=${encodeURIComponent(returnMode)}`
          : '/',
      );
    } else {
      const err = saver.status.kind === 'error' ? saver.status.error : null;
      toast.push({
        tone: 'error',
        title: 'Could not save alteration',
        message: friendlyError(err?.message),
        duration: 0,
        action: { label: 'Retry', onClick: () => void handleSave() },
      });
    }
  }

  const saveDisabledRef = useRef<boolean>(true);
  const isTerminalRef = useRef<boolean>(false);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      if (target?.tagName === 'TEXTAREA') return;

      if (e.key === 'F10' || (e.altKey && (e.key === 's' || e.key === 'S'))) {
        e.preventDefault();
        const shortcut = e.key === 'F10' ? 'F10' : 'Alt+S';
        if (saveDisabledRef.current) {
          toast.push({
            tone: 'info',
            title: `${shortcut} — Save not available`,
            message: isTerminalRef.current
              ? 'Alteration is finalized — read-only.'
              : 'Nothing to save right now.',
            duration: 1800,
          });
          return;
        }
        toast.push({
          tone: 'info',
          title: `${shortcut} — Saving alteration…`,
          duration: 1200,
        });
        void handleSave();
        return;
      }
      if (e.altKey && e.key === 'ArrowLeft') {
        e.preventDefault();
        handleBack();
        return;
      }
      if (e.key === 'Escape') {
        if (confirmDialog) {
          setConfirmDialog(null);
          return;
        }
        e.preventDefault();
        handleExit();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [confirmDialog]);

  if (loading) {
    return (
      <PageShell>
        <CompactHeader subtitle="Loading…" onBack={handleBack} />
        <main className="flex-1 overflow-y-auto p-3 flex flex-col gap-3">
          <div className="bg-white rounded-lg border border-[#C2D4E8] shadow-sm p-3">
            <div className="grid grid-cols-4 gap-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="space-y-1.5">
                  <Skeleton className="h-2 w-16" />
                  <Skeleton className="h-4 w-28" />
                </div>
              ))}
            </div>
          </div>
          <div className="bg-white rounded-lg border border-[#C2D4E8] shadow-sm overflow-hidden">
            <div className="px-4 py-2.5 border-b border-[#C2D4E8] flex items-center gap-2">
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-4 w-8 rounded-full" />
            </div>
            {Array.from({ length: 5 }).map((_, i) => (
              <SkeletonRow key={i} cols={5} />
            ))}
          </div>
        </main>
      </PageShell>
    );
  }

  if (error) {
    return (
      <PageShell>
        <CompactHeader subtitle="Error" onBack={handleBack} />
        <main className="flex-1 overflow-y-auto p-3">
          <ErrorBanner error={error} />
        </main>
      </PageShell>
    );
  }

  if (!data) {
    return (
      <PageShell>
        <CompactHeader subtitle="No data" onBack={handleBack} />
        <main className="flex-1 overflow-y-auto p-3">
          <ErrorBanner error={new Error('No data returned for this voucher.')} />
        </main>
      </PageShell>
    );
  }

  const isPending = saver.status.kind === 'pending';
  const docStatus = data?.existingAlteration?.status;
  const isTerminal = docStatus === 3 || docStatus === 4;
  const terminalLabel =
    docStatus === 3 ? 'Delivered' : docStatus === 4 ? 'Cancelled' : undefined;
  const saveDisabled = isPending || isTerminal;
  const saveLabel = isPending ? 'Saving…' : 'Save';

  saveDisabledRef.current = saveDisabled;
  isTerminalRef.current = isTerminal;

  const partyLabel = data.header.partyName === '' ? '(no party)' : data.header.partyName;
  const partyMobile = data.header.partyMobile ?? '';
  const existingDeliveryDate =
    data.existingAlteration?.alteredItems?.[0]?.deliveryDate;

  return (
    <PageShell>
      <CompactHeader
        voucherNo={data.header.voucherNo || '—'}
        partyName={partyLabel}
        partyMobile={partyMobile}
        itemCount={data.items.length}
        voucherDate={data.header.voucherDate}
        alterationDate={existingDeliveryDate}
        status={data.existingAlteration?.status}
        onBack={handleBack}
      />
      <main
        className="flex-1 min-h-0 p-3 flex flex-col gap-2 overflow-hidden"
        onKeyDown={handleEnterAsTab}
      >
        {validationErrors.length > 0 && (
          <ValidationErrorBanner
            errors={validationErrors}
            onDismiss={() => setValidationErrors([])}
          />
        )}
        <AlterationItemsGrid
          items={data.items}
          getAlteration={form.getItemAlteration}
          onToggleAlterRequired={form.toggleAlterRequired}
          onPatchAlteration={form.patchItemAlteration}
          onSetAllRequired={form.setAllRequired}
          onApplyToChecked={form.applyToChecked}
          alterationQbguid={data.existingAlteration?.alterationQbguid}
          currentStatus={data.existingAlteration?.status}
          onStatusChanged={refetch}
          onTerminalStatusReached={(status) => {
            toast.push({
              tone: 'success',
              title: status === 3 ? 'Alteration delivered' : 'Alteration cancelled',
              message: 'Returning to the document list.',
              duration: 2000,
            });
            navigate(
              returnMode
                ? `/?p2=${encodeURIComponent(returnMode)}`
                : '/',
            );
          }}
          voucherDate={data.header.voucherDate}
        />
      </main>
      <AlterationActions
        onSave={handleSave}
        onClear={handleClear}
        onExit={handleExit}
        onPrint={() => window.print()}
        printEnabled={!!data.existingAlteration}
        saveDisabled={saveDisabled}
        saveLabel={saveLabel}
        readOnly={isTerminal}
        {...(terminalLabel ? { readOnlyReason: terminalLabel } : {})}
      />
      {confirmDialog && (
        <ConfirmDialog
          title={confirmDialog.title}
          message={confirmDialog.message}
          tone={confirmDialog.tone}
          onConfirm={confirmDialog.onConfirm}
          onCancel={() => setConfirmDialog(null)}
        />
      )}
    </PageShell>
  );
}

interface ConfirmDialogProps {
  title: string;
  message: string;
  tone: 'danger' | 'warning';
  onConfirm: () => void;
  onCancel: () => void;
}

function ConfirmDialog({ title, message, tone, onConfirm, onCancel }: ConfirmDialogProps) {
  const accent =
    tone === 'danger'
      ? {
          bg: 'bg-rose-50',
          ring: 'ring-rose-200',
          icon: 'text-rose-600',
          confirmBtn: 'bg-rose-600 hover:bg-rose-700',
        }
      : {
          bg: 'bg-amber-50',
          ring: 'ring-amber-200',
          icon: 'text-amber-600',
          confirmBtn: 'bg-amber-500 hover:bg-amber-600',
        };
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={onCancel}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onCancel();
        if (e.key === 'Enter') onConfirm();
      }}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="w-full max-w-md rounded-xl bg-white shadow-2xl border border-[#C2D4E8] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className={`px-5 py-4 flex items-start gap-3 ${accent.bg} ring-1 ring-inset ${accent.ring}`}>
          <div className={`w-10 h-10 rounded-full bg-white flex items-center justify-center flex-shrink-0 ${accent.icon}`}>
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-bold text-gray-900">{title}</h3>
            <p className="mt-1 text-xs text-gray-700 leading-relaxed">{message}</p>
          </div>
        </div>
        <div className="px-5 py-3 flex items-center justify-end gap-2 bg-white">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-1.5 text-sm font-medium text-gray-700 bg-white border border-[#C2D4E8] rounded-lg hover:bg-[#F0F6FB] transition-colors"
            autoFocus
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={`px-4 py-1.5 text-sm font-semibold text-white rounded-lg transition-colors ${accent.confirmBtn}`}
          >
            OK
          </button>
        </div>
      </div>
    </div>
  );
}

function computeSaveErrors(
  data: VoucherAlterationResponse,
  form: ReturnType<typeof useAlterationForm>,
): string[] {
  const errors: string[] = [];
  const checked = data.items.filter(
    (it) => form.getItemAlteration(it.qbguid).alterRequired,
  );
  if (checked.length === 0) {
    errors.push('Please select at least one item to alter before saving.');
    return errors;
  }
  for (const item of checked) {
    const alt = form.getItemAlteration(item.qbguid);
    const stockLabel = item.stockNo || `#${item.serialNo}`;
    if (!validateAlterQty(alt.alterQty, item.docQty).ok) {
      errors.push(
        `Item ${stockLabel} has Alter Qty of 0. Please enter a valid quantity.`,
      );
    }
    if (alt.deliveryDate.trim() === '') {
      errors.push(`Please set a delivery date for ${stockLabel}.`);
    }
    if (alt.remarks.trim() === '') {
      errors.push(`Please add a remark for ${stockLabel}.`);
    }
  }
  return errors;
}

interface ValidationErrorBannerProps {
  errors: string[];
  onDismiss: () => void;
}

function ValidationErrorBanner({ errors, onDismiss }: ValidationErrorBannerProps) {
  return (
    <div
      role="alert"
      className="rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-rose-800 shadow-sm flex items-start gap-2"
    >
      <svg className="w-4 h-4 mt-0.5 flex-shrink-0 text-rose-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden>
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
      </svg>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-bold uppercase tracking-wide text-rose-700">
          Cannot save — fix the following:
        </p>
        <ul className="mt-1 space-y-0.5 text-sm list-disc pl-4">
          {errors.map((err, i) => (
            <li key={i}>{err}</li>
          ))}
        </ul>
      </div>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="text-rose-400 hover:text-rose-700 flex-shrink-0"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}

interface PageShellProps {
  children: React.ReactNode;
}

function PageShell({ children }: PageShellProps) {
  return (
    <div className="bg-[#C2D4E8] text-[#333333] h-screen flex flex-col overflow-hidden">
      {children}
    </div>
  );
}

interface CompactHeaderProps {
  voucherNo?: string;
  partyName?: string;
  partyMobile?: string;
  subtitle?: string;
  itemCount?: number;
  voucherDate?: string;
  alterationDate?: string | undefined;
  status?: number | undefined;
  onBack?: (() => void) | undefined;
}

interface StatusConfig {
  bg: string;
  dot: string;
  text: string;
  label: string;
}

const STATUS_CONFIG: Record<number, StatusConfig> = {
  0: { bg: 'bg-blue-100',  dot: 'bg-blue-500',  text: 'text-blue-700',  label: 'Received'    },
  1: { bg: 'bg-amber-100', dot: 'bg-amber-500', text: 'text-amber-700', label: 'In Progress' },
  2: { bg: 'bg-green-100', dot: 'bg-green-500', text: 'text-green-700', label: 'Ready'       },
  3: { bg: 'bg-slate-100', dot: 'bg-slate-500', text: 'text-slate-700', label: 'Delivered'   },
  4: { bg: 'bg-red-100',   dot: 'bg-red-500',   text: 'text-red-700',   label: 'Cancelled'   },
};

function CompactHeader({
  voucherNo,
  partyName,
  partyMobile,
  subtitle,
  itemCount,
  voucherDate,
  alterationDate,
  status,
  onBack,
}: CompactHeaderProps) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const timeStr = now
    .toLocaleTimeString('en-IN', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
    })
    .toUpperCase();
  const dateStr = now.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });

  const statusCfg = status !== undefined ? STATUS_CONFIG[status] : undefined;

  return (
    <header className="relative bg-gradient-to-r from-[#0f3460] via-[#1a5276] to-[#2471a3] px-5 py-3 flex items-center justify-between gap-3 overflow-hidden flex-shrink-0 shadow-md">
      <div className="absolute -top-6 -left-6 w-24 h-24 bg-white/5 rounded-full" aria-hidden />
      <div className="absolute -bottom-8 left-32 w-32 h-32 bg-white/5 rounded-full" aria-hidden />
      <div className="absolute -top-4 right-48 w-20 h-20 bg-white/5 rounded-full" aria-hidden />

      <div className="relative z-10 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          {onBack ? (
            <button
              type="button"
              onClick={onBack}
              title="Back to documents (Alt+←)"
              className="w-7 h-7 bg-white/15 hover:bg-white/30 rounded-lg flex items-center justify-center shrink-0 transition-colors group"
            >
              <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" />
              </svg>
              <span className="sr-only">Back to documents</span>
            </button>
          ) : (
            <div className="w-7 h-7 bg-white/15 rounded-lg flex items-center justify-center shrink-0">
              <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
              </svg>
            </div>
          )}
          <h1 className="text-white font-bold text-base tracking-tight">
            Alteration Module
          </h1>
        </div>
        {voucherNo ? (
          <p className="text-blue-200 text-xs pl-9 truncate">
            Voucher{' '}
            <span className="text-white font-semibold">{voucherNo}</span>
            {partyName ? (
              <>
                {' — '}
                <span className="text-white font-semibold">{partyName}</span>
              </>
            ) : null}
            {partyMobile ? (
              <span className="text-blue-100 font-mono ml-1">
                · 📱 {partyMobile}
              </span>
            ) : null}
          </p>
        ) : subtitle ? (
          <p className="text-blue-200 text-xs pl-9 truncate">{subtitle}</p>
        ) : null}
      </div>

      <div className="relative z-10 flex items-center gap-2 flex-wrap justify-center">
        {partyName && (
          <div className="flex items-center gap-1.5 bg-white/15 backdrop-blur-sm rounded-full px-3 py-1 border border-white/25 shadow-sm">
            <svg className="w-3 h-3 text-blue-200" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
            <span className="text-white text-xs font-medium">
              <strong>{partyName}</strong>
              {partyMobile ? (
                <>
                  {' · '}
                  <span className="font-mono tabular-nums">{partyMobile}</span>
                </>
              ) : null}
            </span>
          </div>
        )}
        {itemCount !== undefined && (
          <div className="flex items-center gap-1.5 bg-white/15 backdrop-blur-sm rounded-full px-3 py-1 border border-white/25 shadow-sm">
            <svg className="w-3 h-3 text-blue-200" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
            <span className="text-white text-xs font-medium">
              Items: <strong>{itemCount}</strong>
            </span>
          </div>
        )}
        {voucherDate && (
          <div className="flex items-center gap-1.5 bg-white/15 backdrop-blur-sm rounded-full px-3 py-1 border border-white/25 shadow-sm">
            <svg className="w-3 h-3 text-blue-200" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            <span className="text-white text-xs font-medium">
              Voucher:{' '}
              <strong className="font-mono tabular-nums">
                {formatVoucherDate(voucherDate)}
              </strong>
            </span>
          </div>
        )}
        {alterationDate && (
          <div className="flex items-center gap-1.5 bg-amber-400 rounded-full px-3 py-1 shadow-sm">
            <svg className="w-3 h-3 text-amber-900" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span className="text-amber-900 text-xs font-bold">
              ALT:{' '}
              <strong className="font-mono tabular-nums">
                {formatVoucherDate(alterationDate)}
              </strong>
            </span>
          </div>
        )}
        {statusCfg && (
          <div className={`flex items-center gap-1.5 rounded-full px-3 py-1 shadow-sm ${statusCfg.bg}`}>
            <div className={`w-2 h-2 rounded-full ${statusCfg.dot}`} aria-hidden />
            <span className={`text-xs font-semibold ${statusCfg.text}`}>
              {statusCfg.label}
            </span>
          </div>
        )}

        <div className="flex items-center gap-1.5 bg-white/10 backdrop-blur-sm rounded-full px-3 py-1 border border-white/20 shadow-sm">
          <svg className="w-3 h-3 text-blue-300 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span className="text-blue-100 text-xs font-mono tracking-tight">
            {dateStr}{' '}
            <strong className="text-white text-sm">{timeStr}</strong>
          </span>
        </div>
      </div>
    </header>
  );
}
