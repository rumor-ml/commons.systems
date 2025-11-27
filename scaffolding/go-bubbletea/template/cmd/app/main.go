package main

import (
	"fmt"
	"os"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/commons-systems/{{APP_NAME}}/internal/model"
)

func main() {
	p := tea.NewProgram(model.New(), tea.WithAltScreen())
	if _, err := p.Run(); err != nil {
		fmt.Fprintf(os.Stderr, "Error running {{APP_NAME}}: %v\n", err)
		os.Exit(1)
	}
}
