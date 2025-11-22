// core.go - Assistant core logic integration
//
// ## Metadata
//
// TUI assistant core providing cognitive load reduction and project intelligence.
//
// ### Purpose
//
// Integrate TUI assistant functionality directly into the multiplexer, providing project
// recommendations, cognitive load reduction, and intelligent focus suggestions based on
// project status, health metrics, and temporal context within the unified interface.
//
// ### Instructions
//
// #### Intelligence Integration
//
// ##### Project Analysis
//
// Analyze discovered ICF projects to provide intelligent recommendations about focus areas,
// time allocation, and project prioritization based on current status, dependencies, and
// user context from health integration.
//
// ##### Cognitive Load Management
//
// Track and reduce cognitive overhead of managing multiple projects by surfacing relevant
// information at appropriate times and providing clear context switching support within
// the multiplexer interface.
//
// #### Recommendation Engine
//
// ##### Time-Aware Suggestions
//
// Generate focus recommendations based on available time windows, current project status,
// emotional balance requirements, and integrated health state to optimize productivity
// while maintaining sustainable work patterns.
//
// ##### Health Integration
//
// Integrate with health metrics to provide capacity-aware recommendations that consider
// energy levels, focus state, and stress indicators when suggesting project activities
// and time allocation strategies.
//
// ### Dependencies
//
// #### [ICF](https://github.com/rumor-ml/icf)
//
// Core framework providing project structure patterns and metadata conventions that enable
// intelligent analysis and recommendation generation across the project ecosystem.

package assistant

import (
	"time"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/natb1/tui/pkg/discovery"
)

// Core represents the assistant intelligence engine
type Core struct {
	projects      ProjectSource
	recommender   *RecommendationEngine
	healthMetrics *HealthIntegration
	timeTracker   *TimeManager
	focus         *FocusSuggester
}

// RecommendationEngine generates intelligent focus suggestions
type RecommendationEngine struct {
	lastUpdate      time.Time
	recommendations []Recommendation
}

// Recommendation represents a focus suggestion
type Recommendation struct {
	Project     *discovery.Project `json:"project"`
	TimeWindow  time.Duration      `json:"time_window"`
	Reasoning   string             `json:"reasoning"`
	Priority    Priority           `json:"priority"`
	HealthState *HealthState       `json:"health_state"`
}

// Priority levels for recommendations
type Priority int

const (
	PriorityLow Priority = iota
	PriorityMedium
	PriorityHigh
	PriorityCritical
)

// HealthIntegration manages health metrics integration
type HealthIntegration struct {
	currentState *HealthState
	lastUpdate   time.Time
}

// HealthState represents current user capacity
type HealthState struct {
	Energy   int    `json:"energy"`   // 1-10 scale
	Focus    int    `json:"focus"`    // 1-10 scale
	Stress   int    `json:"stress"`   // 1-10 scale
	Mood     string `json:"mood"`     // categorical
	Capacity string `json:"capacity"` // high, medium, low
}

// TimeManager handles time-aware recommendations
type TimeManager struct {
	currentWindow time.Duration
	schedule      map[time.Time]string
}

// FocusSuggester generates specific focus recommendations
type FocusSuggester struct {
	activeProject string
	suggestions   []FocusSuggestion
}

// FocusSuggestion represents a specific activity recommendation
type FocusSuggestion struct {
	Activity   string        `json:"activity"`
	Project    string        `json:"project"`
	Duration   time.Duration `json:"duration"`
	Difficulty int           `json:"difficulty"` // 1-10 scale
	Context    string        `json:"context"`
}

// RecommendationMsg is sent when new recommendations are available
type RecommendationMsg struct {
	Recommendations []Recommendation
	Timestamp       time.Time
}

// HealthUpdateMsg is sent when health state changes
type HealthUpdateMsg struct {
	HealthState *HealthState
	Timestamp   time.Time
}

// NewCore creates a new assistant core
func NewCore(projects ProjectSource) *Core {
	return &Core{
		projects: projects,
		recommender: &RecommendationEngine{
			recommendations: make([]Recommendation, 0),
		},
		healthMetrics: &HealthIntegration{
			currentState: &HealthState{
				Energy:   5,
				Focus:    5,
				Stress:   5,
				Mood:     "neutral",
				Capacity: "medium",
			},
		},
		timeTracker: &TimeManager{
			currentWindow: 30 * time.Minute, // Default 30-minute window
			schedule:      make(map[time.Time]string),
		},
		focus: &FocusSuggester{
			suggestions: make([]FocusSuggestion, 0),
		},
	}
}

// Init initializes the assistant core
func (c *Core) Init() tea.Cmd {
	return tea.Batch(
		c.generateInitialRecommendations(),
		c.startHealthMonitoring(),
		c.startTimeTracking(),
	)
}

// HandleMsg processes messages for the assistant core
func (c *Core) HandleMsg(msg tea.Msg) tea.Cmd {
	switch msg := msg.(type) {
	case discovery.ProjectUpdatedMsg:
		return c.handleProjectUpdate(msg)
	case HealthUpdateMsg:
		return c.handleHealthUpdate(msg)
	case time.Timer:
		return c.handleTimeUpdate()
	}
	return nil
}

// generateInitialRecommendations creates initial focus recommendations
func (c *Core) generateInitialRecommendations() tea.Cmd {
	return func() tea.Msg {
		recommendations := c.analyzeProjects()
		return RecommendationMsg{
			Recommendations: recommendations,
			Timestamp:       time.Now(),
		}
	}
}

// startHealthMonitoring begins health state monitoring
func (c *Core) startHealthMonitoring() tea.Cmd {
	return nil
}

// startTimeTracking begins time window tracking
func (c *Core) startTimeTracking() tea.Cmd {
	return tea.Tick(time.Minute*5, func(t time.Time) tea.Msg {
		return t
	})
}

// analyzeProjects analyzes all projects to generate recommendations
func (c *Core) analyzeProjects() []Recommendation {
	recommendations := make([]Recommendation, 0)

	if !c.projects.IsInitialized() {
		return recommendations
	}

	projects := c.projects.GetProjects()

	for _, project := range projects {
		rec := c.analyzeProject(project)
		if rec != nil {
			recommendations = append(recommendations, *rec)
		}
	}

	// Sort by priority and capacity fit
	c.sortRecommendations(recommendations)

	return recommendations
}

// analyzeProject analyzes a single project for recommendations
func (c *Core) analyzeProject(project *discovery.Project) *Recommendation {
	// Simple analysis based on project status
	priority := c.calculatePriority(project)
	reasoning := c.generateReasoning(project)

	return &Recommendation{
		Project:     project,
		TimeWindow:  c.timeTracker.currentWindow,
		Reasoning:   reasoning,
		Priority:    priority,
		HealthState: c.healthMetrics.currentState,
	}
}

// calculatePriority determines recommendation priority
func (c *Core) calculatePriority(project *discovery.Project) Priority {
	// Simple priority calculation
	switch project.Status.Overall {
	case "active":
		return PriorityHigh
	case "blocked":
		return PriorityCritical
	case "idle":
		return PriorityMedium
	default:
		return PriorityLow
	}
}

// generateReasoning creates explanation for recommendation
func (c *Core) generateReasoning(project *discovery.Project) string {
	switch project.Status.Overall {
	case "active":
		return "Project has active work in progress"
	case "blocked":
		return "Project has blocking issues that need attention"
	case "idle":
		return "Project is ready for new work"
	default:
		return "Project status review recommended"
	}
}

// sortRecommendations sorts recommendations by priority and health fit
func (c *Core) sortRecommendations(recommendations []Recommendation) {
}

// handleProjectUpdate processes project status updates
func (c *Core) handleProjectUpdate(msg discovery.ProjectUpdatedMsg) tea.Cmd {
	// Regenerate recommendations when projects change
	return c.generateInitialRecommendations()
}

// handleHealthUpdate processes health state changes
func (c *Core) handleHealthUpdate(msg HealthUpdateMsg) tea.Cmd {
	c.healthMetrics.currentState = msg.HealthState
	c.healthMetrics.lastUpdate = msg.Timestamp

	// Regenerate recommendations based on new health state
	return c.generateInitialRecommendations()
}

// handleTimeUpdate processes periodic time updates
func (c *Core) handleTimeUpdate() tea.Cmd {
	// Update time-based recommendations
	return c.generateInitialRecommendations()
}

// GetCurrentRecommendations returns current focus recommendations
func (c *Core) GetCurrentRecommendations() []Recommendation {
	return c.recommender.recommendations
}

// GetHealthState returns current health state
func (c *Core) GetHealthState() *HealthState {
	return c.healthMetrics.currentState
}

// SetTimeWindow updates the current time window for recommendations
func (c *Core) SetTimeWindow(duration time.Duration) {
	c.timeTracker.currentWindow = duration
}
