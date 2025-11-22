module github.com/rumor-ml/commons.systems/audioupload/backend

go 1.21

require (
	github.com/rumor-ml/commons.systems/gcsupload v0.0.0
	github.com/dhowden/tag v0.0.0-20220319224024-decb1bb2e90d
	github.com/go-fingerprint/fingerprint v0.0.0-20140122210459-1a0f5c6b20b0
	github.com/go-fingerprint/gochroma v0.0.0-20160306042555-37f79e2f1a4e
	cloud.google.com/go/firestore v1.15.0
	cloud.google.com/go/storage v1.38.0
)

replace github.com/rumor-ml/commons.systems/gcsupload => ../../gcsupload
