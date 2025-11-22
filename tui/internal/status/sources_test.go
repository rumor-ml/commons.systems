package status

import (
	"testing"
	"time"

	"github.com/natb1/tui/pkg/discovery"
)

func TestNewProjectSource(t *testing.T) {
	project := &discovery.Project{
		Name: "test-project",
		Path: "/path/to/project",
		Status: discovery.ProjectStatus{
			Overall: "active",
		},
	}

	source := NewProjectSource(project)

	if source == nil {
		t.Fatal("NewProjectSource returned nil")
	}

	if source.project != project {
		t.Error("Project not properly assigned")
	}

	if source.subscribers == nil {
		t.Error("Subscribers slice not initialized")
	}

	if len(source.subscribers) != 0 {
		t.Errorf("Expected 0 initial subscribers, got %d", len(source.subscribers))
	}
}

func TestProjectSourceName(t *testing.T) {
	project := &discovery.Project{
		Name: "my-test-project",
	}

	source := NewProjectSource(project)

	if source.Name() != "my-test-project" {
		t.Errorf("Expected name 'my-test-project', got %s", source.Name())
	}
}

func TestProjectSourceGetStatus(t *testing.T) {
	project := &discovery.Project{
		Name: "test-project",
		Path: "/path/to/project",
		Status: discovery.ProjectStatus{
			Overall:  "active",
			Health:   "healthy",
			Progress: 0.75,
		},
		Metadata: &discovery.ProjectMetadata{
			Purpose: "Test project purpose",
		},
	}

	source := NewProjectSource(project)

	status, err := source.GetStatus()
	if err != nil {
		t.Fatalf("GetStatus returned error: %v", err)
	}

	if status == nil {
		t.Fatal("GetStatus returned nil status")
	}

	if status.Source != "test-project" {
		t.Errorf("Expected source 'test-project', got %s", status.Source)
	}

	if status.Health != HealthHealthy {
		t.Errorf("Expected health %v, got %v", HealthHealthy, status.Health)
	}

	if status.Data == nil {
		t.Fatal("Status data is nil")
	}

	// Check that project status and metadata are included
	statusData, exists := status.Data["status"]
	if !exists {
		t.Error("Expected 'status' in data")
	}

	metadataData, exists := status.Data["metadata"]
	if !exists {
		t.Error("Expected 'metadata' in data")
	}

	// Verify status data
	projectStatus, ok := statusData.(discovery.ProjectStatus)
	if !ok {
		t.Errorf("Expected ProjectStatus type, got %T", statusData)
	}

	if projectStatus.Overall != "active" {
		t.Errorf("Expected overall status 'active', got %s", projectStatus.Overall)
	}

	// Verify metadata
	metadata, ok := metadataData.(*discovery.ProjectMetadata)
	if !ok {
		t.Errorf("Expected *ProjectMetadata type, got %T", metadataData)
	}

	if metadata.Purpose != "Test project purpose" {
		t.Errorf("Expected purpose 'Test project purpose', got %s", metadata.Purpose)
	}
}

func TestProjectSourceSubscribe(t *testing.T) {
	project := &discovery.Project{Name: "test-project"}
	source := NewProjectSource(project)

	// Create a test channel
	testChan := make(chan StatusUpdate, 10)

	// Subscribe
	err := source.Subscribe(testChan)
	if err != nil {
		t.Fatalf("Subscribe returned error: %v", err)
	}

	// Check that subscriber was added
	if len(source.subscribers) != 1 {
		t.Errorf("Expected 1 subscriber, got %d", len(source.subscribers))
	}

	if source.subscribers[0] != testChan {
		t.Error("Subscriber channel not properly stored")
	}

	// Subscribe with another channel
	testChan2 := make(chan StatusUpdate, 10)
	err = source.Subscribe(testChan2)
	if err != nil {
		t.Fatalf("Second subscribe returned error: %v", err)
	}

	if len(source.subscribers) != 2 {
		t.Errorf("Expected 2 subscribers, got %d", len(source.subscribers))
	}
}

func TestProjectSourceWithNilProject(t *testing.T) {
	// This tests edge case handling
	source := NewProjectSource(nil)

	if source == nil {
		t.Fatal("NewProjectSource returned nil for nil project")
	}

	if source.project != nil {
		t.Error("Expected nil project")
	}

	// Name should handle nil project gracefully (will panic in current implementation)
	// This is expected behavior - we expect valid projects
	defer func() {
		if r := recover(); r == nil {
			t.Error("Expected panic when calling Name() on source with nil project")
		}
	}()
	source.Name()
}

func TestProjectSourceGetStatusWithMinimalProject(t *testing.T) {
	// Test with minimal project data
	project := &discovery.Project{
		Name: "minimal-project",
	}

	source := NewProjectSource(project)

	status, err := source.GetStatus()
	if err != nil {
		t.Fatalf("GetStatus returned error: %v", err)
	}

	if status.Source != "minimal-project" {
		t.Errorf("Expected source 'minimal-project', got %s", status.Source)
	}

	// Should have default health
	if status.Health != HealthHealthy {
		t.Errorf("Expected default health %v, got %v", HealthHealthy, status.Health)
	}

	// Timestamp should be recent
	if time.Since(status.Timestamp) > time.Second {
		t.Error("Status timestamp is not recent")
	}
}

func TestAddSourceToAggregator(t *testing.T) {
	aggregator := NewAggregator()

	project := &discovery.Project{
		Name: "test-project",
		Path: "/path/to/project",
	}

	source := NewProjectSource(project)

	// Add source to aggregator
	aggregator.AddSource(source)

	// Check that source was added to sources map
	if len(aggregator.sources) != 1 {
		t.Errorf("Expected 1 source in aggregator, got %d", len(aggregator.sources))
	}

	retrievedSource := aggregator.sources["test-project"]
	if retrievedSource == nil {
		t.Fatal("Source not found in aggregator")
	}

	if retrievedSource != source {
		t.Error("Retrieved source is not the same instance")
	}

	// Check that source subscribed to update channel
	if len(source.subscribers) != 1 {
		t.Errorf("Expected 1 subscriber on source, got %d", len(source.subscribers))
	}

	if source.subscribers[0] != aggregator.updateChan {
		t.Error("Source not subscribed to aggregator update channel")
	}
}

func TestAddMultipleSourcesToAggregator(t *testing.T) {
	aggregator := NewAggregator()

	projects := []*discovery.Project{
		{Name: "project1", Path: "/path1"},
		{Name: "project2", Path: "/path2"},
		{Name: "project3", Path: "/path3"},
	}

	// Add multiple sources
	for _, project := range projects {
		source := NewProjectSource(project)
		aggregator.AddSource(source)
	}

	// Check that all sources were added
	if len(aggregator.sources) != 3 {
		t.Errorf("Expected 3 sources in aggregator, got %d", len(aggregator.sources))
	}

	// Check that each source exists
	for _, project := range projects {
		source := aggregator.sources[project.Name]
		if source == nil {
			t.Errorf("Source for project %s not found", project.Name)
		}

		if source.Name() != project.Name {
			t.Errorf("Expected source name %s, got %s", project.Name, source.Name())
		}
	}
}

func TestSourceInterfaceCompliance(t *testing.T) {
	project := &discovery.Project{Name: "test-project"}
	source := NewProjectSource(project)

	// Test that ProjectSource implements Source interface
	var _ Source = source

	// Test interface methods
	name := source.Name()
	if name == "" {
		t.Error("Name() should not return empty string")
	}

	status, err := source.GetStatus()
	if err != nil {
		t.Errorf("GetStatus() returned error: %v", err)
	}
	if status == nil {
		t.Error("GetStatus() should not return nil status")
	}

	testChan := make(chan StatusUpdate, 1)
	err = source.Subscribe(testChan)
	if err != nil {
		t.Errorf("Subscribe() returned error: %v", err)
	}
}
