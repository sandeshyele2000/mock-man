package runtime

import (
	"net/http"
	"slices"
	"strings"
)

// CORS permits explicitly configured development origins. It never enables credentials.
func CORS(next http.Handler, origins []string) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if origin != "" && slices.Contains(origins, origin) {
			w.Header().Add("Vary", "Origin")
			w.Header().Set("Access-Control-Allow-Origin", origin)
			if r.Method == "OPTIONS" && r.Header.Get("Access-Control-Request-Method") != "" {
				w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS")
				headers := r.Header.Get("Access-Control-Request-Headers")
				// net/http validates wire header values; echo only tokens, never arbitrary field text.
				for _, name := range strings.Split(headers, ",") {
					if strings.TrimSpace(name) == "" {
						continue
					}
					for _, c := range strings.TrimSpace(name) {
						if !strings.ContainsRune("!#$%&'*+-.^_`|~0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ", c) {
							http.Error(w, "invalid preflight headers", 400)
							return
						}
					}
				}
				w.Header().Set("Access-Control-Allow-Headers", headers)
				w.Header().Add("Vary", "Access-Control-Request-Headers")
				w.WriteHeader(http.StatusNoContent)
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}
