package alteration

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
)

type SaveAlterationRequest struct {
	InternalRefNo string                  `json:"internalRefNo,omitempty"`
	Items         []SaveAlterationItemReq `json:"items"`
}

type SaveAlterationItemReq struct {
	VoucherItemGUID string  `json:"voucherItemGuid"`
	AlterationQty   int     `json:"alterationQty"`
	Remarks         string  `json:"remarks,omitempty"`
	DeliveryDate    string  `json:"deliveryDate,omitempty"`
	Status          *Status `json:"status,omitempty"`
}

type SaveAlterationResponse struct {
	AlterationQbguid string    `json:"alterationQbguid"`
	VoucherNo        string    `json:"voucherNo"`
	SavedAt          time.Time `json:"savedAt"`
	Status           Status    `json:"status"`
	ItemCount        int       `json:"itemCount"`
	IsUpdate         bool      `json:"isUpdate"`
}

func (r SaveAlterationRequest) validate() error {
	if len(r.Items) == 0 {
		return errors.New("at least one altered item is required")
	}
	if len(r.Items) > 100 {
		return errors.New("too many items (max 100)")
	}
	if len(r.InternalRefNo) > 128 {
		return errors.New("internalRefNo exceeds 128 characters")
	}
	for i, it := range r.Items {
		if strings.TrimSpace(it.VoucherItemGUID) == "" {
			return fmt.Errorf("items[%d].voucherItemGuid is required", i)
		}
		if it.AlterationQty <= 0 {
			return fmt.Errorf("items[%d].alterationQty must be > 0", i)
		}
		if len(it.Remarks) > 256 {
			return fmt.Errorf("items[%d].remarks exceeds 256 characters", i)
		}
		if it.Status != nil && !it.Status.IsValid() {
			return fmt.Errorf("items[%d].status %d is not a valid status", i, *it.Status)
		}
	}
	return nil
}

// NewSaveVoucherAlteration handles POST /api/voucher/{qbguid}/alteration.
func NewSaveVoucherAlteration(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		voucherQbguid := strings.TrimSpace(r.PathValue("qbguid"))
		if voucherQbguid == "" {
			writeError(w, http.StatusBadRequest, "missing qbguid in path",
				map[string]any{"field": "qbguid"})
			return
		}

		var req SaveAlterationRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, http.StatusBadRequest, "invalid request body",
				map[string]any{"reason": err.Error()})
			return
		}
		if err := req.validate(); err != nil {
			writeError(w, http.StatusBadRequest, err.Error(), nil)
			return
		}

		userID := "admin"

		result, saveErr := saveAlteration(r.Context(), db, voucherQbguid, userID, req)
		if saveErr != nil {
			handleSaveError(w, voucherQbguid, saveErr)
			return
		}
		writeJSON(w, http.StatusOK, result)
	}
}

func saveAlteration(
	ctx context.Context,
	db *sql.DB,
	voucherQbguid string,
	userID string,
	req SaveAlterationRequest,
) (SaveAlterationResponse, error) {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return SaveAlterationResponse{}, fmt.Errorf("begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	docQtyByItemGUID, err := loadVoucherItemQtys(ctx, tx, voucherQbguid)
	if err != nil {
		return SaveAlterationResponse{}, err
	}

	for i, it := range req.Items {
		docQty, ok := docQtyByItemGUID[it.VoucherItemGUID]
		if !ok {
			return SaveAlterationResponse{}, &validationError{
				Code:    "ITEM_NOT_ON_VOUCHER",
				Message: fmt.Sprintf("items[%d].voucherItemGuid does not belong to this voucher", i),
				Details: map[string]any{"voucherItemGuid": it.VoucherItemGUID},
			}
		}
		if it.AlterationQty > docQty {
			return SaveAlterationResponse{}, &validationError{
				Code:    "QTY_EXCEEDS_DOC",
				Message: fmt.Sprintf("items[%d].alterationQty %d exceeds DocQty %d", i, it.AlterationQty, docQty),
				Details: map[string]any{
					"voucherItemGuid": it.VoucherItemGUID,
					"alterationQty":   it.AlterationQty,
					"docQty":          docQty,
				},
			}
		}
	}

	existing, err := loadExistingAlterationHeader(ctx, tx, voucherQbguid)
	if err != nil {
		return SaveAlterationResponse{}, err
	}

	var alterationQbguid, voucherNo string
	var status Status
	isUpdate := existing != nil

	existingItemStatus := map[string]Status{}

	if isUpdate {
		alterationQbguid = existing.QBGUID
		voucherNo = existing.VoucherNo
		status = existing.Status

		const readStatusSQL = `
SELECT VoucherItemGUID, Status
FROM dbo.QbVoucherAlterationItems
WHERE AlterationGUID = @p1 AND ActiveFlag = 1`
		statusRows, err := tx.QueryContext(ctx, readStatusSQL, alterationQbguid)
		if err != nil {
			return SaveAlterationResponse{}, fmt.Errorf("read existing item statuses: %w", err)
		}
		for statusRows.Next() {
			var voucherItemGUID string
			var s int16
			if err := statusRows.Scan(&voucherItemGUID, &s); err != nil {
				_ = statusRows.Close()
				return SaveAlterationResponse{}, fmt.Errorf("scan existing item status: %w", err)
			}
			existingItemStatus[voucherItemGUID] = Status(s)
		}
		if err := statusRows.Err(); err != nil {
			_ = statusRows.Close()
			return SaveAlterationResponse{}, err
		}
		_ = statusRows.Close()

		const updateSQL = `
UPDATE dbo.QbVoucherAlteration
SET InternalRefNo = @p2,
    AlterId       = AlterId + 1,
    QbUserId      = @p3
WHERE QBGUID = @p1 AND ActiveFlag = 1`
		if _, err := tx.ExecContext(ctx, updateSQL,
			alterationQbguid, nullableString(req.InternalRefNo), userID); err != nil {
			return SaveAlterationResponse{}, fmt.Errorf("update header: %w", err)
		}

		const softDeleteSQL = `
UPDATE dbo.QbVoucherAlterationItems
SET ActiveFlag = 0,
    AlterId    = AlterId + 1,
    QbUserId   = @p2
WHERE AlterationGUID = @p1 AND ActiveFlag = 1`
		if _, err := tx.ExecContext(ctx, softDeleteSQL, alterationQbguid, userID); err != nil {
			return SaveAlterationResponse{}, fmt.Errorf("soft-delete old details: %w", err)
		}
	} else {
		num, err := allocateVoucherNumber(ctx, tx)
		if err != nil {
			return SaveAlterationResponse{}, err
		}

		alterationQbguid = uuid.NewString()
		voucherNo = num.Formatted
		voucherDate := time.Now().UTC().Truncate(24 * time.Hour)
		status = StatusReceived

		partyGUID, err := loadVoucherPartyGUID(ctx, tx, voucherQbguid)
		if err != nil {
			return SaveAlterationResponse{}, err
		}

		const insertHeaderSQL = `
INSERT INTO dbo.QbVoucherAlteration (
    QBGUID, VoucherType, VoucherNo, VoucherDate,
    VoucherHdrGUID, PartyGUID, InternalRefNo, Status,
    CreatedBy, CreatedAt, QbUserId
) VALUES (
    @p1, 6010, @p2, @p3,
    @p4, @p5, @p6, @p7,
    @p8, @p9, @p10
)`
		now := time.Now().UTC()
		if _, err := tx.ExecContext(ctx, insertHeaderSQL,
			alterationQbguid, voucherNo, voucherDate,
			voucherQbguid, nullableString(partyGUID), nullableString(req.InternalRefNo),
			int16(StatusReceived),
			userID, now, userID,
		); err != nil {
			return SaveAlterationResponse{}, fmt.Errorf("insert header: %w", err)
		}
	}

	const insertDetailSQL = `
INSERT INTO dbo.QbVoucherAlterationItems (
    QBGUID, AlterationGUID, VoucherItemGUID, AlterationQty,
    Remarks, DeliveryDate, Status, QbUserId
) VALUES (
    @p1, @p2, @p3, @p4, @p5, @p6, @p7, @p8
)`
	for _, it := range req.Items {
		detailQbguid := uuid.NewString()
		var deliveryDate sql.NullTime
		if it.DeliveryDate != "" {
			t, err := time.Parse("2006-01-02", it.DeliveryDate)
			if err != nil {
				return SaveAlterationResponse{}, &validationError{
					Code:    "BAD_DELIVERY_DATE",
					Message: "deliveryDate must be YYYY-MM-DD",
					Details: map[string]any{
						"voucherItemGuid": it.VoucherItemGUID,
						"deliveryDate":    it.DeliveryDate,
					},
				}
			}
			deliveryDate = sql.NullTime{Time: t, Valid: true}
		}

		itemStatus := StatusReceived
		if prev, ok := existingItemStatus[it.VoucherItemGUID]; ok {
			itemStatus = prev
		}
		if it.Status != nil {
			itemStatus = *it.Status
		}

		if _, err := tx.ExecContext(ctx, insertDetailSQL,
			detailQbguid, alterationQbguid, it.VoucherItemGUID, it.AlterationQty,
			nullableString(it.Remarks), deliveryDate,
			int16(itemStatus), userID,
		); err != nil {
			return SaveAlterationResponse{}, fmt.Errorf("insert detail: %w", err)
		}
	}

	if minStatus, err := minActiveItemStatus(ctx, tx, alterationQbguid); err != nil {
		return SaveAlterationResponse{}, err
	} else if minStatus != nil && *minStatus != status {
		const syncDocSQL = `
UPDATE dbo.QbVoucherAlteration
SET Status   = @p2,
    AlterId  = AlterId + 1,
    QbUserId = @p3
WHERE QBGUID = @p1 AND ActiveFlag = 1`
		if _, err := tx.ExecContext(ctx, syncDocSQL,
			alterationQbguid, int16(*minStatus), userID); err != nil {
			return SaveAlterationResponse{}, fmt.Errorf("sync header status: %w", err)
		}
		status = *minStatus
	}

	if err := tx.Commit(); err != nil {
		return SaveAlterationResponse{}, fmt.Errorf("commit: %w", err)
	}

	return SaveAlterationResponse{
		AlterationQbguid: alterationQbguid,
		VoucherNo:        voucherNo,
		SavedAt:          time.Now().UTC(),
		Status:           status,
		ItemCount:        len(req.Items),
		IsUpdate:         isUpdate,
	}, nil
}

func handleSaveError(w http.ResponseWriter, voucherQbguid string, err error) {
	if errors.Is(err, errVoucherNotFound) {
		writeError(w, http.StatusNotFound, "voucher not found",
			map[string]any{"qbguid": voucherQbguid})
		return
	}
	if errors.Is(err, errCounterNotConfigured) || errors.Is(err, errVoucherTypeNotConfigured) {
		writeError(w, http.StatusInternalServerError,
			"alteration voucher type/counter not configured (run D:\\QB_Code\\sql\\001_seed_alteration_voucher_type.sql)", nil)
		return
	}
	var ve *validationError
	if errors.As(err, &ve) {
		writeError(w, http.StatusBadRequest, ve.Message, ve.Details)
		return
	}
	writeError(w, http.StatusInternalServerError, "save failed",
		map[string]any{"reason": err.Error()})
}

func nullableString(s string) sql.NullString {
	if s == "" {
		return sql.NullString{}
	}
	return sql.NullString{String: s, Valid: true}
}
