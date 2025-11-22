module github.com/rumor-ml/server

go 1.24.0

require (
	github.com/mattn/go-sqlite3 v1.14.32
	github.com/n8/testing-framework v0.0.0
	github.com/rumor-ml/log v0.0.0
	github.com/rumor-ml/store v0.0.0
	github.com/external/package v1.2.3
)

replace github.com/n8/testing-framework => ../testing-framework
replace github.com/rumor-ml/log => ../log
replace github.com/rumor-ml/store => ../store
replace github.com/external/package => github.com/fork/package v1.3.0
