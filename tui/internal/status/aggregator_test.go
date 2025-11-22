package status

import (
	"testing"
	"time"

	"github.com/natb1/tui/pkg/discovery"
)

func TestNewAggregator(t *testing.T) {
	aggregator := NewAggregator()

	if aggregator == nil {
		t.Fatal("NewAggregator returned nil")
	}

	if aggregator.sources == nil {
		t.Error("Sources map not initialized")
	}

	if aggregator.cache == nil {
		t.Error("Cache not initialized")
	}

	if aggregator.subscribers == nil {
		t.Error("Subscribers slice not initialized")
	}

	if aggregator.dashboard == nil {
		t.Error("Dashboard not initialized")
	}

	if aggregator.updateChan == nil {
		t.Error("Update channel not initialized")
	}

	if aggregator.ctx == nil {
		t.Error("Context not initialized")
	}

	if aggregator.cancel == nil {
		t.Error("Cancel function not initialized")
	}
}

func TestAggregatorShutdown(t *testing.T) {
	aggregator := NewAggregator()

	// Shutdown should not panic
	aggregator.Shutdown()

	// Context should be cancelled
	select {
	case <-aggregator.ctx.Done():
		// Expected
	default:
		t.Error("Context should be cancelled after shutdown")
	}
}

func TestHealthIndicatorConstants(t *testing.T) {
	if HealthHealthy != "healthy" {
		t.Errorf("Expected HealthHealthy to be 'healthy', got %s", HealthHealthy)
	}

	if HealthWarning != "warning" {
		t.Errorf("Expected HealthWarning to be 'warning', got %s", HealthWarning)
	}

	if HealthCritical != "critical" {
		t.Errorf("Expected HealthCritical to be 'critical', got %s", HealthCritical)
	}

	if HealthUnknown != "unknown" {
		t.Errorf("Expected HealthUnknown to be 'unknown', got %s", HealthUnknown)
	}
}

func TestUpdateTypeConstants(t *testing.T) {
	if UpdateTypeProjectStatus != "project_status" {
		t.Errorf("Expected UpdateTypeProjectStatus to be 'project_status', got %s", UpdateTypeProjectStatus)
	}

	if UpdateTypeApplicationStatus != "application_status" {
		t.Errorf("Expected UpdateTypeApplicationStatus to be 'application_status', got %s", UpdateTypeApplicationStatus)
	}

	if UpdateTypeResourceStatus != "resource_status" {
		t.Errorf("Expected UpdateTypeResourceStatus to be 'resource_status', got %s", UpdateTypeResourceStatus)
	}

	if UpdateTypeHealthStatus != "health_status" {
		t.Errorf("Expected UpdateTypeHealthStatus to be 'health_status', got %s", UpdateTypeHealthStatus)
	}
}

func TestStatusData(t *testing.T) {
	timestamp := time.Now()
	data := StatusData{
		Source:    "test-source",
		Timestamp: timestamp,
		Data:      map[string]interface{}{"key": "value"},
		Health:    HealthHealthy,
	}

	if data.Source != "test-source" {
		t.Errorf("Expected source 'test-source', got %s", data.Source)
	}

	if data.Timestamp != timestamp {
		t.Errorf("Expected timestamp %v, got %v", timestamp, data.Timestamp)
	}

	if data.Health != HealthHealthy {
		t.Errorf("Expected health %v, got %v", HealthHealthy, data.Health)
	}

	if len(data.Data) != 1 {
		t.Errorf("Expected 1 data entry, got %d", len(data.Data))
	}

	if data.Data["key"] != "value" {
		t.Errorf("Expected data['key'] to be 'value', got %v", data.Data["key"])
	}
}

func TestStatusUpdate(t *testing.T) {
	timestamp := time.Now()
	update := StatusUpdate{
		Source:    "test-source",
		Timestamp: timestamp,
		Data:      "test-data",
		Type:      UpdateTypeProjectStatus,
	}

	if update.Source != "test-source" {
		t.Errorf("Expected source 'test-source', got %s", update.Source)
	}

	if update.Timestamp != timestamp {
		t.Errorf("Expected timestamp %v, got %v", timestamp, update.Timestamp)
	}

	if update.Data != "test-data" {
		t.Errorf("Expected data 'test-data', got %v", update.Data)
	}

	if update.Type != UpdateTypeProjectStatus {
		t.Errorf("Expected type %v, got %v", UpdateTypeProjectStatus, update.Type)
	}
}

func TestStatusUpdateMsg(t *testing.T) {
	dashboard := &DashboardData{
		Timestamp: time.Now(),
	}

	updates := []StatusUpdate{
		{Source: "source1", Type: UpdateTypeProjectStatus},
		{Source: "source2", Type: UpdateTypeHealthStatus},
	}

	msg := StatusUpdateMsg{
		Dashboard: dashboard,
		Updates:   updates,
	}

	if msg.Dashboard != dashboard {
		t.Error("Dashboard not properly set in message")
	}

	if len(msg.Updates) != 2 {
		t.Errorf("Expected 2 updates, got %d", len(msg.Updates))
	}

	if msg.Updates[0].Source != "source1" {
		t.Errorf("Expected first update source 'source1', got %s", msg.Updates[0].Source)
	}
}

func TestSubscribe(t *testing.T) {
	aggregator := NewAggregator()

	// Subscribe to updates
	subscriber := aggregator.Subscribe()

	if subscriber == nil {
		t.Fatal("Subscribe returned nil channel")
	}

	// Check that subscriber was added
	if len(aggregator.subscribers) != 1 {
		t.Errorf("Expected 1 subscriber, got %d", len(aggregator.subscribers))
	}

	// Subscribe again
	subscriber2 := aggregator.Subscribe()

	if len(aggregator.subscribers) != 2 {
		t.Errorf("Expected 2 subscribers, got %d", len(aggregator.subscribers))
	}

	if subscriber == subscriber2 {
		t.Error("Expected different channels for different subscriptions")
	}
}

func TestProcessStatusUpdate(t *testing.T) {
	aggregator := NewAggregator()

	update := StatusUpdate{
		Source:    "test-source",
		Timestamp: time.Now(),
		Data:      map[string]interface{}{"status": "active"},
		Type:      UpdateTypeProjectStatus,
	}

	// Process the update
	aggregator.processStatusUpdate(update)

	// Check that data was cached
	cachedData, exists := aggregator.cache.Get("test-source")
	if !exists {
		t.Fatal("Expected data to be cached")
	}

	if cachedData.Source != "test-source" {
		t.Errorf("Expected cached source 'test-source', got %s", cachedData.Source)
	}

	// Dashboard should be updated
	dashboard := aggregator.GetDashboardData()
	if dashboard == nil {
		t.Fatal("Dashboard should not be nil after update")
	}
}

func TestHandleProjectDiscovered(t *testing.T) {
	aggregator := NewAggregator()

	project := &discovery.Project{
		Name: "test-project",
		Path: "/path/to/project",
	}

	msg := discovery.ProjectDiscoveredMsg{
		Project: project,
	}

	// Handle project discovered
	cmd := aggregator.handleProjectDiscovered(msg)

	// Should return nil (no command needed)
	if cmd != nil {
		t.Error("Expected nil command from handleProjectDiscovered")
	}

	// Source should be added
	if len(aggregator.sources) != 1 {
		t.Errorf("Expected 1 source after project discovery, got %d", len(aggregator.sources))
	}

	source := aggregator.sources["test-project"]
	if source == nil {
		t.Fatal("Expected project source to be added")
	}

	if source.Name() != "test-project" {
		t.Errorf("Expected source name 'test-project', got %s", source.Name())
	}
}

func TestHandleProjectUpdated(t *testing.T) {
	aggregator := NewAggregator()

	project := &discovery.Project{
		Name: "test-project",
		Status: discovery.ProjectStatus{
			Overall: "active",
		},
	}

	msg := discovery.ProjectUpdatedMsg{
		Project: project,
	}

	// Handle project updated
	cmd := aggregator.handleProjectUpdated(msg)

	// Should return nil (update is sent to channel)
	if cmd != nil {
		t.Error("Expected nil command from handleProjectUpdated")
	}

	// Check if update was sent to channel (non-blocking check)
	select {
	case update := <-aggregator.updateChan:
		if update.Source != "test-project" {
			t.Errorf("Expected update source 'test-project', got %s", update.Source)
		}
		if update.Type != UpdateTypeProjectStatus {
			t.Errorf("Expected update type %v, got %v", UpdateTypeProjectStatus, update.Type)
		}
	default:
		t.Error("Expected update to be sent to channel")
	}
}

func TestHandleStatusUpdate(t *testing.T) {
	aggregator := NewAggregator()

	dashboard := &DashboardData{
		Timestamp: time.Now(),
	}

	msg := StatusUpdateMsg{
		Dashboard: dashboard,
		Updates:   []StatusUpdate{},
	}

	// Handle status update
	cmd := aggregator.handleStatusUpdate(msg)

	// Should return nil
	if cmd != nil {
		t.Error("Expected nil command from handleStatusUpdate")
	}

	// Dashboard should be updated
	if aggregator.dashboard != dashboard {
		t.Error("Dashboard not updated after handleStatusUpdate")
	}
}

func TestGetDashboardData(t *testing.T) {
	aggregator := NewAggregator()

	// Initial dashboard
	dashboard := aggregator.GetDashboardData()
	if dashboard == nil {
		t.Fatal("GetDashboardData returned nil")
	}

	// Update dashboard
	newDashboard := &DashboardData{
		Timestamp: time.Now(),
	}
	aggregator.dashboard = newDashboard

	// Should return updated dashboard
	retrieved := aggregator.GetDashboardData()
	if retrieved != newDashboard {
		t.Error("GetDashboardData did not return updated dashboard")
	}
}

func TestAggregatorConcurrency(t *testing.T) {
	aggregator := NewAggregator()
	defer aggregator.Shutdown()

	// Test concurrent operations
	done := make(chan bool, 3)

	// Concurrent subscriptions
	go func() {
		for i := 0; i < 10; i++ {
			aggregator.Subscribe()
		}
		done <- true
	}()

	// Concurrent status updates
	go func() {
		for i := 0; i < 10; i++ {
			update := StatusUpdate{
				Source:    "concurrent-source",
				Timestamp: time.Now(),
				Data:      i,
				Type:      UpdateTypeProjectStatus,
			}
			aggregator.processStatusUpdate(update)
		}
		done <- true
	}()

	// Concurrent dashboard reads
	go func() {
		for i := 0; i < 10; i++ {
			aggregator.GetDashboardData()
		}
		done <- true
	}()

	// Wait for all goroutines
	<-done
	<-done
	<-done

	// If we get here without race conditions, test passes
}
