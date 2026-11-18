package storage

import (
	"bytes"
	"encoding/base64"
	"unicode/utf8"
)

const maxPayloadBytes = 64 << 10

// Payload preserves body bytes independently from the JSON used for matching.
type Payload struct {
	Body        string `json:"body"`
	Encoding    string `json:"encoding"`
	ContentType string `json:"contentType"`
	SizeBytes   int    `json:"sizeBytes"`
	Truncated   bool   `json:"truncated"`
}

func capturePayload(raw []byte, contentType string) *Payload {
	payload := &Payload{Encoding: "utf-8", ContentType: contentType, SizeBytes: len(raw)}
	captured := raw
	if len(captured) > maxPayloadBytes {
		captured = captured[:maxPayloadBytes]
		payload.Truncated = true
	}
	// PostgreSQL JSONB cannot store NUL characters, even in valid UTF-8 text.
	if !utf8.Valid(raw) || bytes.IndexByte(raw, 0) >= 0 {
		payload.Encoding = "base64"
		payload.Body = base64.StdEncoding.EncodeToString(captured)
	} else {
		// A byte limit can split a multi-byte character. Keep only complete characters.
		for !utf8.Valid(captured) {
			captured = captured[:len(captured)-1]
		}
		payload.Body = string(captured)
	}
	return payload
}
