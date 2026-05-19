package alteration

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
)

type allocatedNumber struct {
	Number    int
	Formatted string
}

// allocateVoucherNumber atomically increments QbVoucherNumber for voucher
// type 6010 and returns the new number formatted with the type's prefix +
// delimiter. Must run inside an active transaction; the X lock from the
// UPDATE row serialises concurrent allocators.
func allocateVoucherNumber(ctx context.Context, tx *sql.Tx) (allocatedNumber, error) {
	const prefixSQL = `
SELECT COALESCE(PrefixManual, ''), COALESCE(DelimiterChar, '')
FROM dbo.QbVoucherType
WHERE QBGUID = '6010-Alteration' AND ActiveFlag = 1`

	var prefix, delim string
	err := tx.QueryRowContext(ctx, prefixSQL).Scan(&prefix, &delim)
	if errors.Is(err, sql.ErrNoRows) {
		return allocatedNumber{}, errVoucherTypeNotConfigured
	}
	if err != nil {
		return allocatedNumber{}, fmt.Errorf("read QbVoucherType: %w", err)
	}

	// Postgres' RETURNING returns the new value in one round-trip while
	// the row lock from the UPDATE is still held.
	const incrementSQL = `
UPDATE dbo.QbVoucherNumber
SET VoucherNumber = VoucherNumber + 1
WHERE VchTypeGuid = '6010-Alteration' AND ActiveFlag = 1
RETURNING VoucherNumber`

	var newNumber int
	err = tx.QueryRowContext(ctx, incrementSQL).Scan(&newNumber)
	if errors.Is(err, sql.ErrNoRows) {
		return allocatedNumber{}, errCounterNotConfigured
	}
	if err != nil {
		return allocatedNumber{}, fmt.Errorf("increment QbVoucherNumber: %w", err)
	}

	var formatted string
	if delim != "" {
		formatted = fmt.Sprintf("%s%s%d", prefix, delim, newNumber)
	} else {
		formatted = fmt.Sprintf("%s%d", strings.TrimSpace(prefix), newNumber)
	}

	return allocatedNumber{Number: newNumber, Formatted: formatted}, nil
}
