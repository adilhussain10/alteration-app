import { useState } from 'react';
import type { AlterationItem } from './alteration';
import { formatQty } from './formatters';
import { validateAlterQty } from './useAlterationForm';
import type { ItemAlteration } from './useAlterationForm';
import { useToast } from '../../components/Toast';
import { api } from '../../api/client';

function todayIso(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function computeDeliveryWarning(
  deliveryDate: string,
  voucherDate?: string | undefined,
): string | null {
  const d = deliveryDate.trim();
  if (d === '') return null;
  if (d < todayIso()) return 'Delivery date is in the past';
  if (voucherDate) {
    const vIso = voucherDate.slice(0, 10);
    if (vIso && d < vIso) return 'Delivery date is before the voucher date';
  }
  return null;
}

interface AlterationItemsGridProps {
  items: AlterationItem[];
  getAlteration: (itemQbguid: string) => ItemAlteration;
  onToggleAlterRequired: (itemQbguid: string, defaultQty: number) => void;
  onPatchAlteration: (itemQbguid: string, patch: Partial<ItemAlteration>) => void;
  onSetAllRequired: (
    items: Array<{ qbguid: string; docQty: number }>,
    required: boolean,
  ) => void;
  onApplyToChecked: (patch: Partial<ItemAlteration>) => void;
  alterationQbguid?: string | undefined;
  currentStatus?: number | undefined;
  onStatusChanged?: (() => void) | undefined;
  onTerminalStatusReached?: ((status: number) => void) | undefined;
  voucherDate?: string | undefined;
}

export function AlterationItemsGrid({
  items,
  getAlteration,
  onToggleAlterRequired,
  onPatchAlteration,
  onSetAllRequired,
  onApplyToChecked,
  alterationQbguid,
  currentStatus,
  onStatusChanged,
  onTerminalStatusReached,
  voucherDate,
}: AlterationItemsGridProps) {
  const toast = useToast();
  const [search, setSearch] = useState('');
  const docSaved = !!alterationQbguid && currentStatus !== undefined;
  const docTerminal = currentStatus === 3 || currentStatus === 4;
  const statusEditable = docSaved && !docTerminal;

  type PatchResult = { ok: true } | { ok: false; error: string };

  function friendlyPatchError(raw: string): string {
    if (
      /item is not part of this alteration|ITEM_NOT_LINKED|alteration not found/i.test(raw)
    ) {
      return "This item isn't saved as part of the alteration yet. Click Save first, then update its status.";
    }
    return raw;
  }

  async function patchItemStatus(
    itemQbguid: string,
    next: number,
  ): Promise<PatchResult> {
    if (!alterationQbguid) {
      return { ok: false, error: 'Save the alteration first.' };
    }
    try {
      await api.patch(
        `/api/alterations/${encodeURIComponent(alterationQbguid)}/items/${encodeURIComponent(itemQbguid)}/status`,
        { status: next },
      );
      onPatchAlteration(itemQbguid, { itemStatus: next });
      return { ok: true };
    } catch (e) {
      const raw = e instanceof Error ? e.message : 'Please try again.';
      return { ok: false, error: friendlyPatchError(raw) };
    }
  }

  async function handleRowStatusChange(itemQbguid: string, next: number) {
    const alt = getAlteration(itemQbguid);
    if (alt.remarks.trim() === '') {
      toast.push({
        tone: 'error',
        title: 'Remark required',
        message: 'Add a remark for this item before updating its status.',
        duration: 3000,
      });
      return;
    }
    const result = await patchItemStatus(itemQbguid, next);
    if (result.ok) {
      const label = STATUS_OPTIONS.find((s) => s.value === next)?.label ?? '';
      toast.push({
        tone: 'success',
        title: `Item set to ${label}`,
        duration: 1600,
      });
      if (onStatusChanged) onStatusChanged();
    } else {
      toast.push({
        tone: 'error',
        title: 'Could not update item status',
        message: result.error,
      });
    }
  }

  async function applyStatusToChecked(next: number) {
    if (!alterationQbguid) return;
    const targets = items.filter((it) => getAlteration(it.qbguid).alterRequired);
    if (targets.length === 0) {
      toast.push({
        tone: 'info',
        title: 'No items selected',
        message: 'Tick the items first.',
        duration: 2000,
      });
      return;
    }
    const missingRemarks = targets.filter(
      (it) => getAlteration(it.qbguid).remarks.trim() === '',
    );
    if (missingRemarks.length > 0) {
      const list = missingRemarks
        .map((it) => it.stockNo || `#${it.serialNo}`)
        .slice(0, 5)
        .join(', ');
      const more =
        missingRemarks.length > 5 ? ` and ${missingRemarks.length - 5} more` : '';
      toast.push({
        tone: 'error',
        title: `Remarks required for ${missingRemarks.length} ${missingRemarks.length === 1 ? 'item' : 'items'}`,
        message: `Add a remark before updating status: ${list}${more}.`,
        duration: 4000,
      });
      return;
    }
    const results: PatchResult[] = [];
    for (const it of targets) {
      results.push(await patchItemStatus(it.qbguid, next));
    }
    const succeeded = results.filter((r) => r.ok).length;
    const failed = results.length - succeeded;
    if (failed > 0) {
      const firstFailure = results.find(
        (r): r is { ok: false; error: string } => !r.ok,
      );
      toast.push({
        tone: 'error',
        title: `Could not update ${failed} ${failed === 1 ? 'item' : 'items'}`,
        message: firstFailure?.error ?? 'Please try again.',
      });
    }
    if (onStatusChanged) onStatusChanged();
    if (succeeded === targets.length && (next === 3 || next === 4)) {
      onTerminalStatusReached?.(next);
    }
  }

  async function handleCopyStatusToAll() {
    if (currentStatus === undefined) return;
    await applyStatusToChecked(currentStatus);
  }

  let checkedCount = 0;
  for (const it of items) {
    if (getAlteration(it.qbguid).alterRequired) checkedCount++;
  }
  const allChecked = items.length > 0 && checkedCount === items.length;
  const someChecked = checkedCount > 0 && checkedCount < items.length;

  const q = search.trim().toLowerCase();
  const visibleItems = q
    ? items.filter(
        (it) =>
          (it.stockNo ?? '').toLowerCase().includes(q) ||
          (it.itemDescription ?? '').toLowerCase().includes(q),
      )
    : items;

  function handleToggleAll() {
    onSetAllRequired(
      items.map((it) => ({ qbguid: it.qbguid, docQty: it.docQty })),
      !allChecked,
    );
  }

  return (
    <section className="bg-white rounded-xl border border-[#C2D4E8] shadow-sm overflow-hidden flex flex-col flex-1 min-h-0">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-[#E8EEF4] bg-[#F8FBFE] flex-shrink-0 gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-7 h-7 bg-[#1a5fa8]/10 rounded-lg flex items-center justify-center shrink-0">
            <svg className="w-4 h-4 text-[#1a5fa8]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
          </div>
          <span className="text-sm font-semibold text-gray-700">Items</span>
          <span className="bg-[#1a5fa8] text-white text-xs px-2.5 py-0.5 rounded-full font-bold tabular-nums">
            {q ? `${visibleItems.length}/${items.length}` : items.length}
          </span>
          {currentStatus !== undefined && (
            <>
              <span className="text-gray-300 text-xs" aria-hidden>•</span>
              <DocStatusChip status={currentStatus} />
            </>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {items.length > 5 && (
            <div className="relative">
              <svg className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-400 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search items…"
                className="w-40 h-7 pl-7 pr-2 text-xs border border-[#C2D4E8] rounded focus:outline-none focus:border-[#1a5fa8] focus:ring-1 focus:ring-[#1a5fa8]"
              />
            </div>
          )}
        </div>
      </div>

      {docTerminal && (
        <div
          className={`flex items-center gap-2 px-4 py-2 border-b text-sm ${
            currentStatus === 3
              ? 'bg-slate-50 border-slate-200 text-slate-700'
              : 'bg-rose-50 border-rose-200 text-rose-700'
          }`}
        >
          <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden>
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d={
                currentStatus === 3
                  ? 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z'
                  : 'M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z'
              }
            />
          </svg>
          <span className="font-semibold">
            {currentStatus === 3 ? 'Delivered' : 'Cancelled'}
          </span>
          <span className="text-xs opacity-75">— no further changes allowed.</span>
        </div>
      )}

      {!docTerminal && checkedCount > 0 && (
        <BulkActionBar
          checkedCount={checkedCount}
          onApply={onApplyToChecked}
          onApplyStatus={applyStatusToChecked}
          statusEditable={statusEditable}
          initialDate={commonCheckedDate(items, getAlteration)}
          initialStatus={commonCheckedStatus(items, getAlteration)}
        />
      )}

      {items.length === 0 ? (
        <p className="px-4 py-4 text-sm text-gray-500">
          This voucher has no active items.
        </p>
      ) : (
        <div className="flex-1 min-h-0 overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10">
              <tr className="bg-[#F0F6FB] border-b border-[#C2D4E8] text-left text-[10px] uppercase tracking-widest text-gray-500 font-semibold">
                <th className="px-3 py-2.5 w-12">#</th>
                <th className="px-2 py-2.5 w-10 text-center">
                  <label
                    className="inline-flex items-center justify-center"
                    title={
                      docTerminal
                        ? 'Alteration is finalized'
                        : allChecked
                          ? 'Clear all'
                          : 'Select all'
                    }
                  >
                    <input
                      type="checkbox"
                      checked={allChecked}
                      ref={(el) => {
                        if (el) el.indeterminate = someChecked;
                      }}
                      onChange={handleToggleAll}
                      disabled={docTerminal}
                      className="w-4 h-4 accent-[#1a5fa8] cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
                    />
                  </label>
                </th>
                <th className="px-2 py-2.5">Stock No.</th>
                <th className="px-2 py-2.5">Description</th>
                <th className="px-3 py-2.5 w-24 text-right">Qty</th>
                <th className="px-2 py-2.5 w-40">
                  <div className="flex items-center gap-1.5">
                    <span>Status</span>
                    {statusEditable && checkedCount > 0 && (
                      <button
                        type="button"
                        onClick={handleCopyStatusToAll}
                        title="Copy header status to all altered items"
                        className="text-[10px] font-semibold normal-case bg-[#1a5fa8] text-white px-2 py-0.5 rounded-full hover:bg-[#1550a0] transition-colors"
                      >
                        Copy All
                      </button>
                    )}
                  </div>
                </th>
              </tr>
            </thead>
            <tbody>
              {visibleItems.map((item, idx) => {
                const alt = getAlteration(item.qbguid);
                const effective =
                  alt.itemStatus !== undefined ? alt.itemStatus : currentStatus;
                return (
                  <ItemRow
                    key={item.qbguid}
                    item={item}
                    alteration={alt}
                    onToggle={() => onToggleAlterRequired(item.qbguid, item.docQty)}
                    onPatch={(patch) => onPatchAlteration(item.qbguid, patch)}
                    zebra={idx % 2 === 0}
                    effectiveItemStatus={effective}
                    statusEditable={statusEditable}
                    onItemStatusChange={(next) =>
                      void handleRowStatusChange(item.qbguid, next)
                    }
                    voucherDate={voucherDate}
                    readOnly={docTerminal}
                  />
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

interface BulkActionBarProps {
  checkedCount: number;
  onApply: (patch: Partial<ItemAlteration>) => void;
  onApplyStatus: (next: number) => void | Promise<void>;
  statusEditable: boolean;
  initialDate?: string;
  initialStatus?: number | undefined;
}

function commonCheckedDate(
  items: AlterationItem[],
  getAlteration: (qbguid: string) => ItemAlteration,
): string {
  const dates: string[] = [];
  for (const it of items) {
    const alt = getAlteration(it.qbguid);
    if (alt.alterRequired) dates.push(alt.deliveryDate);
  }
  if (dates.length === 0) return '';
  const first = dates[0];
  if (!first) return '';
  return dates.every((d) => d === first) ? first : '';
}

function commonCheckedStatus(
  items: AlterationItem[],
  getAlteration: (qbguid: string) => ItemAlteration,
): number | undefined {
  const statuses: Array<number | undefined> = [];
  for (const it of items) {
    const alt = getAlteration(it.qbguid);
    if (alt.alterRequired) statuses.push(alt.itemStatus);
  }
  if (statuses.length === 0) return undefined;
  const first = statuses[0];
  if (first === undefined) return undefined;
  return statuses.every((s) => s === first) ? first : undefined;
}

const STATUS_OPTIONS: Array<{ value: number; label: string }> = [
  { value: 0, label: 'Received' },
  { value: 1, label: 'In Progress' },
  { value: 2, label: 'Ready' },
  { value: 3, label: 'Delivered' },
  { value: 4, label: 'Cancelled' },
];

function BulkActionBar({
  checkedCount,
  onApply,
  onApplyStatus,
  statusEditable,
  initialDate,
  initialStatus,
}: BulkActionBarProps) {
  const [bulkDeliveryDate, setBulkDeliveryDate] = useState(initialDate ?? '');
  const [bulkStatus, setBulkStatus] = useState(
    initialStatus !== undefined ? String(initialStatus) : '',
  );

  function handleApply() {
    if (bulkDeliveryDate !== '') {
      onApply({ deliveryDate: bulkDeliveryDate });
    }
    if (bulkStatus !== '' && statusEditable) {
      void onApplyStatus(Number(bulkStatus));
    }
  }

  const canApply =
    bulkDeliveryDate !== '' || (bulkStatus !== '' && statusEditable);

  return (
    <div className="flex items-center gap-3 px-4 py-2 bg-[#FFFBEB] border-b border-amber-100 flex-wrap">
      <span className="text-xs font-semibold text-amber-700 flex-shrink-0">
        Apply to {checkedCount} selected
      </span>
      <span className="text-[10px] uppercase tracking-wide text-amber-600 flex-shrink-0">
        Common Date
      </span>
      <input
        type="date"
        value={bulkDeliveryDate}
        onChange={(e) => setBulkDeliveryDate(e.target.value)}
        min={todayIso()}
        className="h-7 text-xs border border-amber-200 bg-white rounded-lg px-2 focus:outline-none focus:border-[#1a5fa8] text-gray-900"
      />
      {statusEditable && (
        <>
          <span className="text-[10px] uppercase tracking-wide text-amber-600 flex-shrink-0">
            Common Status
          </span>
          <select
            value={bulkStatus}
            onChange={(e) => setBulkStatus(e.target.value)}
            className="h-7 text-xs border border-amber-200 bg-white rounded-lg px-2 focus:outline-none focus:border-[#1a5fa8] text-gray-900"
          >
            <option value="">—</option>
            {STATUS_OPTIONS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </>
      )}
      <button
        type="button"
        onClick={handleApply}
        disabled={!canApply}
        className="px-3 py-1.5 bg-[#1a5fa8] hover:bg-[#1550a0] text-white text-xs font-semibold rounded-lg transition-colors flex-shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        Apply
      </button>
    </div>
  );
}

const DOC_STATUS_PILL: Record<number, { wrap: string; dot: string; label: string }> = {
  0: { wrap: 'bg-amber-100 text-amber-800 ring-amber-200', dot: 'bg-amber-500', label: 'Received' },
  1: { wrap: 'bg-blue-100 text-blue-800 ring-blue-200', dot: 'bg-blue-500', label: 'In Progress' },
  2: { wrap: 'bg-emerald-100 text-emerald-800 ring-emerald-200', dot: 'bg-emerald-500', label: 'Ready' },
  3: { wrap: 'bg-slate-200 text-slate-700 ring-slate-300', dot: 'bg-slate-500', label: 'Delivered' },
  4: { wrap: 'bg-rose-100 text-rose-800 ring-rose-200', dot: 'bg-rose-500', label: 'Cancelled' },
};

function DocStatusChip({ status }: { status: number }) {
  const cfg = DOC_STATUS_PILL[status];
  if (!cfg) return null;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ring-inset ${cfg.wrap}`}
      title={`Alteration status: ${cfg.label}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${cfg.dot}`} aria-hidden />
      {cfg.label}
    </span>
  );
}

interface ItemRowProps {
  item: AlterationItem;
  alteration: ItemAlteration;
  onToggle: () => void;
  onPatch: (patch: Partial<ItemAlteration>) => void;
  zebra?: boolean;
  effectiveItemStatus?: number | undefined;
  statusEditable?: boolean;
  onItemStatusChange?: ((next: number) => void) | undefined;
  voucherDate?: string | undefined;
  readOnly?: boolean;
}

function ItemRow({
  item,
  alteration,
  onToggle,
  onPatch,
  zebra = false,
  effectiveItemStatus,
  statusEditable = false,
  onItemStatusChange,
  voucherDate,
  readOnly = false,
}: ItemRowProps) {
  const checked = alteration.alterRequired;
  const baseBg = checked
    ? 'bg-[#FFFBEB]'
    : zebra
      ? 'bg-white'
      : 'bg-[#F8FBFE]';
  return (
    <>
      <tr
        className={`${baseBg} ${
          checked ? '' : 'hover:bg-[#F8FBFE]'
        } transition-colors border-b border-slate-100 group`}
      >
        <td className="px-3 py-2.5 align-middle relative">
          {checked && (
            <span
              className="absolute inset-y-0 left-0 w-[3px] bg-gradient-to-b from-amber-400 to-amber-600 shadow-[0_0_6px_rgba(245,158,11,0.5)]"
              aria-hidden
            />
          )}
          <span
            className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold tabular-nums ring-1 ring-inset ${
              checked
                ? 'bg-amber-100 text-amber-800 ring-amber-300'
                : 'bg-slate-100 text-slate-600 ring-slate-200'
            }`}
          >
            {item.serialNo}
          </span>
        </td>
        <td className="px-2 py-2.5 w-10 align-middle text-center">
          <input
            type="checkbox"
            checked={checked}
            onChange={onToggle}
            disabled={readOnly}
            title={readOnly ? 'Alteration is finalized' : undefined}
            className="w-4 h-4 accent-[#1a5fa8] cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
            aria-label={`Alter item ${item.serialNo}`}
          />
        </td>
        <td className="px-2 py-2.5 align-middle font-mono text-sm font-semibold text-[#1a5fa8]">
          {item.stockNo || '—'}
        </td>
        <td className="px-2 py-2.5 align-middle text-sm font-medium text-slate-800 truncate">
          {item.itemDescription || (
            <span className="text-gray-400 italic font-normal">—</span>
          )}
        </td>
        <td className="px-3 py-2.5 align-middle text-right">
          <span className="inline-flex items-center justify-center min-w-[2rem] px-2 py-0.5 rounded bg-slate-100 text-slate-800 font-mono tabular-nums text-sm font-semibold ring-1 ring-inset ring-slate-200">
            {formatQty(item.docQty)}
          </span>
        </td>
        <td className="px-2 py-2.5 align-middle">
          {checked ? (
            <select
              value={
                effectiveItemStatus !== undefined
                  ? String(effectiveItemStatus)
                  : ''
              }
              disabled={!statusEditable}
              title={
                statusEditable
                  ? undefined
                  : 'Save the alteration first before updating status'
              }
              onChange={(e) => onItemStatusChange?.(Number(e.target.value))}
              className="text-xs border border-[#C2D4E8] rounded-full px-2 py-0.5 bg-white text-gray-900 focus:border-[#1a5fa8] focus:outline-none disabled:bg-gray-50 disabled:text-gray-400 disabled:cursor-not-allowed"
            >
              <option value="">—</option>
              {STATUS_OPTIONS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          ) : (
            <span className="text-gray-400">—</span>
          )}
        </td>
      </tr>
      {checked && (
        <tr className="bg-[#FFFBEB] border-t border-b border-yellow-100">
          <td colSpan={6} className="px-4 py-3">
            <AlterationFields
              docQty={item.docQty}
              alteration={alteration}
              onPatch={onPatch}
              voucherDate={voucherDate}
              readOnly={readOnly}
            />
          </td>
        </tr>
      )}
    </>
  );
}

interface AlterationFieldsProps {
  docQty: number;
  alteration: ItemAlteration;
  onPatch: (patch: Partial<ItemAlteration>) => void;
  voucherDate?: string | undefined;
  readOnly?: boolean;
}

function AlterationFields({
  docQty,
  alteration,
  onPatch,
  voucherDate,
  readOnly = false,
}: AlterationFieldsProps) {
  const validation = validateAlterQty(alteration.alterQty, docQty);
  const deliveryWarning = computeDeliveryWarning(
    alteration.deliveryDate,
    voucherDate,
  );

  const baseInput =
    'block w-full h-7 text-sm border rounded px-2 focus:outline-none focus:ring-1 disabled:bg-gray-50 disabled:text-gray-500 disabled:cursor-not-allowed';
  const okInput =
    'border-[#C2D4E8] text-gray-900 focus:border-[#1a5fa8] focus:ring-[#1a5fa8] bg-white';
  const errInput =
    'border-rose-400 text-rose-900 focus:border-rose-500 focus:ring-rose-500 bg-white';
  const lockTitle = readOnly ? 'Alteration is finalized' : undefined;

  return (
    <div className="flex items-start gap-2">
      <label className="block shrink-0 w-20">
        <span className="text-[10px] uppercase tracking-wide text-gray-400 font-medium mb-0.5 block">
          Alter Qty
        </span>
        <input
          type="text"
          inputMode="numeric"
          value={alteration.alterQty}
          onChange={(e) => onPatch({ alterQty: e.target.value })}
          aria-invalid={!validation.ok}
          aria-describedby={`alter-qty-help-${docQty}`}
          disabled={readOnly}
          title={lockTitle}
          className={`block w-full h-7 text-sm border rounded px-2 text-right tabular-nums font-mono focus:outline-none focus:ring-1 disabled:bg-gray-50 disabled:text-gray-500 disabled:cursor-not-allowed ${
            validation.ok ? okInput : errInput
          }`}
        />
        <span
          id={`alter-qty-help-${docQty}`}
          className={`mt-0.5 block text-[10px] ${
            validation.ok ? 'text-slate-500' : 'text-rose-600'
          }`}
        >
          {validation.ok ? `Original: ${formatQty(docQty)}` : validation.error}
        </span>
      </label>

      <label className="block flex-1 min-w-0">
        <span className="text-[10px] uppercase tracking-wide text-gray-400 font-medium mb-0.5 block">
          Remarks <span className="text-rose-500">*</span>
        </span>
        <input
          type="text"
          value={alteration.remarks}
          onChange={(e) => onPatch({ remarks: e.target.value })}
          maxLength={256}
          placeholder="Required for status updates"
          disabled={readOnly}
          title={lockTitle}
          className={`${baseInput} ${okInput} placeholder-slate-400`}
        />
      </label>

      <label className="block shrink-0 w-32">
        <span className="text-[10px] uppercase tracking-wide text-gray-400 font-medium mb-0.5 block">
          Delivery Date
        </span>
        <input
          type="date"
          value={alteration.deliveryDate}
          onChange={(e) => onPatch({ deliveryDate: e.target.value })}
          disabled={readOnly}
          title={lockTitle}
          className={`block w-full h-7 text-sm border rounded px-2 text-right tabular-nums font-mono focus:outline-none focus:ring-1 disabled:bg-gray-50 disabled:text-gray-500 disabled:cursor-not-allowed ${okInput}`}
        />
        {deliveryWarning && !readOnly && (
          <p className="text-[11px] text-amber-500 mt-0.5 flex items-center gap-1">
            <span>⚠</span> {deliveryWarning}
          </p>
        )}
      </label>
    </div>
  );
}
