package alteration

import (
	"context"
	"database/sql"
	"fmt"
	"net/http"
	"strings"
	"time"
)

type ReportRow struct {
	AlterationQbguid   string     `json:"alterationQbguid"`
	AlterationNo       string     `json:"alterationNo"`
	VoucherQbguid      string     `json:"voucherQbguid"`
	VoucherNo          string     `json:"voucherNo"`
	VoucherDate        time.Time  `json:"voucherDate"`
	VoucherType        int        `json:"voucherType"`
	VoucherTypeName    string     `json:"voucherTypeName"`
	CustomerName       string     `json:"customerName"`
	Status             Status     `json:"status"`
	StatusLabel        string     `json:"statusLabel"`
	EarliestDeliveryDt *time.Time `json:"earliestDeliveryDate,omitempty"`
	TotalItems         int        `json:"totalItems"`
	ReceivedItems      int        `json:"receivedItems"`
	InProgressItems    int        `json:"inProgressItems"`
	ReadyItems         int        `json:"readyItems"`
	DeliveredItems     int        `json:"deliveredItems"`
	ModifiedItems      int        `json:"modifiedItems"`
	NotModifiedItems   int        `json:"notModifiedItems"`
}

type ReportResponse struct {
	Rows       []ReportRow `json:"rows"`
	TotalCount int         `json:"totalCount"`
	FromDate   string      `json:"fromDate"`
	ToDate     string      `json:"toDate"`
	ReportType string      `json:"reportType"`
}

// NewAlterationReports handles
//
//	GET /api/alterations/reports?type=pending|register&fromDate=Y-M-D&toDate=Y-M-D
//
// Defaults: type=pending, dates=today. Pending excludes Delivered and
// Cancelled alterations; Register includes every alteration in the range.
func NewAlterationReports(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		reportType := strings.TrimSpace(q.Get("type"))
		if reportType == "" {
			reportType = "pending"
		}
		if reportType != "pending" && reportType != "register" {
			writeError(w, http.StatusBadRequest, "invalid report type",
				map[string]any{"type": reportType, "allowed": []string{"pending", "register"}})
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

		rows, err := runAlterationReport(r.Context(), db, reportType, fromDate, toDate)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "report query failed",
				map[string]any{"reason": err.Error()})
			return
		}

		writeJSON(w, http.StatusOK, ReportResponse{
			Rows:       rows,
			TotalCount: len(rows),
			FromDate:   fromDate.Format("2006-01-02"),
			ToDate:     toDate.Format("2006-01-02"),
			ReportType: reportType,
		})
	}
}

func runAlterationReport(
	ctx context.Context,
	db *sql.DB,
	reportType string,
	fromDate time.Time,
	toDate time.Time,
) ([]ReportRow, error) {
	statusFilter := ""
	if reportType == "pending" {
		statusFilter = "AND a.Status NOT IN (3, 4)"
	}

	sqlText := fmt.Sprintf(`
SELECT
    a.QBGUID                  AS AlterationQbguid,
    COALESCE(a.VoucherNo,   '') AS AlterationNo,
    vh.QBGUID                 AS VoucherQbguid,
    vh.VoucherNo,
    vh.VoucherDate,
    vh.VoucherType,
    CASE vh.VoucherType
        WHEN 1090 THEN 'Sales'
        WHEN 1080 THEN 'Sales Order'
        ELSE 'Other'
    END                       AS VoucherTypeName,
    COALESCE(l.LedgerName,  '') AS CustomerName,
    a.Status                  AS Status,
    (SELECT MIN(ai.DeliveryDate)
       FROM dbo.QbVoucherAlterationItems ai
      WHERE ai.AlterationGUID = a.QBGUID
        AND ai.ActiveFlag = 1) AS EarliestDeliveryDate,
    (SELECT COUNT(*) FROM dbo.QbVoucherAlterationItems ai
        WHERE ai.AlterationGUID = a.QBGUID AND ai.ActiveFlag = 1) AS TotalItems,
    (SELECT COUNT(*) FROM dbo.QbVoucherAlterationItems ai
        WHERE ai.AlterationGUID = a.QBGUID AND ai.ActiveFlag = 1 AND ai.Status = 0) AS ReceivedItems,
    (SELECT COUNT(*) FROM dbo.QbVoucherAlterationItems ai
        WHERE ai.AlterationGUID = a.QBGUID AND ai.ActiveFlag = 1 AND ai.Status = 1) AS InProgressItems,
    (SELECT COUNT(*) FROM dbo.QbVoucherAlterationItems ai
        WHERE ai.AlterationGUID = a.QBGUID AND ai.ActiveFlag = 1 AND ai.Status = 2) AS ReadyItems,
    (SELECT COUNT(*) FROM dbo.QbVoucherAlterationItems ai
        WHERE ai.AlterationGUID = a.QBGUID AND ai.ActiveFlag = 1 AND ai.Status = 3) AS DeliveredItems
FROM dbo.QbVoucherAlteration a
INNER JOIN dbo.QbVoucherHeader vh ON vh.QBGUID = a.VoucherHdrGUID
LEFT  JOIN dbo.QbLedger        l  ON l.QBGUID  = vh.PartyGUID
WHERE a.ActiveFlag    = 1
  AND vh.ActiveFlag   = 1
  %s
  AND vh.VoucherDate >= $1
  AND vh.VoucherDate <= $2
ORDER BY
    CASE WHEN $3 = 'pending' THEN
        COALESCE((SELECT MIN(ai.DeliveryDate)
                  FROM dbo.QbVoucherAlterationItems ai
                 WHERE ai.AlterationGUID = a.QBGUID
                   AND ai.ActiveFlag = 1),
               vh.VoucherDate)
    END ASC,
    vh.VoucherDate DESC,
    vh.VoucherNo DESC`, statusFilter)

	rows, err := db.QueryContext(ctx, sqlText, fromDate, toDate, reportType)
	if err != nil {
		return nil, fmt.Errorf("report query: %w", err)
	}
	defer rows.Close()

	var out []ReportRow
	for rows.Next() {
		var r ReportRow
		var status int16
		var earliest sql.NullTime
		if err := rows.Scan(
			&r.AlterationQbguid,
			&r.AlterationNo,
			&r.VoucherQbguid,
			&r.VoucherNo,
			&r.VoucherDate,
			&r.VoucherType,
			&r.VoucherTypeName,
			&r.CustomerName,
			&status,
			&earliest,
			&r.TotalItems,
			&r.ReceivedItems,
			&r.InProgressItems,
			&r.ReadyItems,
			&r.DeliveredItems,
		); err != nil {
			return nil, err
		}
		r.Status = Status(status)
		r.StatusLabel = statusLabel(r.Status)
		if earliest.Valid {
			t := earliest.Time
			r.EarliestDeliveryDt = &t
		}
		r.ModifiedItems = r.InProgressItems + r.ReadyItems + r.DeliveredItems
		r.NotModifiedItems = r.ReceivedItems
		out = append(out, r)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if out == nil {
		out = []ReportRow{}
	}
	return out, nil
}

func statusLabel(s Status) string {
	switch s {
	case StatusReceived:
		return "Received"
	case StatusInProgress:
		return "In Progress"
	case StatusReady:
		return "Ready"
	case StatusDelivered:
		return "Delivered"
	case StatusCancelled:
		return "Cancelled"
	default:
		return "Unknown"
	}
}
