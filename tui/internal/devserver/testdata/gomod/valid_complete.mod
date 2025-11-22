module github.com/rumor-ml/server

go 1.24.0

toolchain go1.24.10

require (
	github.com/mattn/go-sqlite3 v1.14.32
	github.com/n8/testing-framework v0.0.0
	github.com/rumor-ml/audio v0.0.0-00010101000000-000000000000
	github.com/rumor-ml/carriercommons v0.0.0-00010101000000-000000000000
	github.com/rumor-ml/finance v0.0.0-00010101000000-000000000000
	github.com/rumor-ml/log v0.0.0
	github.com/rumor-ml/store v0.0.0
	github.com/rumor-ml/video v0.0.0-00010101000000-000000000000
)

replace github.com/n8/testing-framework => ../testing-framework
replace github.com/rumor-ml/audio => ../audio
replace github.com/rumor-ml/carriercommons => ..
replace github.com/rumor-ml/finance => ../finance
replace github.com/rumor-ml/log => ../log
replace github.com/rumor-ml/store => ../store
replace github.com/rumor-ml/video => ../video
