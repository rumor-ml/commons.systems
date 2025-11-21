module github.com/natb1/tui

go 1.24.0

// Future dependencies for planned features
// github.com/antonmedv/expr v1.15.5       // Expression evaluation for filtering
// github.com/charmbracelet/x/exp/teatest v0.0.0-20231101223129-0ceb7cb2d2b // Tea testing
// github.com/natb1/ntcharts v0.1.0        // Terminal charts (when available)
// github.com/spf13/cobra v1.8.0           // CLI framework
// github.com/spf13/viper v1.18.2          // Configuration management

require (
	github.com/charmbracelet/bubbles v0.20.0
	github.com/charmbracelet/bubbletea v1.3.5
	github.com/charmbracelet/lipgloss v1.1.0
	github.com/charmbracelet/x/exp/teatest v0.0.0-20250528180458-2d5d6cb84620
	github.com/creack/pty v1.1.24
	github.com/google/uuid v1.6.0
	github.com/muesli/termenv v0.16.0
	github.com/rumor-ml/carriercommons v0.0.0-00010101000000-000000000000
	github.com/rumor-ml/log v0.0.0
	github.com/rumor-ml/store v0.0.0
	github.com/stretchr/testify v1.10.0
	golang.org/x/mod v0.30.0
	golang.org/x/term v0.32.0
)

require (
	github.com/atotto/clipboard v0.1.4 // indirect
	github.com/aymanbagabas/go-osc52/v2 v2.0.1 // indirect
	github.com/aymanbagabas/go-udiff v0.2.0 // indirect
	github.com/charmbracelet/colorprofile v0.3.1 // indirect
	github.com/charmbracelet/x/ansi v0.9.2 // indirect
	github.com/charmbracelet/x/cellbuf v0.0.13 // indirect
	github.com/charmbracelet/x/exp/golden v0.0.0-20240815200342-61de596daa2b // indirect
	github.com/charmbracelet/x/term v0.2.1 // indirect
	github.com/davecgh/go-spew v1.1.1 // indirect
	github.com/erikgeiser/coninput v0.0.0-20211004153227-1c3628e74d0f // indirect
	github.com/lucasb-eyer/go-colorful v1.2.0 // indirect
	github.com/mattn/go-isatty v0.0.20 // indirect
	github.com/mattn/go-localereader v0.0.1 // indirect
	github.com/mattn/go-runewidth v0.0.16 // indirect
	github.com/mattn/go-sqlite3 v1.14.32 // indirect
	github.com/muesli/ansi v0.0.0-20230316100256-276c6243b2f6 // indirect
	github.com/muesli/cancelreader v0.2.2 // indirect
	github.com/pmezard/go-difflib v1.0.0 // indirect
	github.com/rivo/uniseg v0.4.7 // indirect
	github.com/sahilm/fuzzy v0.1.1 // indirect
	github.com/xo/terminfo v0.0.0-20220910002029-abceb7e1c41e // indirect
	golang.org/x/sync v0.14.0 // indirect
	golang.org/x/sys v0.33.0 // indirect
	golang.org/x/text v0.25.0 // indirect
	gopkg.in/yaml.v3 v3.0.1 // indirect
)

replace github.com/rumor-ml/log => ./stubs/log

replace github.com/rumor-ml/store => ./stubs/store

replace github.com/rumor-ml/carriercommons => ./stubs/carriercommons
