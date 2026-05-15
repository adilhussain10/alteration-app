import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useApi } from '../hooks/useApi';
import { api } from '../api/client';
import { SkeletonRow } from '../components/Skeleton';
import { ErrorBanner } from '../components/ErrorBanner';
import { formatVoucherDate } from '../features/alteration/formatters';

interface BillPickerItem {
  qbguid: string;
  voucherNo: string;
  voucherDate: string;
  voucherType: number;
  voucherTypeName: string;
  customerName: string;
  customerMobile?: string;
  itemCount: number;
  hasAlteration: boolean;
  alterationQbguid?: string;
  alterationNo?: string;
  alterationStatus?: number;
  receivedItemCount?: number;
  inProgressItemCount?: number;
  readyItemCount?: number;
  deliveredItemCount?: number;
  alterationItemCount?: number;
}

interface BillPickerResponse {
  items: BillPickerItem[];
  totalCount: number;
}

interface BillLookupResponse {
  qbguid: string;
  voucherNo: string;
  hasAlteration: boolean;
  alterationQbguid?: string;
}

function today() {
  return new Date().toISOString().slice(0, 10);
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

function buildListUrl(fromDate: string, toDate: string): string {
  return `/api/vouchers/for-alteration?fromDate=${fromDate}&toDate=${toDate}`;
}

type Mode = 'new' | 'statusUpdate' | 'list';

function isMode(value: string | null): value is Mode {
  return value === 'new' || value === 'statusUpdate' || value === 'list';
}

export function BillPickerPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const p2 = searchParams.get('p2');
  const initialMode: Mode = isMode(p2) ? p2 : 'new';
  const inputRef = useRef<HTMLInputElement>(null);
  const [fromDate, setFromDate] = useState(today());
  const [toDate, setToDate] = useState(today());
  const [billInput, setBillInput] = useState('');
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [looking, setLooking] = useState(false);
  const [mode, setMode] = useState<Mode>(initialMode);

  const listUrl = buildListUrl(fromDate, toDate);
  const { data, loading, error, refetch } = useApi<BillPickerResponse>(listUrl);

  const refetchRef = useRef(refetch);
  refetchRef.current = refetch;
  useEffect(() => {
    const onFocus = () => refetchRef.current();
    const onVisibility = () => {
      if (document.visibilityState === 'visible') refetchRef.current();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  const filteredByMode = (data?.items ?? []).filter((it) => {
    if (mode === 'new') return !it.hasAlteration;
    if (mode === 'statusUpdate') return it.hasAlteration;
    return true;
  });

  const visibleItems = filteredByMode
    .slice()
    .sort((a, b) => {
      if (mode === 'statusUpdate') {
        const aTerm =
          a.alterationStatus === 3 || a.alterationStatus === 4 ? 1 : 0;
        const bTerm =
          b.alterationStatus === 3 || b.alterationStatus === 4 ? 1 : 0;
        if (aTerm !== bTerm) return aTerm - bTerm;
        return a.voucherDate.localeCompare(b.voucherDate);
      }
      return b.voucherDate.localeCompare(a.voucherDate);
    })
    .slice(0, 10);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  function openAlteration(qbguid: string) {
    navigate(
      `/alteration?p1=${encodeURIComponent(qbguid)}&p2=${encodeURIComponent(mode)}`,
    );
  }

  async function handleLookup() {
    const voucherNo = billInput.trim();
    if (!voucherNo) return;
    setLookupError(null);
    setLooking(true);
    try {
      const result = await api.get<BillLookupResponse>(
        `/api/vouchers/for-alteration?voucherNo=${encodeURIComponent(voucherNo)}`,
      );
      openAlteration(result.qbguid);
    } catch (e: unknown) {
      if (e instanceof Error && e.message.toLowerCase().includes('not found')) {
        setLookupError(`Bill "${voucherNo}" not found.`);
      } else {
        setLookupError('Could not look up bill. Check the number and try again.');
      }
    } finally {
      setLooking(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleLookup();
    }
  }

  const allItems = data?.items ?? [];
  const pendingCount = allItems.filter((it) => !it.hasAlteration).length;
  const activeCount = allItems.filter(
    (it) =>
      it.hasAlteration &&
      it.alterationStatus !== 3 &&
      it.alterationStatus !== 4,
  ).length;
  const totalCount = allItems.length;

  return (
    <div className="bg-[#C2D4E8] min-h-screen flex flex-col text-[#333333]">
      <header className="bg-gradient-to-r from-[#1a5fa8] to-[#2980d4] px-4 py-3 shadow-md">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 bg-white/20 rounded-lg flex items-center justify-center shrink-0">
              <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
              </svg>
            </div>
            <div className="min-w-0">
              <h1 className="text-white font-bold text-base leading-tight">
                Alteration Module
              </h1>
              <p className="text-blue-200 text-xs truncate">
                {modeSubtitle(mode)}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <ModeBadge mode={mode} />
            {mode === 'new' && (
              <HeaderStatChip tone="green">
                Pending: <strong className="ml-0.5">{pendingCount}</strong>
              </HeaderStatChip>
            )}
            {mode === 'statusUpdate' && (
              <HeaderStatChip tone="yellow">
                Active: <strong className="ml-0.5">{activeCount}</strong>
              </HeaderStatChip>
            )}
            {mode === 'list' && (
              <>
                <HeaderStatChip tone="white">
                  Total: <strong className="ml-0.5">{totalCount}</strong>
                </HeaderStatChip>
                <HeaderStatChip tone="green">
                  Pending: <strong className="ml-0.5">{pendingCount}</strong>
                </HeaderStatChip>
                <HeaderStatChip tone="yellow">
                  Active: <strong className="ml-0.5">{activeCount}</strong>
                </HeaderStatChip>
              </>
            )}
            <button
              type="button"
              onClick={() => navigate('/alteration?p3=reports')}
              title="Open the alteration reports (Pending Deliveries / Register)"
              className="inline-flex items-center gap-1.5 bg-white text-[#1a5276] hover:bg-blue-50 rounded-full px-3 py-1 text-xs font-semibold shadow-sm transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              Reports
            </button>
          </div>
        </div>
      </header>

      <div
        className="flex-1 overflow-y-auto p-3 flex flex-col gap-3"
        onKeyDown={handleEnterAsTab}
      >
        <section className="bg-white rounded-xl border border-[#C2D4E8] shadow-sm p-4">
          <div className="flex items-center gap-2 mb-3 min-w-0">
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-gray-800">Browse Documents</h2>
              <p className="text-xs text-gray-400">{modeHint(mode)}</p>
            </div>
            {data && (
              <span className="ml-2 bg-[#1a5fa8] text-white text-xs px-2 py-0.5 rounded-full font-semibold shrink-0">
                {filteredByMode.length > 10
                  ? `Last 10 of ${filteredByMode.length}`
                  : `${filteredByMode.length} ${filteredByMode.length === 1 ? 'document' : 'documents'}`}
              </span>
            )}
          </div>

          <div className="flex items-center gap-3 mb-3 flex-wrap">
            <div className="flex items-center gap-2 text-xs text-gray-500">
              <span className="font-semibold uppercase tracking-wide text-[10px]">From</span>
              <input
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                className="border border-[#C2D4E8] rounded px-2 py-1 text-xs tabular-nums focus:outline-none focus:border-[#1a5fa8] focus:ring-1 focus:ring-[#1a5fa8]"
              />
              <span aria-hidden>→</span>
              <span className="font-semibold uppercase tracking-wide text-[10px]">To</span>
              <input
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                className="border border-[#C2D4E8] rounded px-2 py-1 text-xs tabular-nums focus:outline-none focus:border-[#1a5fa8] focus:ring-1 focus:ring-[#1a5fa8]"
              />
            </div>

            <div className="flex items-center gap-2">
              <ModeCheck label="New" checked={mode === 'new'} onClick={() => setMode('new')} />
              <ModeCheck label="Update Status" checked={mode === 'statusUpdate'} onClick={() => setMode('statusUpdate')} />
              <ModeCheck label="List" checked={mode === 'list'} onClick={() => setMode('list')} />
            </div>

            <div className="ml-auto flex items-center gap-2">
              <div className="relative">
                <svg
                  className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <input
                  ref={inputRef}
                  type="text"
                  value={billInput}
                  onChange={(e) => {
                    setBillInput(e.target.value);
                    setLookupError(null);
                  }}
                  onKeyDown={handleKeyDown}
                  placeholder="Bill no…"
                  className="w-40 pl-7 pr-2 py-1 border border-[#C2D4E8] rounded text-xs font-mono focus:outline-none focus:border-[#1a5fa8] focus:ring-1 focus:ring-[#1a5fa8]"
                />
              </div>
              <button
                type="button"
                onClick={handleLookup}
                disabled={looking || billInput.trim() === ''}
                className="px-2.5 py-1 bg-[#1a5fa8] hover:bg-[#1550a0] text-white rounded text-xs font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {looking ? '…' : 'Open'}
              </button>
            </div>
          </div>

          {lookupError && (
            <div className="mb-3 flex items-center gap-2 rounded border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
              <span aria-hidden>⚠</span>
              <span>{lookupError}</span>
            </div>
          )}

          {loading ? (
            <div className="py-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <SkeletonRow key={i} cols={7} />
              ))}
            </div>
          ) : error ? (
            <ErrorBanner error={error} />
          ) : visibleItems.length === 0 ? (
            <div className="py-10 text-center">
              <div className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-[#F0F6FB] text-2xl text-[#1a5fa8] mb-2">
                🗒
              </div>
              <p className="text-sm text-gray-600">
                No documents found for the selected date range.
              </p>
              <p className="text-[11px] text-gray-400 mt-0.5">
                Try widening the From / To filter above.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-separate border-spacing-0">
                <thead>
                  <tr className="bg-[#F0F6FB] text-[10px] uppercase tracking-wide text-gray-500 font-semibold">
                    <th className="px-3 py-2 text-left rounded-l-lg">Document No</th>
                    <th className="px-3 py-2 text-left">Type</th>
                    <th className="px-3 py-2 text-left">Date</th>
                    <th className="px-3 py-2 text-left">Customer</th>
                    <th className="px-3 py-2 text-center">Items</th>
                    <th className="px-3 py-2 text-center">Alteration</th>
                    {(mode === 'statusUpdate' || mode === 'list') && (
                      <th className="px-3 py-2 text-center">Status</th>
                    )}
                    <th className="px-3 py-2 text-center rounded-r-lg">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleItems.map((row) => {
                    const initial =
                      (row.customerName ?? '').trim().charAt(0).toUpperCase() ||
                      '—';
                    const rowBg = row.hasAlteration
                      ? 'bg-[#FFFBEB] hover:bg-[#FFF3CC]'
                      : 'bg-white hover:bg-[#F0F6FB]';
                    return (
                      <tr
                        key={row.qbguid}
                        className={`${rowBg} border-b border-[#E8EEF4] transition-colors`}
                      >
                        <td className="px-3 py-2.5 font-semibold text-[#1a5fa8] font-mono border-b border-[#E8EEF4]">
                          {row.voucherNo}
                        </td>
                        <td className="px-3 py-2.5 border-b border-[#E8EEF4]">
                          <span
                            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
                              row.voucherType === 1090
                                ? 'bg-blue-100 text-blue-700'
                                : 'bg-violet-100 text-violet-700'
                            }`}
                          >
                            <span
                              className={`h-1.5 w-1.5 rounded-full ${
                                row.voucherType === 1090
                                  ? 'bg-blue-500'
                                  : 'bg-violet-500'
                              }`}
                              aria-hidden
                            />
                            {row.voucherTypeName}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-gray-600 tabular-nums border-b border-[#E8EEF4]">
                          {formatVoucherDate(row.voucherDate)}
                        </td>
                        <td className="px-3 py-2.5 border-b border-[#E8EEF4]">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <div className="w-5 h-5 bg-[#1a5fa8] rounded-full flex items-center justify-center text-white text-[9px] font-bold shrink-0">
                              {initial}
                            </div>
                            <div className="min-w-0 leading-tight">
                              <div className="truncate">
                                {row.customerName || (
                                  <span className="text-gray-400 italic">—</span>
                                )}
                              </div>
                              {row.customerMobile && (
                                <div className="text-[10px] text-gray-500 font-mono tabular-nums truncate">
                                  📱 {row.customerMobile}
                                </div>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-2.5 text-center border-b border-[#E8EEF4]">
                          <span className="bg-gray-100 text-gray-700 text-xs px-2 py-0.5 rounded-full font-semibold tabular-nums">
                            {row.itemCount}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-center border-b border-[#E8EEF4]">
                          {row.hasAlteration ? (
                            <AlterationStatusBadge
                              alterationNo={row.alterationNo}
                              status={row.alterationStatus}
                            />
                          ) : (
                            <span className="text-xs text-gray-400 italic">—</span>
                          )}
                        </td>
                        {(mode === 'statusUpdate' || mode === 'list') && (
                          <td className="px-3 py-2.5 text-center border-b border-[#E8EEF4]">
                            {row.hasAlteration ? (
                              <DeliverActions row={row} />
                            ) : (
                              <span className="text-xs text-gray-400 italic">—</span>
                            )}
                          </td>
                        )}
                        <td className="px-3 py-2.5 text-center border-b border-[#E8EEF4]">
                          <RowActionButton
                            row={row}
                            terminal={
                              row.alterationStatus === 3 ||
                              row.alterationStatus === 4
                            }
                            onClick={() => openAlteration(row.qbguid)}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function modeSubtitle(mode: Mode): string {
  if (mode === 'new') return 'New — pending documents';
  if (mode === 'statusUpdate') return 'Update Status — pending delivery';
  return 'List — all alterations';
}

function modeName(mode: Mode): string {
  if (mode === 'new') return 'New';
  if (mode === 'statusUpdate') return 'Update Status';
  return 'List';
}

interface ModeBadgeProps {
  mode: Mode;
}

function ModeBadge({ mode }: ModeBadgeProps) {
  const cls =
    mode === 'new'
      ? 'bg-green-500 text-white'
      : mode === 'statusUpdate'
        ? 'bg-yellow-400 text-gray-900'
        : 'bg-white/20 text-white border border-white/30';
  return (
    <span
      className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${cls}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-white/80" aria-hidden />
      {modeName(mode)}
    </span>
  );
}

type HeaderChipTone = 'white' | 'green' | 'yellow';

interface HeaderStatChipProps {
  tone: HeaderChipTone;
  children: React.ReactNode;
}

function HeaderStatChip({ tone, children }: HeaderStatChipProps) {
  const cls: Record<HeaderChipTone, string> = {
    white: 'bg-white/15 text-white',
    green: 'bg-green-500 text-white',
    yellow: 'bg-yellow-400 text-gray-900',
  };
  return (
    <span
      className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${cls[tone]}`}
    >
      {children}
    </span>
  );
}

function modeHint(mode: Mode): string {
  if (mode === 'new') return 'Pending documents in the From / To range';
  if (mode === 'statusUpdate') return 'Documents whose alteration delivery is still pending';
  return 'All documents in the range — every status';
}

const ALTERATION_BADGE: Record<number, { wrap: string; dot: string; label: string }> = {
  0: { wrap: 'bg-yellow-100 text-yellow-700', dot: 'bg-yellow-500', label: 'Received' },
  1: { wrap: 'bg-blue-100 text-blue-700', dot: 'bg-blue-500', label: 'In Progress' },
  2: { wrap: 'bg-emerald-100 text-emerald-700', dot: 'bg-emerald-500', label: 'Ready' },
  3: { wrap: 'bg-slate-200 text-slate-700', dot: 'bg-slate-500', label: 'Delivered' },
  4: { wrap: 'bg-rose-100 text-rose-700', dot: 'bg-rose-500', label: 'Cancelled' },
};

interface AlterationStatusBadgeProps {
  alterationNo?: string | undefined;
  status?: number | undefined;
}

function AlterationStatusBadge({ alterationNo, status }: AlterationStatusBadgeProps) {
  const cfg = status !== undefined ? ALTERATION_BADGE[status] : undefined;
  const wrap = cfg ? cfg.wrap : 'bg-yellow-100 text-yellow-700';
  const dot = cfg ? cfg.dot : 'bg-yellow-500';
  return (
    <span className={`inline-flex items-center gap-1 ${wrap} text-xs px-2 py-0.5 rounded-full`}>
      <span className={`h-1.5 w-1.5 rounded-full ${dot}`} aria-hidden />
      {alterationNo}
      {cfg && (
        <span className="ml-1 text-[10px] opacity-75">· {cfg.label}</span>
      )}
    </span>
  );
}

interface DeliverActionsProps {
  row: BillPickerItem;
}

type DeliveryStateKind = 'cancelled' | 'fullyDelivered' | 'partial' | 'unknown';

interface DeliveryState {
  kind: DeliveryStateKind;
  label: string;
  wrap: string;
  dot: string;
  counts?: {
    received: number;
    inProgress: number;
    ready: number;
    delivered: number;
  };
  totalVoucherItems?: number;
}

function resolveDeliveryState(row: BillPickerItem): DeliveryState {
  const delivered = row.deliveredItemCount ?? 0;
  const total = row.alterationItemCount ?? 0;
  const status = row.alterationStatus;

  if (status === 4) {
    return {
      kind: 'cancelled',
      label: 'Cancelled',
      wrap: 'bg-rose-50 text-rose-700 ring-rose-200',
      dot: 'bg-rose-500',
    };
  }
  if (status === 3 || (total > 0 && delivered === total)) {
    return {
      kind: 'fullyDelivered',
      label: 'Fully Delivered',
      wrap: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
      dot: 'bg-emerald-500',
    };
  }
  if (status !== undefined && status >= 0 && status <= 2) {
    return {
      kind: 'partial',
      label: 'Partially Delivered',
      wrap: 'bg-amber-50 text-amber-700 ring-amber-200',
      dot: 'bg-amber-500',
      counts: {
        received: row.receivedItemCount ?? 0,
        inProgress: row.inProgressItemCount ?? 0,
        ready: row.readyItemCount ?? 0,
        delivered: row.deliveredItemCount ?? 0,
      },
      totalVoucherItems: row.itemCount,
    };
  }
  return {
    kind: 'unknown',
    label: '—',
    wrap: 'bg-slate-50 text-slate-500 ring-slate-200',
    dot: 'bg-slate-400',
  };
}

const STATUS_BREAKDOWN: Array<{
  key: 'received' | 'inProgress' | 'ready' | 'delivered';
  label: string;
  wrap: string;
}> = [
  { key: 'received', label: 'Received', wrap: 'bg-yellow-50 text-yellow-700 ring-yellow-200' },
  { key: 'inProgress', label: 'In Progress', wrap: 'bg-blue-50 text-blue-700 ring-blue-200' },
  { key: 'ready', label: 'Ready', wrap: 'bg-violet-50 text-violet-700 ring-violet-200' },
  { key: 'delivered', label: 'Delivered', wrap: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
];

function DeliveryStatusPill({ state }: { state: DeliveryState }) {
  const breakdown = state.counts
    ? STATUS_BREAKDOWN.filter((s) => state.counts![s.key] > 0)
    : [];
  const total = state.totalVoucherItems ?? 0;
  const modified = state.counts
    ? state.counts.inProgress + state.counts.ready + state.counts.delivered
    : 0;
  const notModified = Math.max(0, total - modified);
  return (
    <div className="inline-flex flex-col items-center gap-1">
      <span
        className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 ring-inset ${state.wrap}`}
      >
        <span className={`h-1.5 w-1.5 rounded-full ${state.dot}`} aria-hidden />
        <span>{state.label}</span>
      </span>
      {state.kind === 'partial' && total > 0 && (
        <span
          className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-800 tabular-nums"
          title={`${modified} of ${total} voucher item${total === 1 ? '' : 's'} modified (status moved past Received); ${notModified} not modified yet`}
        >
          <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden>
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span>
            Out of <span className="font-mono">{total}</span> items:{' '}
            <span className="font-mono">{modified}</span> modified,{' '}
            <span className="font-mono">{notModified}</span> not modified
          </span>
        </span>
      )}
      {breakdown.length > 0 && state.counts && (
        <div className="inline-flex items-center gap-1 flex-wrap justify-center text-[10px] font-semibold tabular-nums max-w-[14rem]">
          {breakdown.map((s) => {
            const n = state.counts![s.key];
            return (
              <span
                key={s.key}
                className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 ring-1 ring-inset ${s.wrap}`}
                title={`${n} item${n === 1 ? '' : 's'} ${s.label}`}
              >
                <span className="font-mono">{n}</span> {s.label}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}

function DeliverActions({ row }: DeliverActionsProps) {
  if (!row.alterationQbguid) {
    return <span className="text-xs text-gray-400 italic">—</span>;
  }
  return <DeliveryStatusPill state={resolveDeliveryState(row)} />;
}

interface RowActionButtonProps {
  row: BillPickerItem;
  terminal: boolean;
  onClick: () => void;
}

function RowActionButton({ row, terminal, onClick }: RowActionButtonProps) {
  type ActionKind = 'open' | 'update' | 'view';
  const kind: ActionKind = !row.hasAlteration
    ? 'open'
    : terminal
      ? 'view'
      : 'update';
  const label = kind === 'open' ? 'Open' : kind === 'view' ? 'View' : 'Update';
  const palette =
    kind === 'view'
      ? 'bg-white border-slate-300 text-slate-600 hover:bg-slate-50'
      : kind === 'open'
        ? 'bg-white border-emerald-300 text-emerald-700 hover:bg-emerald-50'
        : 'bg-white border-[#8BAFC8] text-[#1a5fa8] hover:bg-[#E8F0F8]';
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1 px-2.5 py-1 border rounded-lg text-xs mx-auto font-medium transition-colors ${palette}`}
    >
      {kind === 'view' ? (
        <EyeIcon />
      ) : kind === 'open' ? (
        <PlusIcon />
      ) : (
        <RefreshIcon />
      )}
      {label}
    </button>
  );
}

function EyeIcon() {
  return (
    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
    </svg>
  );
}

function RefreshIcon() {
  return (
    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
    </svg>
  );
}

interface ModeCheckProps {
  label: string;
  checked: boolean;
  onClick: () => void;
}

function ModeCheck({ label, checked, onClick }: ModeCheckProps) {
  return (
    <label
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium cursor-pointer select-none transition-colors ${
        checked
          ? 'bg-[#1a5fa8] border-[#1a5fa8] text-white'
          : 'bg-white border-[#C2D4E8] text-gray-600 hover:bg-[#F0F6FB]'
      }`}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={onClick}
        className="w-3 h-3 accent-[#1a5fa8]"
      />
      <span>{label}</span>
    </label>
  );
}
