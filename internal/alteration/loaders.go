package alteration

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"
)

// AlterationHeader is the voucher-level fields shown in the form header.
type AlterationHeader struct {
	QBGUID      string    `json:"qbguid"`
	VoucherNo   string    `json:"voucherNo"`
	VoucherDate time.Time `json:"voucherDate"`
	PartyGUID   string    `json:"partyGuid"`
	PartyName   string    `json:"partyName"`
	PartyMobile string    `json:"partyMobile"`
}

// AlterationItem is one voucher line as displayed in the form's grid.
type AlterationItem struct {
	QBGUID          string  `json:"qbguid"`
	SerialNo        int     `json:"serialNo"`
	StockNo         string  `json:"stockNo"`
	ItemDescription string  `json:"itemDescription"`
	DocQty          float64 `json:"docQty"`
}

// ExistingAlterationItem is one altered item from a previously saved alteration.
type ExistingAlterationItem struct {
	VoucherItemGUID string `json:"voucherItemGuid"`
	AlterationQty   int    `json:"alterationQty"`
	Remarks         string `json:"remarks,omitempty"`
	DeliveryDate    string `json:"deliveryDate,omitempty"`
	Status          Status `json:"status"`
}

type existingAlterationHeader struct {
	QBGUID        string
	VoucherNo     string
	VoucherDate   time.Time
	InternalRefNo string
	Status        Status
	CreatedBy     string
	CreatedAt     time.Time
}

// ── Tx-scoped loaders (used by save handler) ─────────────────────────────────

func loadVoucherItemQtys(ctx context.Context, tx *sql.Tx, voucherHdrGUID string) (map[string]int, error) {
	const headerSQL = `
SELECT 1 FROM dbo.QbVoucherHeader
WHERE QBGUID = @p1 AND ActiveFlag = 1`
	var dummy int
	if err := tx.QueryRowContext(ctx, headerSQL, voucherHdrGUID).Scan(&dummy); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, errVoucherNotFound
		}
		return nil, fmt.Errorf("verify voucher: %w", err)
	}

	const itemsSQL = `
SELECT QBGUID, ISNULL(DocQty, 0)
FROM dbo.QbVoucherItems
WHERE VchHdrGUID = @p1 AND ActiveFlag = 1`
	rows, err := tx.QueryContext(ctx, itemsSQL, voucherHdrGUID)
	if err != nil {
		return nil, fmt.Errorf("load items: %w", err)
	}
	defer rows.Close()

	out := make(map[string]int)
	for rows.Next() {
		var qbguid string
		var docQty float64
		if err := rows.Scan(&qbguid, &docQty); err != nil {
			return nil, err
		}
		out[qbguid] = int(docQty)
	}
	return out, rows.Err()
}

func loadVoucherPartyGUID(ctx context.Context, tx *sql.Tx, voucherHdrGUID string) (string, error) {
	const sqlText = `
SELECT ISNULL(PartyGUID, '')
FROM dbo.QbVoucherHeader
WHERE QBGUID = @p1 AND ActiveFlag = 1`
	var partyGUID string
	if err := tx.QueryRowContext(ctx, sqlText, voucherHdrGUID).Scan(&partyGUID); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return "", errVoucherNotFound
		}
		return "", fmt.Errorf("read PartyGUID: %w", err)
	}
	return partyGUID, nil
}

const existingHeaderSelectSQL = `
SELECT QBGUID, VoucherNo, VoucherDate,
       ISNULL(InternalRefNo, ''),
       Status,
       ISNULL(CreatedBy, ''), ISNULL(CreatedAt, GETDATE())
FROM dbo.QbVoucherAlteration
WHERE VoucherHdrGUID = @p1 AND ActiveFlag = 1`

func loadExistingAlterationHeader(ctx context.Context, tx *sql.Tx, voucherHdrGUID string) (*existingAlterationHeader, error) {
	row := tx.QueryRowContext(ctx, existingHeaderSelectSQL, voucherHdrGUID)
	return scanExistingHeader(row)
}

func minActiveItemStatus(ctx context.Context, tx *sql.Tx, qbguid string) (*Status, error) {
	const sqlText = `
SELECT MIN(Status) FROM dbo.QbVoucherAlterationItems
WHERE AlterationGUID = @p1 AND ActiveFlag = 1`
	var s sql.NullInt16
	if err := tx.QueryRowContext(ctx, sqlText, qbguid).Scan(&s); err != nil {
		return nil, fmt.Errorf("min item status: %w", err)
	}
	if !s.Valid {
		return nil, nil
	}
	out := Status(s.Int16)
	return &out, nil
}

// ── DB-direct loaders (used by GET handler) ──────────────────────────────────

const headerSQL = `
SELECT h.QBGUID, h.VoucherNo, h.VoucherDate, h.PartyGUID,
       ISNULL(l.LedgerName, '') AS PartyName,
       ISNULL(ma.MobileNo, '')  AS PartyMobile
FROM dbo.QbVoucherHeader h
LEFT JOIN dbo.QbLedger l
       ON l.QBGUID = h.PartyGUID
      AND l.ActiveFlag = 1
LEFT JOIN dbo.QbMaillingAddress ma
       ON ma.LinkGUID = l.QBGUID
      AND ma.ActiveFlag = 1
      AND ma.AddressType = 'BillingAddress'
WHERE h.QBGUID = @p1
  AND h.ActiveFlag = 1`

const itemsListSQL = `
SELECT i.QBGUID, i.SerialNo, m.StockNo, m.ItemDescription, i.DocQty
FROM dbo.QbVoucherItems i
INNER JOIN dbo.QbItemMaster m
       ON m.QBGUID = i.ItemGUID
      AND m.ActiveFlag = 1
WHERE i.VchHdrGUID = @p1
  AND i.ActiveFlag = 1
ORDER BY i.SerialNo ASC`

func loadAlterationHeaderDB(ctx context.Context, db *sql.DB, qbguid string) (AlterationHeader, error) {
	row := db.QueryRowContext(ctx, headerSQL, qbguid)

	var (
		h           AlterationHeader
		voucherNo   sql.NullString
		voucherDate sql.NullTime
		partyGUID   sql.NullString
	)
	err := row.Scan(&h.QBGUID, &voucherNo, &voucherDate, &partyGUID, &h.PartyName, &h.PartyMobile)
	if errors.Is(err, sql.ErrNoRows) {
		return AlterationHeader{}, errVoucherNotFound
	}
	if err != nil {
		return AlterationHeader{}, err
	}
	if voucherNo.Valid {
		h.VoucherNo = voucherNo.String
	}
	if voucherDate.Valid {
		h.VoucherDate = voucherDate.Time
	}
	if partyGUID.Valid {
		h.PartyGUID = partyGUID.String
	}
	return h, nil
}

func loadAlterationItemsDB(ctx context.Context, db *sql.DB, qbguid string) ([]AlterationItem, error) {
	rows, err := db.QueryContext(ctx, itemsListSQL, qbguid)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var items []AlterationItem
	for rows.Next() {
		var (
			it          AlterationItem
			stockNo     sql.NullString
			description sql.NullString
			docQty      sql.NullFloat64
		)
		if err := rows.Scan(&it.QBGUID, &it.SerialNo, &stockNo, &description, &docQty); err != nil {
			return nil, err
		}
		if stockNo.Valid {
			it.StockNo = stockNo.String
		}
		if description.Valid {
			it.ItemDescription = description.String
		}
		if docQty.Valid {
			it.DocQty = docQty.Float64
		}
		items = append(items, it)
	}
	return items, rows.Err()
}

func loadExistingAlterationHeaderDB(ctx context.Context, db *sql.DB, voucherHdrGUID string) (*existingAlterationHeader, error) {
	row := db.QueryRowContext(ctx, existingHeaderSelectSQL, voucherHdrGUID)
	return scanExistingHeader(row)
}

func loadExistingAlterationItems(ctx context.Context, db *sql.DB, alterationGUID string) ([]ExistingAlterationItem, error) {
	const sqlText = `
SELECT VoucherItemGUID, AlterationQty,
       ISNULL(Remarks, ''), DeliveryDate, Status
FROM dbo.QbVoucherAlterationItems
WHERE AlterationGUID = @p1 AND ActiveFlag = 1`
	rows, err := db.QueryContext(ctx, sqlText, alterationGUID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []ExistingAlterationItem
	for rows.Next() {
		var it ExistingAlterationItem
		var deliveryDate sql.NullTime
		var status int16
		if err := rows.Scan(&it.VoucherItemGUID, &it.AlterationQty,
			&it.Remarks, &deliveryDate, &status); err != nil {
			return nil, err
		}
		if deliveryDate.Valid {
			it.DeliveryDate = deliveryDate.Time.UTC().Format("2006-01-02")
		}
		it.Status = Status(status)
		out = append(out, it)
	}
	return out, rows.Err()
}

// scanExistingHeader is shared by the tx and db variants.
func scanExistingHeader(row *sql.Row) (*existingAlterationHeader, error) {
	var h existingAlterationHeader
	var status int16
	if err := row.Scan(&h.QBGUID, &h.VoucherNo, &h.VoucherDate,
		&h.InternalRefNo, &status, &h.CreatedBy, &h.CreatedAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, fmt.Errorf("load existing alteration: %w", err)
	}
	h.Status = Status(status)
	return &h, nil
}
