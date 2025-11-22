package assistant

import (
	"testing"
	"time"

	"github.com/natb1/tui/pkg/discovery"
)

// mockProjectSource implements ProjectSource for testing
type mockProjectSource struct {
	initialized bool
	projects    map[string]*discovery.Project
}

func newMockProjectSource() *mockProjectSource {
	return &mockProjectSource{
		initialized: true,
		projects:    make(map[string]*discovery.Project),
	}
}

func (m *mockProjectSource) IsInitialized() bool {
	return m.initialized
}

func (m *mockProjectSource) GetProjects() map[string]*discovery.Project {
	return m.projects
}

func (m *mockProjectSource) addProject(name, status string) {
	m.projects[name] = &discovery.Project{
		Name: name,
		Status: discovery.ProjectStatus{
			Overall: status,
		},
	}
}

func TestNewCore(t *testing.T) {
	projects := newMockProjectSource()
	core := NewCore(projects)

	if core == nil {
		t.Fatal("NewCore returned nil")
	}

	if core.projects != projects {
		t.Error("Projects not properly assigned")
	}

	if core.recommender == nil {
		t.Error("Recommender not initialized")
	}

	if core.healthMetrics == nil {
		t.Error("HealthMetrics not initialized")
	}

	if core.timeTracker == nil {
		t.Error("TimeTracker not initialized")
	}

	if core.focus == nil {
		t.Error("Focus not initialized")
	}

	// Test default health state
	healthState := core.GetHealthState()
	if healthState.Energy != 5 {
		t.Errorf("Expected default energy 5, got %d", healthState.Energy)
	}
	if healthState.Focus != 5 {
		t.Errorf("Expected default focus 5, got %d", healthState.Focus)
	}
	if healthState.Stress != 5 {
		t.Errorf("Expected default stress 5, got %d", healthState.Stress)
	}
	if healthState.Mood != "neutral" {
		t.Errorf("Expected default mood 'neutral', got %s", healthState.Mood)
	}
	if healthState.Capacity != "medium" {
		t.Errorf("Expected default capacity 'medium', got %s", healthState.Capacity)
	}
}

func TestCalculatePriority(t *testing.T) {
	core := NewCore(newMockProjectSource())

	tests := []struct {
		name     string
		status   string
		expected Priority
	}{
		{"Active project", "active", PriorityHigh},
		{"Blocked project", "blocked", PriorityCritical},
		{"Idle project", "idle", PriorityMedium},
		{"Unknown status", "unknown", PriorityLow},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			project := &discovery.Project{
				Status: discovery.ProjectStatus{
					Overall: tt.status,
				},
			}

			priority := core.calculatePriority(project)
			if priority != tt.expected {
				t.Errorf("calculatePriority(%s) = %v, want %v", tt.status, priority, tt.expected)
			}
		})
	}
}

func TestGenerateReasoning(t *testing.T) {
	core := NewCore(newMockProjectSource())

	tests := []struct {
		name     string
		status   string
		expected string
	}{
		{"Active project", "active", "Project has active work in progress"},
		{"Blocked project", "blocked", "Project has blocking issues that need attention"},
		{"Idle project", "idle", "Project is ready for new work"},
		{"Unknown status", "unknown", "Project status review recommended"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			project := &discovery.Project{
				Status: discovery.ProjectStatus{
					Overall: tt.status,
				},
			}

			reasoning := core.generateReasoning(project)
			if reasoning != tt.expected {
				t.Errorf("generateReasoning(%s) = %s, want %s", tt.status, reasoning, tt.expected)
			}
		})
	}
}

func TestAnalyzeProject(t *testing.T) {
	core := NewCore(newMockProjectSource())

	project := &discovery.Project{
		Name: "test-project",
		Status: discovery.ProjectStatus{
			Overall: "active",
		},
	}

	recommendation := core.analyzeProject(project)

	if recommendation == nil {
		t.Fatal("analyzeProject returned nil")
	}

	if recommendation.Project != project {
		t.Error("Recommendation project not properly set")
	}

	if recommendation.Priority != PriorityHigh {
		t.Errorf("Expected priority %v, got %v", PriorityHigh, recommendation.Priority)
	}

	if recommendation.Reasoning != "Project has active work in progress" {
		t.Errorf("Unexpected reasoning: %s", recommendation.Reasoning)
	}

	if recommendation.TimeWindow != 30*time.Minute {
		t.Errorf("Expected time window 30 minutes, got %v", recommendation.TimeWindow)
	}

	if recommendation.HealthState == nil {
		t.Error("HealthState not set in recommendation")
	}
}

func TestSetTimeWindow(t *testing.T) {
	core := NewCore(newMockProjectSource())

	newWindow := 45 * time.Minute
	core.SetTimeWindow(newWindow)

	if core.timeTracker.currentWindow != newWindow {
		t.Errorf("SetTimeWindow failed: expected %v, got %v", newWindow, core.timeTracker.currentWindow)
	}
}

func TestGetCurrentRecommendations(t *testing.T) {
	core := NewCore(newMockProjectSource())

	// Initially should be empty
	recommendations := core.GetCurrentRecommendations()
	if len(recommendations) != 0 {
		t.Errorf("Expected 0 initial recommendations, got %d", len(recommendations))
	}

	// Add a recommendation manually
	testRec := Recommendation{
		Priority:   PriorityHigh,
		Reasoning:  "Test recommendation",
		TimeWindow: 30 * time.Minute,
	}
	core.recommender.recommendations = append(core.recommender.recommendations, testRec)

	recommendations = core.GetCurrentRecommendations()
	if len(recommendations) != 1 {
		t.Errorf("Expected 1 recommendation, got %d", len(recommendations))
	}

	if recommendations[0].Priority != PriorityHigh {
		t.Errorf("Expected priority %v, got %v", PriorityHigh, recommendations[0].Priority)
	}
}

func TestAnalyzeProjectsWithEmptyMap(t *testing.T) {
	projects := newMockProjectSource()
	core := NewCore(projects)

	recommendations := core.analyzeProjects()

	if len(recommendations) != 0 {
		t.Errorf("Expected 0 recommendations for uninitialized project map, got %d", len(recommendations))
	}
}

func TestHealthIntegration(t *testing.T) {
	core := NewCore(newMockProjectSource())

	// Test initial health state
	initialHealth := core.GetHealthState()
	if initialHealth.Energy != 5 {
		t.Errorf("Expected initial energy 5, got %d", initialHealth.Energy)
	}

	// Test health update
	newHealth := &HealthState{
		Energy:   8,
		Focus:    7,
		Stress:   3,
		Mood:     "positive",
		Capacity: "high",
	}

	msg := HealthUpdateMsg{
		HealthState: newHealth,
		Timestamp:   time.Now(),
	}

	core.handleHealthUpdate(msg)

	updatedHealth := core.GetHealthState()
	if updatedHealth.Energy != 8 {
		t.Errorf("Expected updated energy 8, got %d", updatedHealth.Energy)
	}
	if updatedHealth.Focus != 7 {
		t.Errorf("Expected updated focus 7, got %d", updatedHealth.Focus)
	}
	if updatedHealth.Stress != 3 {
		t.Errorf("Expected updated stress 3, got %d", updatedHealth.Stress)
	}
	if updatedHealth.Mood != "positive" {
		t.Errorf("Expected updated mood 'positive', got %s", updatedHealth.Mood)
	}
	if updatedHealth.Capacity != "high" {
		t.Errorf("Expected updated capacity 'high', got %s", updatedHealth.Capacity)
	}
}

func TestRecommendationPriorityLevels(t *testing.T) {
	// Test priority level constants
	if PriorityLow >= PriorityMedium {
		t.Error("Priority levels not properly ordered: Low should be less than Medium")
	}
	if PriorityMedium >= PriorityHigh {
		t.Error("Priority levels not properly ordered: Medium should be less than High")
	}
	if PriorityHigh >= PriorityCritical {
		t.Error("Priority levels not properly ordered: High should be less than Critical")
	}
}

func TestTimeManagerDefaults(t *testing.T) {
	core := NewCore(newMockProjectSource())

	if core.timeTracker.currentWindow != 30*time.Minute {
		t.Errorf("Expected default time window 30 minutes, got %v", core.timeTracker.currentWindow)
	}

	if core.timeTracker.schedule == nil {
		t.Error("Schedule map not initialized")
	}
}

func TestFocusSuggesterInitialization(t *testing.T) {
	core := NewCore(newMockProjectSource())

	if core.focus.suggestions == nil {
		t.Error("Focus suggestions slice not initialized")
	}

	if len(core.focus.suggestions) != 0 {
		t.Errorf("Expected 0 initial focus suggestions, got %d", len(core.focus.suggestions))
	}
}
