module github.com/rumor-ml/commons.systems/audioupload/backend

go 1.21

require (
	github.com/rumor-ml/commons.systems/gcsupload v0.0.0
	cloud.google.com/go/firestore v1.15.0
	cloud.google.com/go/storage v1.38.0
)

replace github.com/rumor-ml/commons.systems/gcsupload => ../../gcsupload
