package main

import (
	"encoding/json"
	"log"
	"net/http"
	"os"

	_ "github.com/joho/godotenv/autoload"

	"alteration-app/internal/alteration"
	"alteration-app/internal/db"
)

func main() {
	conn, err := db.Open()
	if err != nil {
		log.Printf("db: %v — starting without database; endpoints will return 503", err)
		log.Printf("edit .env to set DATABASE_URL (sqlserver:// DSN) and restart")
	} else {
		defer conn.Close()
		log.Printf("db: connected (SQL Server)")
	}

	mux := http.NewServeMux()

	if conn != nil {
		mux.Handle("GET /api/vouchers/for-alteration",
			alteration.NewListBillsForAlteration(conn))
		mux.Handle("GET /api/voucher/{qbguid}/alteration",
			alteration.NewGetVoucherAlteration(conn))
		mux.Handle("POST /api/voucher/{qbguid}/alteration",
			alteration.NewSaveVoucherAlteration(conn))
		mux.Handle("PATCH /api/alterations/{qbguid}/status",
			alteration.NewUpdateAlterationStatus(conn))
		mux.Handle("PATCH /api/alterations/{qbguid}/items/{itemQbguid}/status",
			alteration.NewUpdateAlterationItemStatus(conn))
		mux.Handle("GET /api/alterations/reports",
			alteration.NewAlterationReports(conn))
	} else {
		mux.HandleFunc("GET /api/vouchers/for-alteration", dbUnavailable)
		mux.HandleFunc("GET /api/voucher/{qbguid}/alteration", dbUnavailable)
		mux.HandleFunc("POST /api/voucher/{qbguid}/alteration", dbUnavailable)
		mux.HandleFunc("PATCH /api/alterations/{qbguid}/status", dbUnavailable)
		mux.HandleFunc("PATCH /api/alterations/{qbguid}/items/{itemQbguid}/status", dbUnavailable)
		mux.HandleFunc("GET /api/alterations/reports", dbUnavailable)
	}

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}
	addr := ":" + port

	log.Printf("alteration-app listening on %s", addr)
	if err := http.ListenAndServe(addr, withCORS(mux)); err != nil {
		log.Fatal(err)
	}
}

func withCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "https://alteration-app-uuc8.vercel.app")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		w.Header().Set("Vary", "Origin")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func dbUnavailable(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusServiceUnavailable)
	_ = json.NewEncoder(w).Encode(map[string]any{
		"error":  "database not configured",
		"status": http.StatusServiceUnavailable,
		"detail": "edit .env to set DATABASE_URL (sqlserver:// DSN) and restart the server",
	})
}
