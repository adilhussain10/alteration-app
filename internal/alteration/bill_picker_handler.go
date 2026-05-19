package alteration

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"
)

type BillPickerItem struct {
	QbGUID           string    `json:"qbguid"`
	VoucherNo        string    `json:"voucherNo"`
	VoucherDate      time.Time `json:"voucherDate"`
	VoucherType      int       `json:"voucherType"`
	VoucherTypeName  string    `json:"voucherTypeName"`
	CustomerName     string    `json:"customerName"`
	CustomerMobile   string    `json:"customerMobile,omitempty"`
	ItemCount        int       `json:"itemCount"`
	HasAlteration    bool      `json:"hasAlteration"`
	AlterationQbguid string    `json:"alterationQbguid,omitempty"`
	AlterationNo     string    `json:"alterationNo,omitempty"`
	AlterationStatus *Status   `json:"alterationStatus,omitempty"`

	ReceivedItemCount   int `json:"receivedItemCount,omitempty"`
	InProgressItemCount int `json:"inProgressItemCount,omitempty"`
	ReadyItemCount      int `json:"readyItemCount,omitempty"`
	DeliveredItemCount  int `json:"deliveredItemCount,omitempty"`
	AlterationItemCount int `json:"alterationItemCount,omitempty"`
}

type BillPickerResponse struct {
	Items      []BillPickerItem `json:"items"`
	TotalCount int              `json:"totalCount"`
}

type BillLookupResponse struct {
	QbGUID           string `json:"qbguid"`
	VoucherNo        string `json:"voucherNo"`
	HasAlteration    bool   `json:"hasAlteration"`
	AlterationQbguid string `json:"alterationQbguid,omitempty"`
}

// NewListBillsForAlteration handles GET /api/vouchers/for-alteration.
//
// Query params:
//
//	fromDate   yyyy-MM-dd  (default: today)
//	toDate     yyyy-MM-dd  (default: today)
//	voucherNo  string      (optional — direct lookup by bill number)
func NewListBillsForAlteration(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()

		if voucherNo := strings.TrimSpace(q.Get("voucherNo")); voucherNo != "" {
			result, err := lookupBillByNumber(r.Context(), db, voucherNo)
			if errors.Is(err, sql.ErrNoRows) {
				writeError(w, http.StatusNotFound, "bill not found",
					map[string]any{"voucherNo": voucherNo})
				return
			}
			if err != nil {
				writeError(w, http.StatusInternalServerError, "lookup failed",
					map[string]any{"reason": err.Error()})
				return
			}
			writeJSON(w, http.StatusOK, result)
			return
		}

		today := time.Now().UTC().Truncate(24 * time.Hour)
		fromDate := today
		toDate := today.Add(24*time.Hour - time.Second)

		if v := q.Get("fromDate"); v != "" {
			if t, err := time.Parse("2006-01-02", v); err == nil {
				fromDate = t.UTC()
			}
		}
		if v := q.Get("toDate"); v != "" {
			if t, err := time.Parse("2006-01-02", v); err == nil {
				toDate = t.UTC().Add(24*time.Hour - time.Second)
			}
		}

		result, err := listBillsForAlteration(r.Context(), db, fromDate, toDate)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "list query failed",
				map[string]any{"reason": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, result)
	}
}

func lookupBillByNumber(
	ctx context.Context,
	db *sql.DB,
	voucherNo string,
) (BillLookupResponse, error) {
	const sqlText = `
SELECT
    vh.QBGUID,
    vh.VoucherNo,
    CASE WHEN a.QBGUID IS NULL THEN 0 ELSE 1 END AS HasAlteration,
    COALESCE(a.QBGUID, '')                          AS AlterationQbguid
FROM dbo.QbVoucherHeader vh
LEFT JOIN dbo.QbVoucherAlteration a
    ON a.VoucherHdrGUID = vh.QBGUID AND a.ActiveFlag = 1
WHERE vh.VoucherNo    = $1
  AND vh.VoucherType  IN (1080, 1090)
  AND vh.ActiveFlag   = 1`

	var r BillLookupResponse
	var hasAlt int
	err := db.QueryRowContext(ctx, sqlText, voucherNo).Scan(
		&r.QbGUID, &r.VoucherNo, &hasAlt, &r.AlterationQbguid)
	if err != nil {
		return BillLookupResponse{}, err
	}
	r.HasAlteration = hasAlt == 1
	return r, nil
}

func listBillsForAlteration(
	ctx context.Context,
	db *sql.DB,
	fromDate time.Time,
	toDate time.Time,
) (BillPickerResponse, error) {
	const sqlText = `
SELECT
    vh.QBGUID,
    vh.VoucherNo,
    vh.VoucherDate,
    vh.VoucherType,
    CASE vh.VoucherType
        WHEN 1090 THEN 'Sales'
        WHEN 1080 THEN 'Sales Order'
        ELSE 'Other'
    END AS VoucherTypeName,
    COALESCE(l.LedgerName, '') AS CustomerName,
    COALESCE(ma.MobileNo,  '') AS CustomerMobile,
    (SELECT COUNT(*)
     FROM dbo.QbVoucherItems vi
     WHERE vi.VchHdrGUID = vh.QBGUID
       AND vi.ActiveFlag = 1) AS ItemCount,
    CASE WHEN a.QBGUID IS NULL THEN 0 ELSE 1 END AS HasAlteration,
    COALESCE(a.QBGUID,      '') AS AlterationQbguid,
    COALESCE(a.VoucherNo,   '') AS AlterationNo,
    a.Status                  AS AlterationStatus,
    COALESCE((SELECT COUNT(*)
            FROM dbo.QbVoucherAlterationItems ai
            WHERE ai.AlterationGUID = a.QBGUID
              AND ai.ActiveFlag = 1
              AND ai.Status = 0), 0) AS ReceivedItemCount,
    COALESCE((SELECT COUNT(*)
            FROM dbo.QbVoucherAlterationItems ai
            WHERE ai.AlterationGUID = a.QBGUID
              AND ai.ActiveFlag = 1
              AND ai.Status = 1), 0) AS InProgressItemCount,
    COALESCE((SELECT COUNT(*)
            FROM dbo.QbVoucherAlterationItems ai
            WHERE ai.AlterationGUID = a.QBGUID
              AND ai.ActiveFlag = 1
              AND ai.Status = 2), 0) AS ReadyItemCount,
    COALESCE((SELECT COUNT(*)
            FROM dbo.QbVoucherAlterationItems ai
            WHERE ai.AlterationGUID = a.QBGUID
              AND ai.ActiveFlag = 1
              AND ai.Status = 3), 0) AS DeliveredItemCount,
    COALESCE((SELECT COUNT(*)
            FROM dbo.QbVoucherAlterationItems ai
            WHERE ai.AlterationGUID = a.QBGUID
              AND ai.ActiveFlag = 1), 0) AS AlterationItemCount
FROM dbo.QbVoucherHeader vh
LEFT JOIN dbo.QbLedger l
    ON l.QBGUID = vh.PartyGUID
LEFT JOIN dbo.QbMaillingAddress ma
    ON ma.LinkGUID = l.QBGUID
   AND ma.ActiveFlag = 1
   AND ma.AddressType = 'BillingAddress'
LEFT JOIN dbo.QbVoucherAlteration a
    ON a.VoucherHdrGUID = vh.QBGUID AND a.ActiveFlag = 1
WHERE vh.VoucherType IN (1080, 1090)
  AND vh.ActiveFlag   = 1
  AND vh.VoucherDate >= $1
  AND vh.VoucherDate <= $2
ORDER BY vh.VoucherDate DESC, vh.VoucherNo DESC`

	rows, err := db.QueryContext(ctx, sqlText, fromDate, toDate)
	if err != nil {
		return BillPickerResponse{}, fmt.Errorf("list query: %w", err)
	}
	defer rows.Close()

	var items []BillPickerItem
	for rows.Next() {
		var it BillPickerItem
		var hasAlt int
		var voucherType int
		var alterationStatus sql.NullInt16
		if err := rows.Scan(
			&it.QbGUID,
			&it.VoucherNo,
			&it.VoucherDate,
			&voucherType,
			&it.VoucherTypeName,
			&it.CustomerName,
			&it.CustomerMobile,
			&it.ItemCount,
			&hasAlt,
			&it.AlterationQbguid,
			&it.AlterationNo,
			&alterationStatus,
			&it.ReceivedItemCount,
			&it.InProgressItemCount,
			&it.ReadyItemCount,
			&it.DeliveredItemCount,
			&it.AlterationItemCount,
		); err != nil {
			return BillPickerResponse{}, err
		}
		it.VoucherType = voucherType
		it.HasAlteration = hasAlt == 1
		if alterationStatus.Valid {
			s := Status(alterationStatus.Int16)
			it.AlterationStatus = &s
		}
		items = append(items, it)
	}
	if err := rows.Err(); err != nil {
		return BillPickerResponse{}, err
	}
	if items == nil {
		items = []BillPickerItem{}
	}

	return BillPickerResponse{
		Items:      items,
		TotalCount: len(items),
	}, nil
}
