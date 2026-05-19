// sync-from-sqlserver — one-way sync of QuickBill's read-only tables from
// SQL Server into the alteration app's Postgres database.
//
// What it syncs (UPSERT by primary key):
//   - QbLedger, QbVoucherHeader, QbVoucherItems, QbItemMaster,
//     QbMaillingAddress, QbVoucherType (excluding the 6010-Alteration row)
//
// What it deliberately does NOT touch:
//   - QbVoucherAlteration, QbVoucherAlterationItems  (the app owns these)
//   - QbVoucherNumber                                (the alteration counter)
//
// Soft deletes (ActiveFlag = 0 in QuickBill) propagate via the UPSERT,
// and the Go web app's existing `WHERE ActiveFlag = 1` filters do the rest.
//
// Usage:
//   sync-from-sqlserver               # loop forever, default 10s interval
//   sync-from-sqlserver -interval 5s  # custom interval
//   sync-from-sqlserver -once         # one pass then exit (for testing / cron)
package main

import (
	"context"
	"database/sql"
	"errors"
	"flag"
	"fmt"
	"log"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	_ "github.com/jackc/pgx/v5/stdlib"
	_ "github.com/joho/godotenv/autoload"
	_ "github.com/microsoft/go-mssqldb"
)

var (
	intervalFlag = flag.Duration("interval", 10*time.Second, "polling interval")
	onceFlag     = flag.Bool("once", false, "run a single sync pass then exit")
)

// tableSync defines one source→destination mapping.
type tableSync struct {
	name      string
	sourceSQL string
	upsertSQL string
	scan      func(rows *sql.Rows) ([]any, error)
}

func main() {
	flag.Parse()

	sqlServerURL := os.Getenv("SQLSERVER_URL")
	if sqlServerURL == "" {
		log.Fatal("SQLSERVER_URL not set in .env (sqlserver:// DSN of QuickBill's database)")
	}
	pgURL := os.Getenv("DATABASE_URL")
	if pgURL == "" {
		log.Fatal("DATABASE_URL not set in .env (postgres:// DSN of the alteration database)")
	}

	src, err := openDB("sqlserver", sqlServerURL, "SQL Server")
	if err != nil {
		log.Fatal(err)
	}
	defer src.Close()

	dst, err := openDB("pgx", pgURL, "Postgres")
	if err != nil {
		log.Fatal(err)
	}
	defer dst.Close()

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	log.Printf("sync ready — interval=%s, once=%v", *intervalFlag, *onceFlag)

	for {
		if err := runOnce(ctx, src, dst); err != nil {
			if errors.Is(err, context.Canceled) {
				log.Print("interrupted, exiting")
				return
			}
			log.Printf("sync error: %v", err)
		}
		if *onceFlag {
			return
		}
		select {
		case <-ctx.Done():
			log.Print("interrupted, exiting")
			return
		case <-time.After(*intervalFlag):
		}
	}
}

func openDB(driver, dsn, label string) (*sql.DB, error) {
	db, err := sql.Open(driver, dsn)
	if err != nil {
		return nil, fmt.Errorf("open %s: %w", label, err)
	}
	db.SetMaxOpenConns(5)
	db.SetMaxIdleConns(5)
	db.SetConnMaxLifetime(5 * time.Minute)
	if err := db.Ping(); err != nil {
		db.Close()
		return nil, fmt.Errorf("ping %s: %w", label, err)
	}
	log.Printf("connected: %s", label)
	return db, nil
}

func runOnce(ctx context.Context, src, dst *sql.DB) error {
	start := time.Now()
	parts := make([]string, 0, len(tableSyncs))
	for _, t := range tableSyncs {
		n, err := syncTable(ctx, src, dst, t)
		if err != nil {
			return fmt.Errorf("%s: %w", t.name, err)
		}
		parts = append(parts, fmt.Sprintf("%s=%d", t.name, n))
	}
	log.Printf("synced in %s [%s]", time.Since(start).Truncate(time.Millisecond), strings.Join(parts, ", "))
	return nil
}

// syncTable streams rows from the source query and UPSERTs into the destination.
func syncTable(ctx context.Context, src, dst *sql.DB, t tableSync) (int, error) {
	rows, err := src.QueryContext(ctx, t.sourceSQL)
	if err != nil {
		return 0, fmt.Errorf("source query: %w", err)
	}
	defer rows.Close()

	tx, err := dst.BeginTx(ctx, nil)
	if err != nil {
		return 0, fmt.Errorf("begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	stmt, err := tx.PrepareContext(ctx, t.upsertSQL)
	if err != nil {
		return 0, fmt.Errorf("prepare upsert: %w", err)
	}
	defer stmt.Close()

	count := 0
	for rows.Next() {
		vals, err := t.scan(rows)
		if err != nil {
			return 0, fmt.Errorf("scan row: %w", err)
		}
		if _, err := stmt.ExecContext(ctx, vals...); err != nil {
			return 0, fmt.Errorf("upsert row: %w", err)
		}
		count++
	}
	if err := rows.Err(); err != nil {
		return 0, fmt.Errorf("row iter: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return 0, fmt.Errorf("commit: %w", err)
	}
	return count, nil
}

// tableSyncs lists every table we mirror, in FK-safe insert order
// (parents before children).
var tableSyncs = []tableSync{
	{
		name: "QbLedger",
		sourceSQL: `SELECT QBGUID, ISNULL(LedgerName, ''), ISNULL(ActiveFlag, 1)
FROM dbo.QbLedger`,
		upsertSQL: `INSERT INTO dbo.QbLedger (QBGUID, LedgerName, ActiveFlag)
VALUES ($1, $2, $3)
ON CONFLICT (QBGUID) DO UPDATE SET
  LedgerName = EXCLUDED.LedgerName,
  ActiveFlag = EXCLUDED.ActiveFlag`,
		scan: func(rows *sql.Rows) ([]any, error) {
			var qbguid, name string
			var active int16
			if err := rows.Scan(&qbguid, &name, &active); err != nil {
				return nil, err
			}
			return []any{qbguid, name, active}, nil
		},
	},
	{
		name: "QbItemMaster",
		sourceSQL: `SELECT QBGUID, ISNULL(StockNo, ''), ISNULL(ItemDescription, ''), ISNULL(ActiveFlag, 1)
FROM dbo.QbItemMaster`,
		upsertSQL: `INSERT INTO dbo.QbItemMaster (QBGUID, StockNo, ItemDescription, ActiveFlag)
VALUES ($1, $2, $3, $4)
ON CONFLICT (QBGUID) DO UPDATE SET
  StockNo         = EXCLUDED.StockNo,
  ItemDescription = EXCLUDED.ItemDescription,
  ActiveFlag      = EXCLUDED.ActiveFlag`,
		scan: func(rows *sql.Rows) ([]any, error) {
			var qbguid, stock, desc string
			var active int16
			if err := rows.Scan(&qbguid, &stock, &desc, &active); err != nil {
				return nil, err
			}
			return []any{qbguid, stock, desc, active}, nil
		},
	},
	{
		name: "QbMaillingAddress",
		sourceSQL: `SELECT QBGUID, LinkGUID, ISNULL(MobileNo, ''), ISNULL(AddressType, ''), ISNULL(ActiveFlag, 1)
FROM dbo.QbMaillingAddress`,
		upsertSQL: `INSERT INTO dbo.QbMaillingAddress (QBGUID, LinkGUID, MobileNo, AddressType, ActiveFlag)
VALUES ($1, $2, $3, $4, $5)
ON CONFLICT (QBGUID) DO UPDATE SET
  LinkGUID    = EXCLUDED.LinkGUID,
  MobileNo    = EXCLUDED.MobileNo,
  AddressType = EXCLUDED.AddressType,
  ActiveFlag  = EXCLUDED.ActiveFlag`,
		scan: func(rows *sql.Rows) ([]any, error) {
			var qbguid, linkGUID, mobile, atype string
			var active int16
			if err := rows.Scan(&qbguid, &linkGUID, &mobile, &atype, &active); err != nil {
				return nil, err
			}
			return []any{qbguid, linkGUID, mobile, atype, active}, nil
		},
	},
	{
		name: "QbVoucherType",
		// Skip 6010-Alteration — that row is owned by the alteration app and
		// pre-seeded by 001_init_postgres.sql.
		sourceSQL: `SELECT QBGUID, ISNULL(PrefixManual, ''), ISNULL(DelimiterChar, ''), ISNULL(ActiveFlag, 1)
FROM dbo.QbVoucherType
WHERE QBGUID <> '6010-Alteration'`,
		upsertSQL: `INSERT INTO dbo.QbVoucherType (QBGUID, PrefixManual, DelimiterChar, ActiveFlag)
VALUES ($1, $2, $3, $4)
ON CONFLICT (QBGUID) DO UPDATE SET
  PrefixManual  = EXCLUDED.PrefixManual,
  DelimiterChar = EXCLUDED.DelimiterChar,
  ActiveFlag    = EXCLUDED.ActiveFlag`,
		scan: func(rows *sql.Rows) ([]any, error) {
			var qbguid, prefix, delim string
			var active int16
			if err := rows.Scan(&qbguid, &prefix, &delim, &active); err != nil {
				return nil, err
			}
			return []any{qbguid, prefix, delim, active}, nil
		},
	},
	{
		name: "QbVoucherHeader",
		sourceSQL: `SELECT QBGUID, ISNULL(VoucherNo, ''), VoucherDate, VoucherType,
       ISNULL(PartyGUID, ''), ISNULL(ActiveFlag, 1)
FROM dbo.QbVoucherHeader`,
		upsertSQL: `INSERT INTO dbo.QbVoucherHeader (QBGUID, VoucherNo, VoucherDate, VoucherType, PartyGUID, ActiveFlag)
VALUES ($1, $2, $3, $4, $5, $6)
ON CONFLICT (QBGUID) DO UPDATE SET
  VoucherNo   = EXCLUDED.VoucherNo,
  VoucherDate = EXCLUDED.VoucherDate,
  VoucherType = EXCLUDED.VoucherType,
  PartyGUID   = EXCLUDED.PartyGUID,
  ActiveFlag  = EXCLUDED.ActiveFlag`,
		scan: func(rows *sql.Rows) ([]any, error) {
			var qbguid, voucherNo, partyGUID string
			var voucherDate time.Time
			var voucherType int
			var active int16
			if err := rows.Scan(&qbguid, &voucherNo, &voucherDate, &voucherType, &partyGUID, &active); err != nil {
				return nil, err
			}
			// nullable partyguid: keep NULL semantics by passing nil when empty
			var partyArg any = partyGUID
			if partyGUID == "" {
				partyArg = nil
			}
			return []any{qbguid, voucherNo, voucherDate, voucherType, partyArg, active}, nil
		},
	},
	{
		name: "QbVoucherItems",
		sourceSQL: `SELECT QBGUID, VchHdrGUID, ISNULL(SerialNo, 0),
       ISNULL(ItemGUID, ''), ISNULL(DocQty, 0), ISNULL(ActiveFlag, 1)
FROM dbo.QbVoucherItems`,
		upsertSQL: `INSERT INTO dbo.QbVoucherItems (QBGUID, VchHdrGUID, SerialNo, ItemGUID, DocQty, ActiveFlag)
VALUES ($1, $2, $3, $4, $5, $6)
ON CONFLICT (QBGUID) DO UPDATE SET
  VchHdrGUID = EXCLUDED.VchHdrGUID,
  SerialNo   = EXCLUDED.SerialNo,
  ItemGUID   = EXCLUDED.ItemGUID,
  DocQty     = EXCLUDED.DocQty,
  ActiveFlag = EXCLUDED.ActiveFlag`,
		scan: func(rows *sql.Rows) ([]any, error) {
			var qbguid, vchHdr, itemGUID string
			var serial int
			var docQty float64
			var active int16
			if err := rows.Scan(&qbguid, &vchHdr, &serial, &itemGUID, &docQty, &active); err != nil {
				return nil, err
			}
			var itemArg any = itemGUID
			if itemGUID == "" {
				itemArg = nil
			}
			return []any{qbguid, vchHdr, serial, itemArg, docQty, active}, nil
		},
	},
}
