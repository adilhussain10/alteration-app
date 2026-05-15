package alteration

import (
	"encoding/json"
	"net/http"
)

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

func writeError(w http.ResponseWriter, status int, message string, detail any) {
	body := map[string]any{
		"error":   message,
		"status":  status,
	}
	if detail != nil {
		body["detail"] = detail
	}
	writeJSON(w, status, body)
}
