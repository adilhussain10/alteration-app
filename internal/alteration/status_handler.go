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
)

var (
	errTerminalStatus      = errors.New("status is terminal and cannot be changed")
	errInvalidTransition   = errors.New("invalid status transition")
	errAlterationNotFound  = errors.New("alteration not found")
	errItemNotInAlteration = errors.New("item not in alteration")
)

type StatusUpdateRequest struct {
	Status Status `json:"status"`
}

type StatusUpdateResponse struct {
	AlterationQbguid string    `json:"alterationQbguid"`
	NewStatus        Status    `json:"newStatus"`
	UpdatedAt        time.Time `json:"updatedAt"`
	DocAutoUpdated   bool      `json:"docAutoUpdated,omitempty"`
}

// allowedTransitions defines valid status transitions.
// Non-terminal states can move freely between each other; Delivered/Cancelled lock.
var allowedTransitions = map[Status][]Status{
	StatusReceived:   {StatusInProgress, StatusReady, StatusDelivered, StatusCancelled},
	StatusInProgress: {StatusReceived, StatusReady, StatusDelivered, StatusCancelled},
	StatusReady:      {StatusReceived, StatusInProgress, StatusDelivered, StatusCancelled},
	StatusDelivered:  {},
	StatusCancelled:  {},
}

func isAllowedTransition(current, next Status) bool {
	allowed, ok := allowedTransitions[current]
	if !ok {
		return false
	}
	for _, s := range allowed {
		if s == next {
			return true
		}
	}
	return false
}

// NewUpdateAlterationStatus handles PATCH /api/alterations/{qbguid}/status.
func NewUpdateAlterationStatus(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		qbguid := strings.TrimSpace(r.PathValue("qbguid"))
		if qbguid == "" {
			writeError(w, http.StatusBadRequest, "missing qbguid", nil)
			return
		}

		var req StatusUpdateRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, http.StatusBadRequest, "invalid request body",
				map[string]any{"reason": err.Error()})
			return
		}
		if !req.Status.IsValid() {
			writeError(w, http.StatusBadRequest, "invalid status value",
				map[string]any{"status": req.Status})
			return
		}

		userID := "admin"
		result, err := updateDocStatus(r.Context(), db, qbguid, req.Status, userID)
		if err != nil {
			handleStatusUpdateError(w, qbguid, err)
			return
		}
		writeJSON(w, http.StatusOK, result)
	}
}

// NewUpdateAlterationItemStatus handles
// PATCH /api/alterations/{qbguid}/items/{itemQbguid}/status.
func NewUpdateAlterationItemStatus(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		qbguid := strings.TrimSpace(r.PathValue("qbguid"))
		itemQbguid := strings.TrimSpace(r.PathValue("itemQbguid"))
		if qbguid == "" || itemQbguid == "" {
			writeError(w, http.StatusBadRequest, "missing qbguid or itemQbguid", nil)
			return
		}

		var req StatusUpdateRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, http.StatusBadRequest, "invalid request body",
				map[string]any{"reason": err.Error()})
			return
		}
		if !req.Status.IsValid() {
			writeError(w, http.StatusBadRequest, "invalid status value",
				map[string]any{"status": req.Status})
			return
		}

		userID := "admin"
		result, err := updateItemStatus(r.Context(), db, qbguid, itemQbguid, req.Status, userID)
		if err != nil {
			handleStatusUpdateError(w, qbguid, err)
			return
		}
		writeJSON(w, http.StatusOK, result)
	}
}

func updateDocStatus(
	ctx context.Context,
	db *sql.DB,
	qbguid string,
	newStatus Status,
	userID string,
) (StatusUpdateResponse, error) {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return StatusUpdateResponse{}, fmt.Errorf("begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	current, err := readCurrentDocStatus(ctx, tx, qbguid)
	if err != nil {
		return StatusUpdateResponse{}, err
	}

	if current == StatusDelivered || current == StatusCancelled {
		return StatusUpdateResponse{}, errTerminalStatus
	}
	if current == newStatus {
		return StatusUpdateResponse{
			AlterationQbguid: qbguid,
			NewStatus:        newStatus,
			UpdatedAt:        time.Now().UTC(),
		}, nil
	}
	if !isAllowedTransition(current, newStatus) {
		return StatusUpdateResponse{}, errInvalidTransition
	}

	activeFlag := int16(1)
	if newStatus == StatusCancelled {
		activeFlag = 0
	}

	const updateHdrSQL = `
UPDATE dbo.QbVoucherAlteration
SET Status     = @p2,
    ActiveFlag = @p3,
    AlterId    = AlterId + 1,
    QbUserId   = @p4
WHERE QBGUID = @p1`
	if _, err := tx.ExecContext(ctx, updateHdrSQL,
		qbguid, int16(newStatus), activeFlag, userID); err != nil {
		return StatusUpdateResponse{}, fmt.Errorf("update header: %w", err)
	}

	const updateItemsSQL = `
UPDATE dbo.QbVoucherAlterationItems
SET Status     = @p2,
    ActiveFlag = @p3,
    AlterId    = AlterId + 1,
    QbUserId   = @p4
WHERE AlterationGUID = @p1 AND ActiveFlag = 1`
	if _, err := tx.ExecContext(ctx, updateItemsSQL,
		qbguid, int16(newStatus), activeFlag, userID); err != nil {
		return StatusUpdateResponse{}, fmt.Errorf("update items: %w", err)
	}

	if err := tx.Commit(); err != nil {
		return StatusUpdateResponse{}, fmt.Errorf("commit: %w", err)
	}

	return StatusUpdateResponse{
		AlterationQbguid: qbguid,
		NewStatus:        newStatus,
		UpdatedAt:        time.Now().UTC(),
	}, nil
}

func updateItemStatus(
	ctx context.Context,
	db *sql.DB,
	qbguid string,
	itemQbguid string,
	newStatus Status,
	userID string,
) (StatusUpdateResponse, error) {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return StatusUpdateResponse{}, fmt.Errorf("begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	currentItem, err := readCurrentItemStatus(ctx, tx, qbguid, itemQbguid)
	if err != nil {
		return StatusUpdateResponse{}, err
	}
	if currentItem == StatusDelivered || currentItem == StatusCancelled {
		return StatusUpdateResponse{}, errTerminalStatus
	}
	if currentItem == newStatus {
		return StatusUpdateResponse{
			AlterationQbguid: qbguid,
			NewStatus:        newStatus,
			UpdatedAt:        time.Now().UTC(),
		}, nil
	}
	if !isAllowedTransition(currentItem, newStatus) {
		return StatusUpdateResponse{}, errInvalidTransition
	}

	itemActiveFlag := int16(1)
	if newStatus == StatusCancelled {
		itemActiveFlag = 0
	}

	const updateItemSQL = `
UPDATE dbo.QbVoucherAlterationItems
SET Status     = @p3,
    ActiveFlag = @p4,
    AlterId    = AlterId + 1,
    QbUserId   = @p5
WHERE AlterationGUID = @p1 AND VoucherItemGUID = @p2 AND ActiveFlag = 1`
	if _, err := tx.ExecContext(ctx, updateItemSQL,
		qbguid, itemQbguid, int16(newStatus), itemActiveFlag, userID); err != nil {
		return StatusUpdateResponse{}, fmt.Errorf("update item: %w", err)
	}

	// Auto-promote doc-level status to MIN(active item statuses).
	docAutoUpdated := false
	currentDocStatus, err := readCurrentDocStatus(ctx, tx, qbguid)
	if err != nil {
		return StatusUpdateResponse{}, err
	}
	minItemStatus, err := minActiveItemStatus(ctx, tx, qbguid)
	if err != nil {
		return StatusUpdateResponse{}, err
	}
	if minItemStatus != nil && *minItemStatus != currentDocStatus {
		const autoUpdateHdrSQL = `
UPDATE dbo.QbVoucherAlteration
SET Status   = @p2,
    AlterId  = AlterId + 1,
    QbUserId = @p3
WHERE QBGUID = @p1 AND ActiveFlag = 1`
		if _, err := tx.ExecContext(ctx, autoUpdateHdrSQL,
			qbguid, int16(*minItemStatus), userID); err != nil {
			return StatusUpdateResponse{}, fmt.Errorf("auto-update header: %w", err)
		}
		docAutoUpdated = true
	}

	if err := tx.Commit(); err != nil {
		return StatusUpdateResponse{}, fmt.Errorf("commit: %w", err)
	}

	return StatusUpdateResponse{
		AlterationQbguid: qbguid,
		NewStatus:        newStatus,
		UpdatedAt:        time.Now().UTC(),
		DocAutoUpdated:   docAutoUpdated,
	}, nil
}

func readCurrentDocStatus(ctx context.Context, tx *sql.Tx, qbguid string) (Status, error) {
	const sqlText = `
SELECT Status FROM dbo.QbVoucherAlteration
WHERE QBGUID = @p1 AND ActiveFlag = 1`
	var s int16
	if err := tx.QueryRowContext(ctx, sqlText, qbguid).Scan(&s); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return 0, errAlterationNotFound
		}
		return 0, fmt.Errorf("read doc status: %w", err)
	}
	return Status(s), nil
}

func readCurrentItemStatus(ctx context.Context, tx *sql.Tx, alterationGUID, voucherItemGUID string) (Status, error) {
	const sqlText = `
SELECT Status FROM dbo.QbVoucherAlterationItems
WHERE AlterationGUID = @p1 AND VoucherItemGUID = @p2 AND ActiveFlag = 1`
	var s int16
	if err := tx.QueryRowContext(ctx, sqlText, alterationGUID, voucherItemGUID).Scan(&s); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return 0, errItemNotInAlteration
		}
		return 0, fmt.Errorf("read item status: %w", err)
	}
	return Status(s), nil
}

func handleStatusUpdateError(w http.ResponseWriter, qbguid string, err error) {
	switch {
	case errors.Is(err, errAlterationNotFound):
		writeError(w, http.StatusNotFound, "alteration not found",
			map[string]any{"qbguid": qbguid})
	case errors.Is(err, errItemNotInAlteration):
		writeError(w, http.StatusBadRequest, "item is not part of this alteration", nil)
	case errors.Is(err, errTerminalStatus):
		writeError(w, http.StatusConflict, "status is terminal and cannot be changed", nil)
	case errors.Is(err, errInvalidTransition):
		writeError(w, http.StatusBadRequest, "invalid status transition", nil)
	default:
		writeError(w, http.StatusInternalServerError, "status update failed",
			map[string]any{"reason": err.Error()})
	}
}
