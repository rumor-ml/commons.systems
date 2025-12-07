# iac: Infrastructure as Code setup tool
#
# This package builds the iac CLI tool that handles GCP project setup,
# Firebase configuration, and Terraform execution.
#
# The iac tool automates:
# - GCP API enablement
# - Workload Identity Federation setup
# - Service account creation with IAM bindings
# - Firebase project initialization
# - Firebase Hosting site creation
# - Terraform state bucket creation
# - Terraform execution
#
# Dependencies at runtime:
# - gcloud: GCP CLI for authentication and API management
# - terraform: Infrastructure provisioning
# - gh (optional): GitHub secrets management
#
{
  lib,
  buildGoModule,
  google-cloud-sdk,
  terraform,
  makeWrapper,
}:

buildGoModule {
  pname = "iac";
  version = "1.0.0";

  # Use the local infrastructure directory as source
  # Don't use cleanSource to ensure go.mod and go.sum are included
  src = ../../infrastructure;

  # vendorHash: SHA256 hash of Go module dependencies
  # Computed by running nix build and copying the hash from the error message
  vendorHash = "sha256-XAMlzRAEFu1yozanA4OqJ+1MSu4r9hlj6Vw70xhOFz4=";

  # Use proxyVendor to fetch dependencies via Go module proxy
  proxyVendor = true;

  # Build from cmd/iac
  subPackages = [ "cmd/iac" ];

  # Strip debug symbols for smaller binary
  ldflags = [
    "-s"
    "-w"
  ];

  # Runtime dependencies
  nativeBuildInputs = [ makeWrapper ];

  # Post-install: wrap binary to ensure gcloud and terraform are in PATH
  postInstall = ''
    # Wrap the binary to include necessary tools in PATH
    wrapProgram $out/bin/iac \
      --prefix PATH : ${
        lib.makeBinPath [
          google-cloud-sdk
          terraform
        ]
      }
  '';

  meta = with lib; {
    description = "Infrastructure as Code setup tool for commons.systems GCP projects";
    homepage = "https://github.com/rumor-ml/commons.systems";
    license = licenses.mit;
    maintainers = [ ];
    platforms = platforms.unix;
  };
}
