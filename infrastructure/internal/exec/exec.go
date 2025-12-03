package exec

import (
	"bytes"
	"fmt"
	"os"
	"os/exec"
	"strings"
)

// Result holds the result of a command execution
type Result struct {
	Stdout   string
	Stderr   string
	ExitCode int
}

// Run executes a shell command and returns the result
func Run(command string, captureOutput bool) (*Result, error) {
	cmd := exec.Command("sh", "-c", command)

	var stdout, stderr bytes.Buffer

	if captureOutput {
		cmd.Stdout = &stdout
		cmd.Stderr = &stderr
	} else {
		cmd.Stdout = os.Stdout
		cmd.Stderr = os.Stderr
	}

	err := cmd.Run()
	exitCode := 0
	if err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok {
			exitCode = exitErr.ExitCode()
		} else {
			return nil, fmt.Errorf("failed to execute command: %w", err)
		}
	}

	return &Result{
		Stdout:   strings.TrimSpace(stdout.String()),
		Stderr:   strings.TrimSpace(stderr.String()),
		ExitCode: exitCode,
	}, nil
}

// RunQuiet executes a command and only returns stdout (suppressing stderr)
func RunQuiet(command string) (string, error) {
	result, err := Run(command+" 2>/dev/null", true)
	if err != nil {
		return "", err
	}
	return result.Stdout, nil
}

// RunWithInput executes a command with stdin input
func RunWithInput(command string, input string) (*Result, error) {
	cmd := exec.Command("sh", "-c", command)

	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	cmd.Stdin = strings.NewReader(input)

	err := cmd.Run()
	exitCode := 0
	if err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok {
			exitCode = exitErr.ExitCode()
		} else {
			return nil, fmt.Errorf("failed to execute command: %w", err)
		}
	}

	return &Result{
		Stdout:   strings.TrimSpace(stdout.String()),
		Stderr:   strings.TrimSpace(stderr.String()),
		ExitCode: exitCode,
	}, nil
}

// CommandExists checks if a command is available in PATH
func CommandExists(cmd string) bool {
	_, err := exec.LookPath(cmd)
	return err == nil
}
