import { useState } from 'react';
import { api, ApiError } from '../../api/client';

export interface SaveItemBody {
  voucherItemGuid: string;
  alterationQty: number;
  remarks?: string;
  deliveryDate?: string;
  status?: number;
}

export interface SaveBody {
  internalRefNo?: string;
  items: SaveItemBody[];
}

export interface SaveResultData {
  alterationQbguid: string;
  voucherNo: string;
  savedAt: string;
  status: number;
  itemCount: number;
  isUpdate: boolean;
}

export type SaveStatus =
  | { kind: 'idle' }
  | { kind: 'pending' }
  | { kind: 'success'; data: SaveResultData }
  | { kind: 'error'; error: ApiError | Error };

interface UseSaveAlterationResult {
  status: SaveStatus;
  save: (qbguid: string, body: SaveBody) => Promise<SaveResultData | null>;
  reset: () => void;
}

export function useSaveAlteration(): UseSaveAlterationResult {
  const [status, setStatus] = useState<SaveStatus>({ kind: 'idle' });

  async function save(qbguid: string, body: SaveBody): Promise<SaveResultData | null> {
    setStatus({ kind: 'pending' });
    try {
      const data = await api.post<SaveResultData>(
        `/api/voucher/${encodeURIComponent(qbguid)}/alteration`,
        body,
      );
      setStatus({ kind: 'success', data });
      return data;
    } catch (e: unknown) {
      const err = e instanceof Error ? e : new Error(String(e));
      setStatus({ kind: 'error', error: err });
      return null;
    }
  }

  function reset() {
    setStatus({ kind: 'idle' });
  }

  return { status, save, reset };
}
