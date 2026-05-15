import { useCallback, useState } from 'react';
import type { AlterationItem } from './alteration';

export interface ItemAlteration {
  alterRequired: boolean;
  alterQty: string;
  remarks: string;
  deliveryDate: string;
  itemStatus?: number | undefined;
}

export interface AlterQtyValidation {
  ok: boolean;
  error: string;
}

export interface FormSnapshot {
  internalRefNo: string;
  itemAlterations: Map<string, ItemAlteration>;
}

export function validateDeliveryDate(raw: string): AlterQtyValidation {
  const trimmed = raw.trim();
  if (trimmed === '') return { ok: true, error: '' };
  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, '0');
  const dd = String(today.getDate()).padStart(2, '0');
  const todayStr = `${yyyy}-${mm}-${dd}`;
  if (trimmed < todayStr) {
    return { ok: false, error: 'Delivery date cannot be earlier than today' };
  }
  return { ok: true, error: '' };
}

export function validateAlterQty(raw: string, docQty: number): AlterQtyValidation {
  const trimmed = raw.trim();
  if (trimmed === '') return { ok: false, error: 'Required' };
  const n = Number(trimmed);
  if (isNaN(n)) return { ok: false, error: 'Must be a number' };
  if (n <= 0) return { ok: false, error: 'Must be greater than zero' };
  if (!Number.isInteger(n)) return { ok: false, error: 'Must be a whole number' };
  if (n > docQty) return { ok: false, error: 'Cannot exceed original quantity' };
  return { ok: true, error: '' };
}

interface UseAlterationFormResult {
  internalRefNo: string;
  setInternalRefNo: (v: string) => void;
  getItemAlteration: (itemQbguid: string) => ItemAlteration;
  patchItemAlteration: (itemQbguid: string, patch: Partial<ItemAlteration>) => void;
  toggleAlterRequired: (itemQbguid: string, defaultQty: number) => void;
  setAllRequired: (
    items: Array<{ qbguid: string; docQty: number }>,
    required: boolean,
  ) => void;
  applyToChecked: (patch: Partial<ItemAlteration>) => void;
  clear: () => void;
  snapshot: () => FormSnapshot;
  restore: (snap: FormSnapshot) => void;
  loadExisting: (
    internalRefNo: string,
    alteredItems: Array<{
      voucherItemGuid: string;
      alterationQty: number;
      remarks: string;
      deliveryDate: string;
      itemStatus?: number;
    }>,
  ) => void;
  dirty: boolean;
  markClean: () => void;
}

const DEFAULT_ITEM_ALTERATION: ItemAlteration = {
  alterRequired: false,
  alterQty: '',
  remarks: '',
  deliveryDate: '',
};

export function useAlterationForm(_items: AlterationItem[]): UseAlterationFormResult {
  const [internalRefNo, setInternalRefNoState] = useState('');
  const [itemAlterations, setItemAlterations] = useState<Map<string, ItemAlteration>>(
    new Map(),
  );
  const [dirty, setDirty] = useState(false);

  const setInternalRefNo = useCallback((v: string) => {
    setInternalRefNoState(v);
    setDirty(true);
  }, []);

  const getItemAlteration = useCallback(
    (qbguid: string): ItemAlteration => {
      return itemAlterations.get(qbguid) ?? DEFAULT_ITEM_ALTERATION;
    },
    [itemAlterations],
  );

  const patchItemAlteration = useCallback(
    (qbguid: string, patch: Partial<ItemAlteration>) => {
      setItemAlterations((prev) => {
        const current = prev.get(qbguid) ?? DEFAULT_ITEM_ALTERATION;
        const next = new Map(prev);
        next.set(qbguid, { ...current, ...patch });
        return next;
      });
      setDirty(true);
    },
    [],
  );

  const toggleAlterRequired = useCallback(
    (qbguid: string, defaultQty: number) => {
      setItemAlterations((prev) => {
        const current = prev.get(qbguid) ?? DEFAULT_ITEM_ALTERATION;
        const next = new Map(prev);
        const becomingRequired = !current.alterRequired;
        const newAlterQty =
          becomingRequired && current.alterQty.trim() === ''
            ? String(Math.trunc(defaultQty))
            : current.alterQty;
        next.set(qbguid, {
          ...current,
          alterRequired: becomingRequired,
          alterQty: newAlterQty,
        });
        return next;
      });
      setDirty(true);
    },
    [],
  );

  const setAllRequired = useCallback(
    (
      items: Array<{ qbguid: string; docQty: number }>,
      required: boolean,
    ) => {
      setItemAlterations((prev) => {
        const next = new Map(prev);
        for (const it of items) {
          const current = next.get(it.qbguid) ?? DEFAULT_ITEM_ALTERATION;
          const nextQty =
            required && current.alterQty.trim() === ''
              ? String(Math.trunc(it.docQty))
              : current.alterQty;
          next.set(it.qbguid, {
            ...current,
            alterRequired: required,
            alterQty: nextQty,
          });
        }
        return next;
      });
      setDirty(true);
    },
    [],
  );

  const applyToChecked = useCallback((patch: Partial<ItemAlteration>) => {
    setItemAlterations((prev) => {
      const next = new Map(prev);
      for (const [k, v] of prev) {
        if (!v.alterRequired) continue;
        next.set(k, { ...v, ...patch });
      }
      return next;
    });
    setDirty(true);
  }, []);

  const clear = useCallback(() => {
    setInternalRefNoState('');
    setItemAlterations(new Map());
    setDirty(false);
  }, []);

  const snapshot = useCallback((): FormSnapshot => {
    return {
      internalRefNo,
      itemAlterations: new Map(itemAlterations),
    };
  }, [internalRefNo, itemAlterations]);

  const restore = useCallback((snap: FormSnapshot) => {
    setInternalRefNoState(snap.internalRefNo);
    setItemAlterations(new Map(snap.itemAlterations));
    setDirty(true);
  }, []);

  const loadExisting = useCallback(
    (
      newInternalRefNo: string,
      alteredItems: Array<{
        voucherItemGuid: string;
        alterationQty: number;
        remarks: string;
        deliveryDate: string;
        itemStatus?: number;
      }>,
    ) => {
      setInternalRefNoState(newInternalRefNo);
      const m = new Map<string, ItemAlteration>();
      for (const a of alteredItems) {
        const next: ItemAlteration = {
          alterRequired: true,
          alterQty: String(a.alterationQty),
          remarks: a.remarks ?? '',
          deliveryDate: a.deliveryDate ?? '',
        };
        if (a.itemStatus !== undefined) next.itemStatus = a.itemStatus;
        m.set(a.voucherItemGuid, next);
      }
      setItemAlterations(m);
      setDirty(false);
    },
    [],
  );

  const markClean = useCallback(() => {
    setDirty(false);
  }, []);

  return {
    internalRefNo,
    setInternalRefNo,
    getItemAlteration,
    patchItemAlteration,
    toggleAlterRequired,
    setAllRequired,
    applyToChecked,
    clear,
    snapshot,
    restore,
    loadExisting,
    dirty,
    markClean,
  };
}
