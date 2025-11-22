#!/usr/bin/env python3
"""
GitHub OAuth Setup Helper
Assists with configuring GitHub OAuth for Firebase Authentication
"""

import json
import sys
import os

def print_header(text):
    """Print formatted header"""
    print("\n" + "=" * 80)
    print(f"  {text}")
    print("=" * 80 + "\n")

def print_step(number, text):
    """Print formatted step"""
    print(f"\n[Step {number}] {text}")
    print("-" * 80)

def print_info(text):
    """Print info message"""
    print(f"ℹ  {text}")

def print_success(text):
    """Print success message"""
    print(f"✓  {text}")

def print_error(text):
    """Print error message"""
    print(f"✗  {text}", file=sys.stderr)

def print_command(text):
    """Print command to run"""
    print(f"\n  $ {text}\n")

def main():
    print_header("GitHub OAuth Setup for Firebase Authentication")

    print("""
This script will guide you through setting up GitHub OAuth authentication
for your Firebase project.

You'll need:
  - Access to your GitHub account
  - Access to your Firebase console
  - The Firebase project ID (chalanding)
""")

    input("Press Enter to continue...")

    # Step 1: Create GitHub OAuth App
    print_step(1, "Create GitHub OAuth Application")
    print("""
1. Go to GitHub Settings → Developer settings → OAuth Apps
   URL: https://github.com/settings/developers

2. Click "New OAuth App"

3. Fill in the application details:
   - Application name: Commons Systems Auth (or your choice)
   - Homepage URL: https://fellspiral-1036266765056.us-central1.run.app (or your domain)
   - Authorization callback URL: https://chalanding.firebaseapp.com/__/auth/handler

   For development, you can also add:
   - http://localhost:5173/__/auth/handler (for Vite dev server)

4. Click "Register application"

5. On the next page, click "Generate a new client secret"

6. Copy both the Client ID and Client Secret (you'll need these in the next step)
""")

    input("Press Enter when you've created the OAuth app and have your credentials...")

    # Get credentials from user
    print("\nEnter your GitHub OAuth credentials:")
    client_id = input("Client ID: ").strip()
    client_secret = input("Client Secret: ").strip()

    if not client_id or not client_secret:
        print_error("Client ID and Client Secret are required!")
        sys.exit(1)

    print_success("Credentials captured")

    # Step 2: Configure Firebase
    print_step(2, "Configure Firebase Authentication")
    print("""
1. Go to Firebase Console
   URL: https://console.firebase.google.com/project/chalanding/authentication/providers

2. Click on "Sign-in method" tab

3. Enable GitHub provider:
   a. Click on "GitHub" in the list
   b. Click "Enable"
   c. Enter your credentials:
""")

    print(f"      Client ID:     {client_id}")
    print(f"      Client Secret: {client_secret}")

    print("""
   d. Click "Save"

4. Note the Authorization callback URL shown in Firebase:
   - It should be: https://chalanding.firebaseapp.com/__/auth/handler
   - This must match what you entered in GitHub OAuth App settings
""")

    input("Press Enter when you've configured Firebase...")

    # Step 3: Deploy Security Rules
    print_step(3, "Deploy Firebase Security Rules")
    print("""
The repository includes security rules that require authentication:
  - firestore.rules (Firestore database)
  - storage.rules (Cloud Storage)

To deploy these rules, you need the Firebase CLI installed.
""")

    # Check if firebase CLI is available
    firebase_available = os.system("which firebase > /dev/null 2>&1") == 0

    if not firebase_available:
        print_info("Firebase CLI not detected. Install it with:")
        print_command("npm install -g firebase-tools")
        input("Press Enter after installing Firebase CLI...")

    print("\nDeploy the security rules:")
    print_command("firebase deploy --only firestore:rules,storage:rules --project chalanding")

    print_info("This will deploy the authentication-required security rules to your Firebase project")

    input("Press Enter when you've deployed the security rules...")

    # Step 4: Test Authentication
    print_step(4, "Test Authentication")
    print("""
1. Install dependencies:
""")
    print_command("npm install")

    print("""
2. Start the development server for either site:
""")
    print_command("npm run dev              # Fellspiral")
    print_command("npm run dev:videobrowser # Videobrowser")

    print("""
3. Open the site in your browser

4. Click the "Sign in with GitHub" button

5. Complete the OAuth flow

6. You should see:
   - Your GitHub profile picture
   - Your display name
   - The "Sign out" button

7. Try creating/editing cards (fellspiral) or viewing videos (videobrowser)
   - These operations now require authentication
""")

    # Step 5: Production Deployment
    print_step(5, "Production Deployment")
    print("""
Update your GitHub OAuth App callback URLs for production:

1. Go to your GitHub OAuth App settings

2. Update the Authorization callback URL to include your production domains:
   - https://fellspiral-1036266765056.us-central1.run.app/__/auth/handler
   - https://videobrowser-1036266765056.us-central1.run.app/__/auth/handler
   - Any custom domains you're using

3. Push your changes to trigger deployment:
""")
    print_command("git add .")
    print_command("git commit -m 'Add GitHub authentication'")
    print_command("git push")

    # Summary
    print_header("Setup Complete!")
    print("""
✓  GitHub OAuth App created
✓  Firebase Authentication configured
✓  Security rules deployed
✓  Authentication ready to test

Next steps:
  1. Test authentication locally
  2. Deploy to production
  3. Update OAuth callback URLs for production domains
  4. Monitor Firebase Authentication dashboard for user sign-ins

Documentation:
  - Shared auth library: shared/auth/
  - Firebase security rules: firestore.rules, storage.rules
  - Site integration: fellspiral/site/src/scripts/auth-init.js

Need help? Check the repository README or Firebase documentation.
""")

if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n\nSetup cancelled by user")
        sys.exit(1)
    except Exception as e:
        print_error(f"Error: {e}")
        sys.exit(1)
