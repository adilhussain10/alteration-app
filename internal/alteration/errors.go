package alteration

import "errors"

var (
	errVoucherNotFound          = errors.New("voucher not found")
	errVoucherTypeNotConfigured = errors.New("voucher type 6010 not configured in QbVoucherType")
	errCounterNotConfigured     = errors.New("voucher number counter for 6010 not configured")
)

// validationError is a typed error for client-fixable problems. Mapped to 400
// by the save handler.
type validationError struct {
	Code    string
	Message string
	Details map[string]any
}

func (e *validationError) Error() string { return e.Message }
