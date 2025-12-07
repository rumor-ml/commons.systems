//go:build ignore

package main

import (
	"os"

	"github.com/evanw/esbuild/pkg/api"
)

func main() {
	isProd := os.Getenv("GO_ENV") == "production"

	result := api.Build(api.BuildOptions{
		EntryPoints:       []string{"web/static/js/islands/index.ts"},
		Outfile:           "web/dist/js/islands.js",
		Bundle:            true,
		Write:             true,
		Format:            api.FormatESModule,
		Platform:          api.PlatformBrowser,
		Target:            api.ES2020,
		JSX:               api.JSXAutomatic,
		MinifySyntax:      isProd,
		MinifyWhitespace:  isProd,
		MinifyIdentifiers: isProd,
	})

	if len(result.Errors) > 0 {
		os.Exit(1)
	}
}
