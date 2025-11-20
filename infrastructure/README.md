# Infrastructure

All infrastructure documentation has been consolidated into the main [README.md](../README.md).

Please see:
- [Architecture](../README.md#architecture)
- [Deployment](../README.md#deployment)
- [CI/CD Pipeline](../README.md#cicd-pipeline)
- [Cost Optimization](../README.md#cost)
- [Troubleshooting](../README.md#troubleshooting)

## Cloud Run Migration

This project has migrated from GCS + CDN to Cloud Run architecture.

📖 **[Migration Guide](MIGRATION_GUIDE.md)** - Complete guide for cleaning up old infrastructure

### Quick Reference

**Cleanup old infrastructure:**
```bash
cd infrastructure/scripts
./cleanup-old-infrastructure.sh
```

**Monitor Cloud Run deployment:**
```bash
gcloud run services describe fellspiral-site \
  --region=us-central1 \
  --project=chalanding
```
