package storage

import (
	"bytes"
	"encoding/base64"
	"strings"
	"testing"
	"unicode/utf8"
)

func TestCapturePayload(t *testing.T) {
	for _, test := range []struct {
		name     string
		raw      []byte
		encoding string
	}{
		{"JSON preserves formatting and large numbers", []byte("{\n  \"id\": 9007199254740993\n}"), "utf-8"},
		{"form", []byte("name=Jane+Doe&enabled=true"), "utf-8"},
		{"invalid JSON", []byte("{broken"), "utf-8"},
		{"empty", nil, "utf-8"},
		{"unicode", []byte("hello 世界"), "utf-8"},
		{"binary", []byte{255, 254, 128}, "base64"},
		{"NUL safe for JSONB", []byte{'a', 0, 'b'}, "base64"},
	} {
		t.Run(test.name, func(t *testing.T) {
			got := capturePayload(test.raw, "application/custom")
			if got.SizeBytes != len(test.raw) || got.Truncated || got.ContentType != "application/custom" || got.Encoding != test.encoding {
				t.Fatalf("unexpected metadata: %+v", got)
			}
			restored := []byte(got.Body)
			if got.Encoding == "base64" {
				var err error
				restored, err = base64.StdEncoding.DecodeString(got.Body)
				if err != nil {
					t.Fatal(err)
				}
			}
			if !bytes.Equal(restored, test.raw) {
				t.Fatalf("body changed: %q", got.Body)
			}
		})
	}
}

func TestCapturePayloadLimit(t *testing.T) {
	raw := []byte(strings.Repeat("a", maxPayloadBytes-1) + "界" + strings.Repeat("b", 30))
	got := capturePayload(raw, "text/plain")
	if !got.Truncated || got.SizeBytes != len(raw) || !utf8.ValidString(got.Body) || len(got.Body) != maxPayloadBytes-1 {
		t.Fatalf("invalid UTF-8 truncation: size=%d metadata=%+v", len(got.Body), got)
	}
	binary := bytes.Repeat([]byte{255}, maxPayloadBytes+20)
	got = capturePayload(binary, "application/octet-stream")
	decoded, err := base64.StdEncoding.DecodeString(got.Body)
	if err != nil || !got.Truncated || len(decoded) != maxPayloadBytes || got.SizeBytes != len(binary) {
		t.Fatalf("invalid binary truncation: %v %+v", err, got)
	}
	exact := capturePayload(bytes.Repeat([]byte{'a'}, maxPayloadBytes), "text/plain")
	if exact.Truncated {
		t.Fatal("exact limit should not be truncated")
	}
}
