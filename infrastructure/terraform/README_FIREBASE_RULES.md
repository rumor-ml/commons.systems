# Firebase Security Rules Management

Firebase security rules for Firestore and Storage are managed via Terraform (Infrastructure as Code).

## Overview

Security rules are automatically deployed when you push changes to the repository. The IaC workflow (`.github/workflows/push.yml`) runs Terraform, which deploys the rules defined in:

- `firestore.rules` - Firestore database security rules
- `storage.rules` - Cloud Storage security rules

## Terraform Configuration

**File:** `infrastructure/terraform/firebase.tf`

The Terraform configuration:
1. Reads the rules files from the repository root
2. Creates Firebase rulesets
3. Releases the rulesets to production

**Resources:**
- `google_firebaserules_ruleset.firestore` - Firestore ruleset
- `google_firebaserules_ruleset.storage` - Storage ruleset
- `google_firebaserules_release.firestore` - Deploy Firestore rules
- `google_firebaserules_release.storage` - Deploy Storage rules

## How It Works

### Automatic Deployment (Recommended)

```
1. Edit firestore.rules or storage.rules
   ↓
2. Commit changes
   ↓
3. Push to GitHub
   ↓
4. IaC workflow triggers
   ↓
5. Terraform reads updated rules files
   ↓
6. Terraform creates new rulesets
   ↓
7. Terraform releases to production
   ↓
8. Rules are live in Firebase
```

**Example:**
```bash
# Edit rules
vim firestore.rules

# Commit
git add firestore.rules
git commit -m "Update Firestore security rules"

# Push (triggers automatic deployment)
git push

# Monitor deployment
# Check GitHub Actions → IaC workflow
# Rules deployed in ~2-3 minutes
```

### Manual Deployment (Optional)

If you need immediate deployment without waiting for CI/CD:

**Option 1: Firebase CLI**
```bash
firebase deploy --only firestore:rules,storage:rules --project chalanding
```

**Option 2: Terraform Locally**
```bash
cd infrastructure/terraform

# Initialize
terraform init

# Plan
terraform plan -var="project_id=chalanding" -var="region=us-central1"

# Apply
terraform apply -var="project_id=chalanding" -var="region=us-central1"
```

## Rules Files

### firestore.rules

Location: `/firestore.rules`

**Purpose:** Security rules for Firestore database

**Current Rules:**
- Require authentication for all reads
- Require authentication for all writes
- Track document creator (`createdBy` field)
- Enforce creator ownership for updates/deletes

**Example:**
```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /cards/{cardId} {
      allow read: if request.auth != null;
      allow create: if request.auth != null
                    && request.resource.data.createdBy == request.auth.uid;
      allow update: if request.auth != null
                    && resource.data.createdBy == request.auth.uid;
      allow delete: if request.auth != null
                    && resource.data.createdBy == request.auth.uid;
    }
  }
}
```

### storage.rules

Location: `/storage.rules`

**Purpose:** Security rules for Cloud Storage

**Current Rules:**
- Require authentication for all reads
- Require authentication for all writes
- Apply to video files and user uploads

**Example:**
```
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /video/{videoFile} {
      allow read: if request.auth != null;
      allow write: if request.auth != null;
    }
  }
}
```

## Editing Rules

### Best Practices

1. **Test Locally First**
   - Use Firebase Emulator Suite to test rules locally
   - Ensure rules work as expected before deploying

2. **Version Control**
   - Always commit rules changes
   - Use descriptive commit messages
   - Reference related issues/PRs

3. **Review Changes**
   - Review rules carefully before pushing
   - Test with different auth states
   - Consider edge cases

4. **Deploy Safely**
   - Use automatic deployment for production
   - Test in staging/preview environments first
   - Monitor Firebase Console after deployment

### Common Patterns

**Require Authentication:**
```javascript
allow read, write: if request.auth != null;
```

**Ownership-Based Access:**
```javascript
allow write: if request.auth != null
             && request.resource.data.createdBy == request.auth.uid;
```

**Public Read, Auth Write:**
```javascript
allow read: if true;
allow write: if request.auth != null;
```

**Custom Claims:**
```javascript
allow write: if request.auth != null
             && request.auth.token.admin == true;
```

## Monitoring & Verification

### Check Deployment Status

**GitHub Actions:**
1. Go to repository → Actions
2. Find the push workflow run
3. Check "Infrastructure as Code" job
4. Look for Terraform Apply step

**Firebase Console:**
1. Go to [Firebase Console](https://console.firebase.google.com/project/chalanding)
2. Navigate to Firestore → Rules or Storage → Rules
3. Check "Published" timestamp
4. Review active rules

**Terraform Outputs:**
```bash
cd infrastructure/terraform
terraform output firestore_rules_version
terraform output storage_rules_version
```

### Verify Rules Work

**Test Authentication Requirement:**
```javascript
// Should fail (not authenticated)
const db = getFirestore();
await getDocs(collection(db, 'cards')); // Error: Missing permissions

// Should succeed (authenticated)
await signInWithGitHub();
await getDocs(collection(db, 'cards')); // ✓ Success
```

**Check Firebase Console:**
1. Firestore → Rules → "Rules playground"
2. Test different scenarios
3. Verify expected behavior

## Troubleshooting

### Rules Not Deploying

**Issue:** Rules don't update after push

**Solutions:**
1. Check GitHub Actions workflow status
2. Verify Terraform didn't fail
3. Check for syntax errors in rules files
4. Ensure Firebase API is enabled

### Permission Denied Errors

**Issue:** Operations fail with "permission-denied"

**Diagnosis:**
1. Check if user is authenticated
2. Verify rules syntax is correct
3. Test in Firebase Console Rules Playground
4. Check auth token claims

**Common Causes:**
- User not signed in
- Rules syntax error
- Missing required fields
- Incorrect field validation

### Syntax Errors

**Issue:** Rules fail to deploy

**Solutions:**
1. Check rules syntax with Firebase CLI:
   ```bash
   firebase deploy --only firestore:rules --dry-run
   ```
2. Use Firebase Console Rules editor for validation
3. Check for common mistakes:
   - Missing semicolons
   - Incorrect function names
   - Wrong path syntax

### Deployment Timeouts

**Issue:** Terraform times out deploying rules

**Solutions:**
1. Retry the workflow
2. Deploy manually with Firebase CLI
3. Check Firebase API rate limits
4. Verify Firebase project is accessible

## Integration with Authentication

The security rules work with the GitHub OAuth authentication:

1. **User Signs In** → Firebase Auth creates user
2. **User Gets Token** → Token includes `uid`
3. **User Accesses Data** → Rules check `request.auth.uid`
4. **Rules Enforce** → Only authenticated users allowed

**Flow:**
```
User → Sign in with GitHub
  ↓
Firebase Auth creates session
  ↓
User has auth token with uid
  ↓
User tries to create document
  ↓
Firestore rules check request.auth != null
  ↓
Rules check createdBy == request.auth.uid
  ↓
Operation allowed or denied
```

## CI/CD Integration

**Workflow:** `.github/workflows/push.yml`

**IaC Job Steps:**
1. Checkout code
2. Authenticate with GCP
3. Create Terraform state bucket
4. Setup Terraform
5. Create tfvars file
6. Terraform init
7. Terraform validate
8. Terraform plan
9. **Terraform apply** ← Rules deployed here

**Dependencies:**
- Requires Firebase APIs enabled
- Needs appropriate IAM permissions
- Must have Terraform state bucket

## Additional Resources

- [Firebase Security Rules Docs](https://firebase.google.com/docs/rules)
- [Firestore Rules Reference](https://firebase.google.com/docs/firestore/security/rules-structure)
- [Storage Rules Reference](https://firebase.google.com/docs/storage/security)
- [Terraform Firebase Provider](https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/firebaserules_ruleset)

## Summary

**Key Points:**
- ✅ Rules managed via Terraform (IaC)
- ✅ Automatic deployment on git push
- ✅ Source files: `firestore.rules`, `storage.rules`
- ✅ Terraform config: `infrastructure/terraform/firebase.tf`
- ✅ Manual override available via Firebase CLI
- ✅ Integrated with GitHub OAuth authentication
- ✅ Enforced at database/storage level

**Workflow:**
Edit rules → Commit → Push → Terraform deploys → Rules live
