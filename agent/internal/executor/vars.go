package executor

import (
	"sort"
	"strings"
)

// ShellQuote returns s as a single POSIX-shell word wrapped in single quotes.
// Embedded single quotes are emitted as '\'' so the result is always safe to
// splice into a bash command line.
func ShellQuote(s string) string {
	if s == "" {
		return "''"
	}
	return "'" + strings.ReplaceAll(s, "'", `'\''`) + "'"
}

// buildReplacer builds a single-pass replacer for {{key}} and {{q:key}}.
// quoteBare=true makes {{key}} shell-quoted as well (escape_vars: true).
// Single pass means substituted values are never re-scanned for placeholders.
func buildReplacer(vars map[string]string, quoteBare bool) *strings.Replacer {
	if len(vars) == 0 {
		return nil
	}
	keys := make([]string, 0, len(vars))
	for k := range vars {
		keys = append(keys, k)
	}
	sort.Strings(keys) // deterministic
	pairs := make([]string, 0, len(keys)*4)
	for _, k := range keys {
		v := vars[k]
		bare := v
		if quoteBare {
			bare = ShellQuote(v)
		}
		pairs = append(pairs, "{{q:"+k+"}}", ShellQuote(v), "{{"+k+"}}", bare)
	}
	return strings.NewReplacer(pairs...)
}

func applyReplacer(r *strings.Replacer, s string) string {
	if r == nil || s == "" || !strings.Contains(s, "{{") {
		return s
	}
	return r.Replace(s)
}

// substituteVars replaces {{var}} / {{q:var}} placeholders in a step.
// Shell fields (command, script, if, log, validate) quote bare {{var}} only
// when step.EscapeVars is set; {{q:var}} is always single-quoted.
func substituteVars(step Step, vars map[string]string) Step {
	if len(vars) == 0 {
		return step
	}
	raw := buildReplacer(vars, false)
	shell := raw
	if step.EscapeVars {
		shell = buildReplacer(vars, true)
	}

	step.Command = applyReplacer(shell, step.Command)
	step.Script = applyReplacer(shell, step.Script)
	step.If = applyReplacer(shell, step.If)
	step.Log = applyReplacer(shell, step.Log)
	// validate is substituted again at run time (when {{path}} is known); here
	// only the job vars are applied.
	step.Validate = applyReplacer(shell, step.Validate)

	step.Path = applyReplacer(raw, step.Path)
	step.Content = applyReplacer(raw, step.Content)
	step.URL = applyReplacer(raw, step.URL)
	step.Name = applyReplacer(raw, step.Name)
	step.Title = applyReplacer(raw, step.Title)
	step.Message = applyReplacer(raw, step.Message)
	if len(step.Env) > 0 {
		env := make(map[string]string, len(step.Env))
		for k, v := range step.Env {
			env[k] = applyReplacer(raw, v)
		}
		step.Env = env
	}
	return step
}
