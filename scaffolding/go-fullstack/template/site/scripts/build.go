//go:build ignore

package main

import (
	"fmt"
	"os"

	"github.com/evanw/esbuild/pkg/api"
)

func main() {
	isProd := os.Getenv("GO_ENV") == "production"

	sourcemap := api.SourceMapNone
	if !isProd {
		sourcemap = api.SourceMapLinked
	}

	result := api.Build(api.BuildOptions{
		EntryPoints: []string{"web/static/js/islands/index.ts"},
		Outfile:     "web/dist/js/islands.js",
		Bundle:      true,
		Write:       true,
		Format:      api.FormatESModule,
		Platform:    api.PlatformBrowser,
		Target:      api.ES2020,
		JSX:         api.JSXAutomatic,
		Sourcemap:   sourcemap,
		MinifySyntax:      isProd,
		MinifyWhitespace:  isProd,
		MinifyIdentifiers: isProd,
	})

	if len(result.Errors) > 0 {
		for _, err := range result.Errors {
			fmt.Fprintf(os.Stderr, "Build error: %s\n", err.Text)
		}
		os.Exit(1)
	}
}
