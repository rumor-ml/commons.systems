package tests

import (
	"testing"
	"time"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/x/exp/teatest"
	"github.com/commons-systems/{{APP_NAME}}/internal/model"
)

func TestAppInitialization(t *testing.T) {
	m := model.New()
	tm := teatest.NewTestModel(t, m)

	// Verify app starts without error
	tm.Send(tea.KeyMsg{Type: tea.KeyCtrlC})
	tm.WaitFinished(t, teatest.WithFinalTimeout(time.Second))
}

func TestAppQuitWithCtrlC(t *testing.T) {
	m := model.New()
	tm := teatest.NewTestModel(t, m)

	tm.Send(tea.KeyMsg{Type: tea.KeyCtrlC})
	tm.WaitFinished(t, teatest.WithFinalTimeout(time.Second))
}

func TestAppQuitWithEscape(t *testing.T) {
	m := model.New()
	tm := teatest.NewTestModel(t, m)

	tm.Send(tea.KeyMsg{Type: tea.KeyEsc})
	tm.WaitFinished(t, teatest.WithFinalTimeout(time.Second))
}

func TestAppViewRendering(t *testing.T) {
	m := model.New()
	view := m.View()

	if view == "" {
		t.Error("expected non-empty view")
	}
}

func TestWindowResize(t *testing.T) {
	m := model.New()
	tm := teatest.NewTestModel(t, m)

	// Send a window resize message
	tm.Send(tea.WindowSizeMsg{Width: 120, Height: 40})

	// Quit the app cleanly
	tm.Send(tea.KeyMsg{Type: tea.KeyCtrlC})
	tm.WaitFinished(t, teatest.WithFinalTimeout(time.Second))
}
