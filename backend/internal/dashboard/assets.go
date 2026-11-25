//go:build dashboard

package dashboard

import (
	"embed"
	"io/fs"
)

//go:embed all:dist
var embedded embed.FS

var files = func() fs.FS {
	content, err := fs.Sub(embedded, "dist")
	if err != nil {
		panic(err)
	}
	return content
}()
