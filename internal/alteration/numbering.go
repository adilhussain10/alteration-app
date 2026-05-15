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
SELECT ISNULL(PrefixManual, ''), ISNULL(DelimiterChar, '')
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

	// SQL Server's OUTPUT INSERTED.<col> returns the new value in one
	// round-trip while the X lock is still held on the row.
	const incrementSQL = `
UPDATE dbo.QbVoucherNumber
SET VoucherNumber = VoucherNumber + 1
OUTPUT INSERTED.VoucherNumber
WHERE VchTypeGuid = '6010-Alteration' AND ActiveFlag = 1`

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
