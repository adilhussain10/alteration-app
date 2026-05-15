/**
 * Response shape from GET /api/voucher/{qbguid}/alteration.
 * Mirrors the Go handler's VoucherAlterationResponse exactly.
 */
export interface VoucherAlterationResponse {
  header: AlterationHeader;
  items: AlterationItem[];
  existingAlteration?: ExistingAlterationData;
}

export interface ExistingAlterationItem {
  voucherItemGuid: string;
  alterationQty: number;
  remarks?: string;
  deliveryDate?: string;
  /** 0=Received 1=InProgress 2=Ready 3=Delivered 4=Cancelled. */
  status?: number;
}

export interface ExistingAlterationData {
  alterationQbguid: string;
  voucherNo: string;
  internalRefNo?: string;
  /** 0=Received 1=InProgress 2=Ready 3=Delivered 4=Cancelled */
  status: number;
  createdBy?: string;
  /** ISO 8601 timestamp */
  createdAt?: string;
  alteredItems: ExistingAlterationItem[];
}

export interface AlterationHeader {
  qbguid: string;
  voucherNo: string;
  /** ISO 8601 string */
  voucherDate: string;
  partyGuid: string;
  partyName: string;
  /** Mobile from QbMaillingAddress.MobileNo for the billing address. */
  partyMobile: string;
}

export interface AlterationItem {
  qbguid: string;
  serialNo: number;
  stockNo: string;
  itemDescription: string;
  docQty: number;
}
