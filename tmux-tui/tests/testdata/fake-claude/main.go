package main

import (
	"bufio"
	"flag"
	"fmt"
	"os"
	"strings"
	"time"
)

type Scenario struct {
	StartupDelay     time.Duration
	ShowFolderPrompt bool
	ShowModelPrompt  bool
	HangForever      bool
	ErrorAfter       *time.Duration
}

func main() {
	// Parse flags (like real Claude)
	model := flag.String("model", "sonnet", "Model name")
	permissionMode := flag.String("permission-mode", "default", "Permission mode")
	flag.Parse()

	// Suppress unused variable warnings in test binary
	_ = model
	_ = permissionMode

	// Get scenario from env var
	scenarioName := os.Getenv("FAKE_CLAUDE_SCENARIO")
	if scenarioName == "" {
		scenarioName = "normal"
	}

	scenario := getScenario(scenarioName)

	// Simulate startup delay
	if scenario.StartupDelay > 0 {
		time.Sleep(scenario.StartupDelay)
	}

	// Show folder permission prompt if configured
	if scenario.ShowFolderPrompt {
		fmt.Println("Do you want to work in this folder?")
		fmt.Print("(y/n) ")
		reader := bufio.NewReader(os.Stdin)
		reader.ReadString('\n')
	}

	// Show model selection prompt if configured
	if scenario.ShowModelPrompt {
		fmt.Println("Select a model:")
		fmt.Println("1. Sonnet 4.5")
		fmt.Println("2. Haiku 4")
		fmt.Print("Choice: ")
		reader := bufio.NewReader(os.Stdin)
		reader.ReadString('\n')
	}

	// Handle hang scenario (for testing timeouts)
	if scenario.HangForever {
		fmt.Println("Loading...")
		select {} // Block forever
	}

	// Handle error scenario
	if scenario.ErrorAfter != nil {
		time.Sleep(*scenario.ErrorAfter)
		fmt.Fprintln(os.Stderr, "Error: Failed to initialize")
		os.Exit(1)
	}

	// Show ready prompt
	fmt.Println("Claude Code CLI")
	fmt.Println("What can I help you build today?")
	fmt.Print("> ")

	// Interactive loop
	reader := bufio.NewReader(os.Stdin)
	for {
		line, err := reader.ReadString('\n')
		if err != nil {
			break // EOF or error
		}

		line = strings.TrimSpace(line)

		if line == "exit" || line == "" {
			break
		}

		// Simple responses
		if strings.Contains(line, "hello") {
			fmt.Println("Hello! How can I help?")
		} else {
			fmt.Printf("You said: %s\n", line)
		}

		fmt.Print("> ")
	}

	fmt.Println("Goodbye!")
}

func getScenario(name string) Scenario {
	scenarios := map[string]Scenario{
		"normal": {
			StartupDelay:     2 * time.Second,
			ShowFolderPrompt: false,
			ShowModelPrompt:  false,
		},
		"with-prompts": {
			StartupDelay:     2 * time.Second,
			ShowFolderPrompt: true,
			ShowModelPrompt:  true,
		},
		"slow-start": {
			StartupDelay:     10 * time.Second,
			ShowFolderPrompt: false,
			ShowModelPrompt:  false,
		},
		"hang": {
			StartupDelay: 2 * time.Second,
			HangForever:  true,
		},
		"error": {
			StartupDelay: 2 * time.Second,
			ErrorAfter:   durationPtr(5 * time.Second),
		},
	}

	if s, ok := scenarios[name]; ok {
		return s
	}
	return scenarios["normal"] // Default
}

func durationPtr(d time.Duration) *time.Duration {
	return &d
}
