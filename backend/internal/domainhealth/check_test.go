package domainhealth

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestCheckRules(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/healthz":
			w.Write([]byte(`{"status":"ok"}`))
		case "/login":
			http.Redirect(w, r, "/", http.StatusFound)
		default:
			http.NotFound(w, r)
		}
	}))
	defer srv.Close()

	machine := "m"
	host := strings.TrimPrefix(srv.URL, "http://")
	check := func(r Rules) Result {
		return Check(Input{FQDN: host, AssignedMachineID: &machine, Rules: r})
	}

	cases := []struct {
		name   string
		rules  Rules
		status string
	}{
		{"class match", Rules{Path: "/healthz", Expected: "2xx"}, "healthy"},
		{"body match", Rules{Path: "/healthz", Expected: "200", BodyContains: `"status":"ok"`}, "healthy"},
		{"body mismatch", Rules{Path: "/healthz", Expected: "200", BodyContains: "degraded"}, "unhealthy"},
		{"redirect accepted", Rules{Path: "/login", Expected: "301-302"}, "healthy"},
		{"wrong status", Rules{Path: "/missing", Expected: "200"}, "unhealthy"},
		{"legacy fallback", Rules{}, "unhealthy"},
	}
	for _, c := range cases {
		res := check(c.rules)
		if res.Status != c.status {
			t.Errorf("%s: status %q (code %v, err %q), want %q", c.name, res.Status, res.StatusCode, res.Error, c.status)
		}
		if res.Status == "unhealthy" && res.Error == "" {
			t.Errorf("%s: unhealthy result should explain why", c.name)
		}
	}
}
