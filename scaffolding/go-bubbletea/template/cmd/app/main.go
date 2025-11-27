package main

import (
	"fmt"
	"os"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/commons-systems/{{APP_NAME}}/internal/model"
)

func main() {
	p := tea.NewProgram(model.New())
	if _, err := p.Run(); err != nil {
		fmt.Printf("Error running {{APP_NAME}}: %v\n", err)
		os.Exit(1)
	}
}
