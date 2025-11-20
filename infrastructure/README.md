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

📖 **[Migration Guide](MIGRATION_GUIDE.md)** - Complete migration documentation

### Quick Reference

**Cleanup happens automatically via Terraform!**
- When this PR merges to main, the Infrastructure workflow runs
- Terraform detects removed resources and destroys them
- No manual cleanup needed

**Monitor Cloud Run deployment:**
```bash
gcloud run services describe fellspiral-site \
  --region=us-central1 \
  --project=chalanding
```

**Check what Terraform will remove:**
```bash
cd infrastructure/terraform
terraform plan  # Shows resources to be destroyed
```
