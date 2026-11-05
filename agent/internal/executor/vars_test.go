package executor

import "testing"

func TestShellQuote(t *testing.T) {
	cases := map[string]string{
		"":             "''",
		"abc":          "'abc'",
		"a b":          "'a b'",
		"it's":         `'it'\''s'`,
		"$(rm -rf /)":  "'$(rm -rf /)'",
		"`x`;y&&z|w\n": "'`x`;y&&z|w\n'",
	}
	for in, want := range cases {
		if got := ShellQuote(in); got != want {
			t.Errorf("ShellQuote(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestSubstituteVarsBackCompat(t *testing.T) {
	vars := map[string]string{"domain": "a'b.com", "x": "{{domain}}"}
	s := substituteVars(Step{
		Command: "echo {{domain}} {{q:domain}} {{missing}}",
		Path:    "/etc/nginx/{{domain}}.conf",
		Content: "server_name {{domain}}; {{q:domain}}",
		Name:    "{{x}}",
	}, vars)

	if want := `echo a'b.com 'a'\''b.com' {{missing}}`; s.Command != want {
		t.Errorf("command = %q, want %q", s.Command, want)
	}
	if s.Path != "/etc/nginx/a'b.com.conf" {
		t.Errorf("path = %q", s.Path)
	}
	if want := `server_name a'b.com; 'a'\''b.com'`; s.Content != want {
		t.Errorf("content = %q, want %q", s.Content, want)
	}
	// single pass: substituted values are not re-expanded
	if s.Name != "{{domain}}" {
		t.Errorf("name = %q, want literal {{domain}}", s.Name)
	}
}

func TestSubstituteVarsEscape(t *testing.T) {
	vars := map[string]string{"f": "a b; rm -rf /"}
	s := substituteVars(Step{
		Command:    "cat {{f}}",
		Script:     "echo {{f}}",
		Path:       "/var/www/{{f}}",
		EscapeVars: true,
	}, vars)
	if want := `cat 'a b; rm -rf /'`; s.Command != want {
		t.Errorf("command = %q, want %q", s.Command, want)
	}
	if want := `echo 'a b; rm -rf /'`; s.Script != want {
		t.Errorf("script = %q, want %q", s.Script, want)
	}
	// non-shell fields are never quoted
	if s.Path != "/var/www/a b; rm -rf /" {
		t.Errorf("path = %q", s.Path)
	}
	// {{q:var}} stays single-quoted (not double-quoted) under escape_vars
	s = substituteVars(Step{Command: "x {{q:f}}", EscapeVars: true}, vars)
	if want := `x 'a b; rm -rf /'`; s.Command != want {
		t.Errorf("q under escape = %q, want %q", s.Command, want)
	}
}

func TestListRootFor(t *testing.T) {
	ok := []string{"/etc/nginx", "/etc/nginx/sites-enabled/*", "/var/www/site/*.php", "/etc/letsencrypt/live/*"}
	bad := []string{"", "etc/nginx", "/etc", "/etc/*", "/etc/nginx/../shadow", "/etc/nginx*", "/etc/letsencrypt/archive/*", "/var/wwwx"}
	for _, p := range ok {
		if _, _, err := listRootFor(p); err != nil {
			t.Errorf("listRootFor(%q) unexpected error: %v", p, err)
		}
	}
	for _, p := range bad {
		if _, _, err := listRootFor(p); err == nil {
			t.Errorf("listRootFor(%q) expected error", p)
		}
	}
}
