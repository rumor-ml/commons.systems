module github.com/rumor-ml/server

go 1.24.0

require (
	github.com/mattn/go-sqlite3 v1.14.32
	github.com/rumor-ml/log v0.0.0
	github.com/rumor-ml/store v0.0.0
)

replace github.com/rumor-ml/log => ../log
replace github.com/rumor-ml/store => ../store
