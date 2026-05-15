package alteration

import (
	"database/sql"
	"errors"
	"net/http"
	"strings"
	"time"
)

// VoucherAlterationResponse is the body of GET /api/voucher/{qbguid}/alteration.
type VoucherAlterationResponse struct {
	Header             AlterationHeader        `json:"header"`
	Items              []AlterationItem        `json:"items"`
	ExistingAlteration *ExistingAlterationData `json:"existingAlteration,omitempty"`
}

// ExistingAlterationData is included when an alteration already exists.
type ExistingAlterationData struct {
	AlterationQbguid string                   `json:"alterationQbguid"`
	VoucherNo        string                   `json:"voucherNo"`
	InternalRefNo    string                   `json:"internalRefNo,omitempty"`
	Status           Status                   `json:"status"`
	CreatedBy        string                   `json:"createdBy,omitempty"`
	CreatedAt        time.Time                `json:"createdAt,omitempty"`
	AlteredItems     []ExistingAlterationItem `json:"alteredItems"`
}

// NewGetVoucherAlteration handles GET /api/voucher/{qbguid}/alteration.
func NewGetVoucherAlteration(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		qbguid := strings.TrimSpace(r.PathValue("qbguid"))
		if qbguid == "" {
			writeError(w, http.StatusBadRequest, "missing qbguid in path",
				map[string]any{"field": "qbguid", "reason": "required"})
			return
		}

		header, err := loadAlterationHeaderDB(r.Context(), db, qbguid)
		if err != nil {
			if errors.Is(err, errVoucherNotFound) {
				writeError(w, http.StatusNotFound, "voucher not found",
					map[string]any{"qbguid": qbguid})
				return
			}
			writeError(w, http.StatusInternalServerError, "failed to load voucher header",
				map[string]any{"reason": err.Error()})
			return
		}

		items, err := loadAlterationItemsDB(r.Context(), db, qbguid)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed to load voucher items",
				map[string]any{"reason": err.Error()})
			return
		}
		if items == nil {
			items = []AlterationItem{}
		}

		// Best-effort enrich: missing alteration tables or query failure
		// must NOT break the read endpoint.
		var existing *ExistingAlterationData
		if hdr, lookupErr := loadExistingAlterationHeaderDB(r.Context(), db, qbguid); lookupErr == nil && hdr != nil {
			alteredItems, itemsErr := loadExistingAlterationItems(r.Context(), db, hdr.QBGUID)
			if itemsErr == nil {
				if alteredItems == nil {
					alteredItems = []ExistingAlterationItem{}
				}
				existing = &ExistingAlterationData{
					AlterationQbguid: hdr.QBGUID,
					VoucherNo:        hdr.VoucherNo,
					InternalRefNo:    hdr.InternalRefNo,
					Status:           hdr.Status,
					CreatedBy:        hdr.CreatedBy,
					CreatedAt:        hdr.CreatedAt,
					AlteredItems:     alteredItems,
				}
			}
		}

		resp := VoucherAlterationResponse{
			Header: header,
			Items:  items,
		}
		if existing != nil {
			resp.ExistingAlteration = existing
		}
		writeJSON(w, http.StatusOK, resp)
	}
}
