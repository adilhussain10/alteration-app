import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApi } from '../hooks/useApi';
import { ErrorBanner } from '../components/ErrorBanner';
import { Skeleton, SkeletonRow } from '../components/Skeleton';
import { formatVoucherDate } from '../features/alteration/formatters';

type ReportType = 'pending' | 'register';

interface ReportRow {
  alterationQbguid: string;
  alterationNo: string;
  voucherQbguid: string;
  voucherNo: string;
  voucherDate: string;
  voucherType: number;
  voucherTypeName: string;
  customerName: string;
  status: number;
  statusLabel: string;
  earliestDeliveryDate?: string | null;
  totalItems: number;
  receivedItems: number;
  inProgressItems: number;
  readyItems: number;
  deliveredItems: number;
  modifiedItems: number;
  notModifiedItems: number;
}

interface ReportResponse {
  rows: ReportRow[];
  totalCount: number;
  fromDate: string;
  toDate: string;
  reportType: ReportType;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function AlterationReportsPage() {
  const navigate = useNavigate();
  const [reportType, setReportType] = useState<ReportType>('pending');
  const [fromDate, setFromDate] = useState(todayIso());
  const [toDate, setToDate] = useState(todayIso());

  const url = `/api/alterations/reports?type=${reportType}&fromDate=${fromDate}&toDate=${toDate}`;
  const { data, loading, error, refetch } = useApi<ReportResponse>(url);

  const [statusFilter, setStatusFilter] = useState<'all' | number>('all');

  const visibleRows = useMemo(() => {
    const rows = data?.rows ?? [];
    if (statusFilter === 'all') return rows;
    return rows.filter((r) => r.status === statusFilter);
  }, [data, statusFilter]);

  function handleBack() {
    navigate('/');
  }

  function handlePrint() {
    window.print();
  }

  const HEADER_ROW = [
    'Document No',
    'Alteration No',
    'Voucher Date',
    'Customer',
    'Voucher Type',
    'Status',
    'Earliest Delivery',
    'Total Items',
    'Modified',
    'Not Modified',
    'Received',
    'In Progress',
    'Ready',
    'Delivered',
  ] as const;

  function rowValues(r: ReportRow): Array<string | number> {
    return [
      r.voucherNo,
      r.alterationNo,
      formatVoucherDate(r.voucherDate),
      r.customerName,
      r.voucherTypeName,
      r.statusLabel,
      r.earliestDeliveryDate ? formatVoucherDate(r.earliestDeliveryDate) : '',
      r.totalItems,
      r.modifiedItems,
      r.notModifiedItems,
      r.receivedItems,
      r.inProgressItems,
      r.readyItems,
      r.deliveredItems,
    ];
  }

  function handleExportCsv() {
    if (!data) return;
    const lines = [HEADER_ROW.map(csvEscape).join(',')];
    for (const r of visibleRows) {
      lines.push(rowValues(r).map(csvEscape).join(','));
    }
    downloadBlob(
      '﻿' + lines.join('\r\n'),
      `alteration-${reportType}-${fromDate}-to-${toDate}.csv`,
      'text/csv',
    );
  }

  function handleExportExcel() {
    if (!data) return;
    const html = renderExcelHtml(reportType, fromDate, toDate, visibleRows);
    downloadBlob(
      html,
      `alteration-${reportType}-${fromDate}-to-${toDate}.xls`,
      'application/vnd.ms-excel',
    );
  }

  function handleExportJson() {
    if (!data) return;
    const payload = JSON.stringify({ ...data, rows: visibleRows }, null, 2);
    downloadBlob(
      payload,
      `alteration-${reportType}-${fromDate}-to-${toDate}.json`,
      'application/json',
    );
  }

  function handleExportHtml() {
    if (!data) return;
    const html = renderHtmlReport(reportType, fromDate, toDate, visibleRows);
    downloadBlob(
      html,
      `alteration-${reportType}-${fromDate}-to-${toDate}.html`,
      'text/html',
    );
  }

  function handleExportPdf() {
    if (!data) return;
    const html = renderHtmlReport(reportType, fromDate, toDate, visibleRows);
    const iframe = document.createElement('iframe');
    Object.assign(iframe.style, {
      position: 'fixed',
      right: '0',
      bottom: '0',
      width: '0',
      height: '0',
      border: '0',
      visibility: 'hidden',
    });
    document.body.appendChild(iframe);
    const cleanup = () => {
      setTimeout(() => {
        if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
      }, 1000);
    };
    iframe.onload = () => {
      try {
        iframe.contentWindow?.focus();
        iframe.contentWindow?.print();
      } finally {
        cleanup();
      }
    };
    const doc = iframe.contentDocument;
    if (!doc) {
      cleanup();
      return;
    }
    doc.open();
    doc.write(html);
    doc.close();
  }

  const [exportOpen, setExportOpen] = useState(false);
  const exportMenuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!exportOpen) return;
    function onDoc(e: MouseEvent) {
      if (
        exportMenuRef.current &&
        !exportMenuRef.current.contains(e.target as Node)
      ) {
        setExportOpen(false);
      }
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [exportOpen]);

  const totals = useMemo(() => {
    const t = {
      totalItems: 0,
      modified: 0,
      notModified: 0,
      received: 0,
      inProgress: 0,
      ready: 0,
      delivered: 0,
    };
    for (const r of visibleRows) {
      t.totalItems += r.totalItems;
      t.modified += r.modifiedItems;
      t.notModified += r.notModifiedItems;
      t.received += r.receivedItems;
      t.inProgress += r.inProgressItems;
      t.ready += r.readyItems;
      t.delivered += r.deliveredItems;
    }
    return t;
  }, [visibleRows]);

  return (
    <div className="bg-[#C2D4E8] min-h-screen flex flex-col text-[#333333] print:bg-white">
      <header className="bg-gradient-to-r from-[#0f3460] via-[#1a5276] to-[#2471a3] px-5 py-3 shadow-md print:hidden">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2.5 min-w-0">
            <button
              type="button"
              onClick={handleBack}
              title="Back to documents"
              className="w-8 h-8 bg-white/15 hover:bg-white/30 rounded-lg flex items-center justify-center shrink-0 transition-colors"
            >
              <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <div className="min-w-0">
              <h1 className="text-white font-bold text-base leading-tight">
                Alteration Reports
              </h1>
              <p className="text-blue-200 text-xs">
                {reportType === 'pending'
                  ? 'Pending Deliveries — jobs still in flight'
                  : 'Alteration Register — every alteration in the range'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="bg-white/15 text-white text-xs font-semibold px-3 py-1 rounded-full">
              {data
                ? `${data.totalCount} ${data.totalCount === 1 ? 'row' : 'rows'}`
                : '—'}
            </span>
          </div>
        </div>
      </header>

      <div className="flex-1 flex flex-col gap-3 p-3 print:p-0">
        <section className="bg-white rounded-xl border border-[#C2D4E8] shadow-sm p-3 print:hidden">
          <div className="flex items-center gap-3 flex-wrap">
            <div className="inline-flex rounded-lg bg-slate-100 p-0.5 border border-slate-200">
              <ReportTab
                label="Pending Deliveries"
                active={reportType === 'pending'}
                onClick={() => setReportType('pending')}
              />
              <ReportTab
                label="Alteration Register"
                active={reportType === 'register'}
                onClick={() => setReportType('register')}
              />
            </div>

            <div className="h-7 w-px bg-slate-200" aria-hidden />

            <div className="flex items-center gap-2 text-xs">
              <span className="font-semibold uppercase tracking-wide text-slate-500">From</span>
              <input
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                className="border border-[#C2D4E8] rounded px-2 py-1 text-xs tabular-nums focus:outline-none focus:border-[#1a5fa8] focus:ring-1 focus:ring-[#1a5fa8]"
              />
              <span className="text-slate-400" aria-hidden>→</span>
              <span className="font-semibold uppercase tracking-wide text-slate-500">To</span>
              <input
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                className="border border-[#C2D4E8] rounded px-2 py-1 text-xs tabular-nums focus:outline-none focus:border-[#1a5fa8] focus:ring-1 focus:ring-[#1a5fa8]"
              />
              <button
                type="button"
                onClick={refetch}
                title="Refresh"
                className="ml-1 inline-flex items-center gap-1 px-2.5 py-1 bg-[#1a5fa8] hover:bg-[#1550a0] text-white text-xs font-semibold rounded-lg transition-colors"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden>
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                Refresh
              </button>
            </div>

            <div className="h-7 w-px bg-slate-200" aria-hidden />

            <div className="flex items-center gap-2 text-xs">
              <span className="font-semibold uppercase tracking-wide text-slate-500">Status</span>
              <select
                value={statusFilter === 'all' ? 'all' : String(statusFilter)}
                onChange={(e) =>
                  setStatusFilter(
                    e.target.value === 'all' ? 'all' : Number(e.target.value),
                  )
                }
                className="border border-[#C2D4E8] rounded px-2 py-1 text-xs focus:outline-none focus:border-[#1a5fa8]"
              >
                <option value="all">All</option>
                <option value="0">Received</option>
                <option value="1">In Progress</option>
                <option value="2">Ready</option>
                {reportType === 'register' && (
                  <>
                    <option value="3">Delivered</option>
                    <option value="4">Cancelled</option>
                  </>
                )}
              </select>
            </div>
          </div>
        </section>

        <div className="hidden print:block px-2 mb-3">
          <h1 className="text-xl font-bold">
            {reportType === 'pending'
              ? 'Pending Deliveries Report'
              : 'Alteration Register'}
          </h1>
          <p className="text-sm text-slate-700">
            From <strong>{formatVoucherDate(fromDate)}</strong> to{' '}
            <strong>{formatVoucherDate(toDate)}</strong>
            {' — '}
            {data?.totalCount ?? 0} {data?.totalCount === 1 ? 'row' : 'rows'}
          </p>
        </div>

        <section
          id="alteration-report-grid"
          className="bg-white rounded-xl border border-[#C2D4E8] shadow-sm flex-1 overflow-hidden flex flex-col print:rounded-none print:border-0 print:shadow-none"
        >
          {loading ? (
            <div className="p-3">
              <div className="space-y-2">
                <Skeleton className="h-4 w-48" />
                {Array.from({ length: 6 }).map((_, i) => (
                  <SkeletonRow key={i} cols={8} />
                ))}
              </div>
            </div>
          ) : error ? (
            <div className="p-3">
              <ErrorBanner error={error} />
            </div>
          ) : visibleRows.length === 0 ? (
            <div className="p-10 text-center">
              <div className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-[#F0F6FB] text-2xl text-[#1a5fa8] mb-2">
                📋
              </div>
              <p className="text-sm text-gray-600">
                No alterations found for the selected range.
              </p>
              <p className="text-[11px] text-gray-400 mt-0.5">
                Try widening the From / To filter above.
              </p>
            </div>
          ) : (
            <div className="overflow-auto flex-1">
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-10 bg-[#F0F6FB] border-b border-[#C2D4E8] text-[10px] uppercase tracking-widest text-gray-600 font-bold">
                  <tr>
                    <th className="px-3 py-2 text-left">Voucher</th>
                    <th className="px-3 py-2 text-left">Date</th>
                    <th className="px-3 py-2 text-left">Customer</th>
                    <th className="px-3 py-2 text-left">Alteration</th>
                    <th className="px-3 py-2 text-center">Status</th>
                    <th className="px-3 py-2 text-center">Delivery</th>
                    <th className="px-3 py-2 text-right">Items</th>
                    <th className="px-3 py-2 text-right">Modified</th>
                    <th className="px-3 py-2 text-right">Not Modified</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.map((r, idx) => (
                    <tr
                      key={r.alterationQbguid}
                      className={`${
                        idx % 2 === 0 ? 'bg-white' : 'bg-[#F8FBFE]'
                      } border-b border-slate-100 hover:bg-[#F0F6FB] transition-colors`}
                    >
                      <td className="px-3 py-2 font-mono font-semibold text-[#1a5fa8]">
                        {r.voucherNo}
                      </td>
                      <td className="px-3 py-2 tabular-nums text-slate-700">
                        {formatVoucherDate(r.voucherDate)}
                      </td>
                      <td className="px-3 py-2 truncate max-w-[14rem]">
                        {r.customerName || (
                          <span className="text-slate-400 italic">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2 font-mono text-slate-700">
                        {r.alterationNo}
                      </td>
                      <td className="px-3 py-2 text-center">
                        <StatusPill status={r.status} label={r.statusLabel} />
                      </td>
                      <td className="px-3 py-2 tabular-nums text-center text-slate-700">
                        {r.earliestDeliveryDate
                          ? formatVoucherDate(r.earliestDeliveryDate)
                          : '—'}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums font-semibold">
                        {r.totalItems}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-emerald-700">
                        {r.modifiedItems}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-amber-700">
                        {r.notModifiedItems}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-[#F0F6FB] border-t-2 border-[#C2D4E8] font-bold text-slate-800">
                  <tr>
                    <td colSpan={6} className="px-3 py-2 text-right">
                      Sub Total :
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {totals.totalItems}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-emerald-700">
                      {totals.modified}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-amber-700">
                      {totals.notModified}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </section>
      </div>

      <footer className="bg-[#F0F6FB] border-t border-[#C2D4E8] px-4 py-2 flex items-center justify-between gap-3 print:hidden">
        <div className="text-[11px] text-slate-600 font-mono">
          {data && !loading && !error ? (
            <>
              Showing <strong>{visibleRows.length}</strong> of{' '}
              <strong>{data.totalCount}</strong>{' '}
              {data.totalCount === 1 ? 'row' : 'rows'}
              {' · '}
              {formatVoucherDate(data.fromDate)} → {formatVoucherDate(data.toDate)}
            </>
          ) : (
            <>&nbsp;</>
          )}
        </div>
        <div className="flex items-center gap-2">
          <ActionTile onClick={handlePrint} icon="print" label="Print" />
          <div className="relative" ref={exportMenuRef}>
            <ActionTile
              onClick={() => setExportOpen((o) => !o)}
              icon="export"
              label="Export"
              tone="orange"
              caret
            />
            {exportOpen && (
              <div className="absolute right-0 bottom-full mb-1 w-44 bg-white rounded-lg border border-[#C2D4E8] shadow-xl z-30 overflow-hidden">
                <ExportMenuItem
                  label="Excel (.xls)"
                  tone="emerald"
                  onClick={() => {
                    setExportOpen(false);
                    handleExportExcel();
                  }}
                />
                <ExportMenuItem
                  label="PDF"
                  tone="rose"
                  onClick={() => {
                    setExportOpen(false);
                    handleExportPdf();
                  }}
                />
                <ExportMenuItem
                  label="CSV"
                  tone="emerald"
                  onClick={() => {
                    setExportOpen(false);
                    handleExportCsv();
                  }}
                />
                <ExportMenuItem
                  label="HTML"
                  tone="orange"
                  onClick={() => {
                    setExportOpen(false);
                    handleExportHtml();
                  }}
                />
                <ExportMenuItem
                  label="JSON"
                  tone="slate"
                  onClick={() => {
                    setExportOpen(false);
                    handleExportJson();
                  }}
                />
              </div>
            )}
          </div>
          <ActionTile onClick={handleBack} icon="exit" label="Exit" tone="rose" />
        </div>
      </footer>
    </div>
  );
}

interface ActionTileProps {
  onClick: () => void;
  icon: 'print' | 'export' | 'exit';
  label: string;
  tone?: 'default' | 'orange' | 'rose';
  caret?: boolean;
}

function ActionTile({
  onClick,
  icon,
  label,
  tone = 'default',
  caret,
}: ActionTileProps) {
  const palette =
    tone === 'orange'
      ? 'bg-orange-500 hover:bg-orange-600 text-white border-orange-500'
      : tone === 'rose'
        ? 'bg-white hover:bg-rose-50 text-rose-700 border-rose-200'
        : 'bg-white hover:bg-[#E8F0F8] text-[#1a5276] border-[#8BAFC8]';
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      className={`w-16 h-14 flex flex-col items-center justify-center gap-0.5 rounded-lg border transition-colors shadow-sm ${palette}`}
    >
      <ActionIcon kind={icon} caret={caret} />
      <span className="text-[10px] font-bold uppercase tracking-wide leading-none">
        {label}
      </span>
    </button>
  );
}

function ActionIcon({
  kind,
  caret,
}: {
  kind: 'print' | 'export' | 'exit';
  caret?: boolean;
}) {
  if (kind === 'print') {
    return (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden>
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
      </svg>
    );
  }
  if (kind === 'export') {
    return (
      <span className="inline-flex items-center gap-0.5">
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5 5-5M12 15V3" />
        </svg>
        {caret && (
          <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden>
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
          </svg>
        )}
      </span>
    );
  }
  return (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
    </svg>
  );
}

interface ReportTabProps {
  label: string;
  active: boolean;
  onClick: () => void;
}

function ReportTab({ label, active, onClick }: ReportTabProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
        active
          ? 'bg-white text-[#1a5fa8] shadow-sm'
          : 'text-slate-600 hover:text-slate-900'
      }`}
    >
      {label}
    </button>
  );
}

interface ExportMenuItemProps {
  label: string;
  tone: 'emerald' | 'rose' | 'orange' | 'slate';
  onClick: () => void;
}

function ExportMenuItem({ label, tone, onClick }: ExportMenuItemProps) {
  const palette: Record<ExportMenuItemProps['tone'], string> = {
    emerald: 'text-emerald-700',
    rose: 'text-rose-700',
    orange: 'text-orange-700',
    slate: 'text-slate-700',
  };
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full flex items-center gap-2 px-3 py-2 text-xs font-semibold text-left hover:bg-[#F0F6FB] transition-colors"
    >
      <span
        className={`inline-flex w-6 h-6 items-center justify-center rounded ${palette[tone]} bg-current/10`}
        aria-hidden
      >
        <span className={palette[tone]}>↓</span>
      </span>
      <span className="text-slate-800">{label}</span>
    </button>
  );
}

interface StatusPillProps {
  status: number;
  label: string;
}

const STATUS_PILL: Record<number, { wrap: string; dot: string }> = {
  0: { wrap: 'bg-yellow-100 text-yellow-800', dot: 'bg-yellow-500' },
  1: { wrap: 'bg-blue-100 text-blue-800', dot: 'bg-blue-500' },
  2: { wrap: 'bg-violet-100 text-violet-800', dot: 'bg-violet-500' },
  3: { wrap: 'bg-emerald-100 text-emerald-800', dot: 'bg-emerald-500' },
  4: { wrap: 'bg-rose-100 text-rose-800', dot: 'bg-rose-500' },
};

function StatusPill({ status, label }: StatusPillProps) {
  const cfg = STATUS_PILL[status] ?? {
    wrap: 'bg-slate-100 text-slate-700',
    dot: 'bg-slate-400',
  };
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${cfg.wrap}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${cfg.dot}`} aria-hidden />
      {label}
    </span>
  );
}

function csvEscape(value: string | number | null | undefined): string {
  const s = value === null || value === undefined ? '' : String(value);
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function downloadBlob(content: string, filename: string, mime: string) {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function renderExcelHtml(
  type: ReportType,
  fromDate: string,
  toDate: string,
  rows: ReportRow[],
): string {
  const title =
    type === 'pending' ? 'Pending Deliveries' : 'Alteration Register';
  const totals = rows.reduce(
    (acc, r) => {
      acc.total += r.totalItems;
      acc.mod += r.modifiedItems;
      acc.notMod += r.notModifiedItems;
      acc.recv += r.receivedItems;
      acc.ip += r.inProgressItems;
      acc.rdy += r.readyItems;
      acc.dlv += r.deliveredItems;
      return acc;
    },
    { total: 0, mod: 0, notMod: 0, recv: 0, ip: 0, rdy: 0, dlv: 0 },
  );
  const headers = [
    'Document No',
    'Alteration No',
    'Voucher Date',
    'Customer',
    'Voucher Type',
    'Status',
    'Earliest Delivery',
    'Total Items',
    'Modified',
    'Not Modified',
    'Received',
    'In Progress',
    'Ready',
    'Delivered',
  ];
  const headerHtml = headers
    .map(
      (h) =>
        `<th style="background:#1a5fa8;color:#fff;font-weight:bold;padding:6px 10px;border:1px solid #c2d4e8">${escapeHtml(h)}</th>`,
    )
    .join('');
  const bodyHtml = rows
    .map(
      (r) => `<tr>
    <td>${escapeHtml(r.voucherNo)}</td>
    <td>${escapeHtml(r.alterationNo)}</td>
    <td>${escapeHtml(formatVoucherDate(r.voucherDate))}</td>
    <td>${escapeHtml(r.customerName)}</td>
    <td>${escapeHtml(r.voucherTypeName)}</td>
    <td>${escapeHtml(r.statusLabel)}</td>
    <td>${escapeHtml(r.earliestDeliveryDate ? formatVoucherDate(r.earliestDeliveryDate) : '')}</td>
    <td style="text-align:right">${r.totalItems}</td>
    <td style="text-align:right">${r.modifiedItems}</td>
    <td style="text-align:right">${r.notModifiedItems}</td>
    <td style="text-align:right">${r.receivedItems}</td>
    <td style="text-align:right">${r.inProgressItems}</td>
    <td style="text-align:right">${r.readyItems}</td>
    <td style="text-align:right">${r.deliveredItems}</td>
  </tr>`,
    )
    .join('');
  return `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel">
<head>
<meta charset="utf-8">
<!--[if gte mso 9]><xml>
<x:ExcelWorkbook><x:ExcelWorksheets><x:ExcelWorksheet>
<x:Name>${escapeHtml(title)}</x:Name>
<x:WorksheetOptions><x:DisplayGridlines/></x:WorksheetOptions>
</x:ExcelWorksheet></x:ExcelWorksheets></x:ExcelWorkbook>
</xml><![endif]-->
<style>
  table{border-collapse:collapse;font-family:Calibri,Arial,sans-serif;font-size:11pt}
  td{padding:5px 10px;border:1px solid #c2d4e8;vertical-align:middle}
</style>
</head>
<body>
<h2 style="font-family:Calibri,Arial,sans-serif;color:#1a5276;margin:0 0 4px">${escapeHtml(title)}</h2>
<p style="font-family:Calibri,Arial,sans-serif;font-size:10pt;color:#666;margin:0 0 12px">
  From ${escapeHtml(fromDate)} to ${escapeHtml(toDate)} — ${rows.length} ${rows.length === 1 ? 'row' : 'rows'}
</p>
<table>
<thead><tr>${headerHtml}</tr></thead>
<tbody>${bodyHtml}</tbody>
<tfoot><tr style="font-weight:bold;background:#f0f6fb">
  <td colspan="7" style="text-align:right">Sub Total:</td>
  <td style="text-align:right">${totals.total}</td>
  <td style="text-align:right">${totals.mod}</td>
  <td style="text-align:right">${totals.notMod}</td>
  <td style="text-align:right">${totals.recv}</td>
  <td style="text-align:right">${totals.ip}</td>
  <td style="text-align:right">${totals.rdy}</td>
  <td style="text-align:right">${totals.dlv}</td>
</tr></tfoot>
</table>
</body></html>`;
}

function renderHtmlReport(
  type: ReportType,
  fromDate: string,
  toDate: string,
  rows: ReportRow[],
): string {
  const title =
    type === 'pending' ? 'Pending Deliveries Report' : 'Alteration Register';
  const head = `<!doctype html>
<html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>
  body{font-family:system-ui,sans-serif;padding:24px;color:#222}
  h1{margin:0 0 4px;font-size:20px}
  p{margin:0 0 16px;color:#666;font-size:13px}
  table{width:100%;border-collapse:collapse;font-size:12px}
  th,td{padding:6px 10px;border-bottom:1px solid #e5e7eb;text-align:left}
  th{background:#f3f4f6;text-transform:uppercase;font-size:10px;letter-spacing:.05em}
  td.num{text-align:right;font-variant-numeric:tabular-nums}
  tfoot td{font-weight:bold;border-top:2px solid #c2d4e8}
</style></head><body>`;
  const headerRow = `<h1>${escapeHtml(title)}</h1>
<p>From ${escapeHtml(fromDate)} to ${escapeHtml(toDate)} — ${rows.length} ${rows.length === 1 ? 'row' : 'rows'}</p>`;
  const tableHead = `<table><thead><tr>
    <th>Voucher</th><th>Date</th><th>Customer</th><th>Alteration</th>
    <th>Status</th><th>Delivery</th><th>Items</th><th>Modified</th><th>Not Modified</th>
  </tr></thead><tbody>`;
  const body = rows
    .map(
      (r) => `<tr>
    <td>${escapeHtml(r.voucherNo)}</td>
    <td>${escapeHtml(r.voucherDate)}</td>
    <td>${escapeHtml(r.customerName)}</td>
    <td>${escapeHtml(r.alterationNo)}</td>
    <td>${escapeHtml(r.statusLabel)}</td>
    <td>${escapeHtml(r.earliestDeliveryDate ?? '')}</td>
    <td class="num">${r.totalItems}</td>
    <td class="num">${r.modifiedItems}</td>
    <td class="num">${r.notModifiedItems}</td>
  </tr>`,
    )
    .join('');
  const totals = rows.reduce(
    (acc, r) => {
      acc.total += r.totalItems;
      acc.mod += r.modifiedItems;
      acc.notMod += r.notModifiedItems;
      return acc;
    },
    { total: 0, mod: 0, notMod: 0 },
  );
  const foot = `</tbody><tfoot><tr>
    <td colspan="6" style="text-align:right">Sub Total:</td>
    <td class="num">${totals.total}</td>
    <td class="num">${totals.mod}</td>
    <td class="num">${totals.notMod}</td>
  </tr></tfoot></table></body></html>`;
  return head + headerRow + tableHead + body + foot;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
