package web

import (
	"embed"
	"io/fs"
)

//go:embed all:dist
var distFS embed.FS

// DistFS returns the embedded dist filesystem
var DistFS, _ = fs.Sub(distFS, "dist")
