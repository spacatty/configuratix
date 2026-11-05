package models

import (
	"database/sql/driver"
	"encoding/json"
	"fmt"
)

// NullRawMessage is a json.RawMessage that scans SQL NULL (as nil) and marshals nil as JSON null.
// Use it for nullable JSONB columns; plain json.RawMessage cannot scan NULL.
type NullRawMessage json.RawMessage

// Scan implements sql.Scanner.
func (m *NullRawMessage) Scan(src interface{}) error {
	switch v := src.(type) {
	case nil:
		*m = nil
	case []byte:
		*m = append((*m)[:0], v...)
	case string:
		*m = NullRawMessage(v)
	default:
		return fmt.Errorf("NullRawMessage: unsupported Scan type %T", src)
	}
	return nil
}

// Value implements driver.Valuer.
func (m NullRawMessage) Value() (driver.Value, error) {
	if len(m) == 0 {
		return nil, nil
	}
	return []byte(m), nil
}

// MarshalJSON emits the raw JSON, or null when empty.
func (m NullRawMessage) MarshalJSON() ([]byte, error) {
	if len(m) == 0 {
		return []byte("null"), nil
	}
	return m, nil
}

// UnmarshalJSON stores a copy of the raw JSON.
func (m *NullRawMessage) UnmarshalJSON(data []byte) error {
	*m = append((*m)[:0], data...)
	return nil
}
