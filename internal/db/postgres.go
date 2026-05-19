// Package db opens the connection to the alteration-app Postgres database.
package db

import (
	"database/sql"
	"fmt"
	"os"
	"time"

	_ "github.com/jackc/pgx/v5/stdlib"
)

// Open reads DATABASE_URL (postgres:// DSN) and returns a verified
// connection pool. Caller owns Close().
//
// Example DSN:
//
//	postgres://user:pass@host:5432/dbname?sslmode=require
func Open() (*sql.DB, error) {
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		return nil, fmt.Errorf("DATABASE_URL not set")
	}

	db, err := sql.Open("pgx", dsn)
	if err != nil {
		return nil, fmt.Errorf("sql.Open: %w", err)
	}

	db.SetMaxOpenConns(25)
	db.SetMaxIdleConns(25)
	db.SetConnMaxLifetime(5 * time.Minute)

	if err := db.Ping(); err != nil {
		db.Close()
		return nil, fmt.Errorf("ping: %w", err)
	}
	return db, nil
}
