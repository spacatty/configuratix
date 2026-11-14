package domainhealth

import (
	"context"
	"errors"
	"net"
	"net/http"
	"net/url"
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

	res := check(Rules{Path: "/missing", Expected: "200"})
	if !strings.Contains(res.Body, "404 page not found") {
		t.Errorf("body not captured: %q", res.Body)
	}
	if !strings.Contains(res.Headers, "Content-Type: text/plain") {
		t.Errorf("headers not captured: %q", res.Headers)
	}
}

func TestStoredBody(t *testing.T) {
	big := strings.Repeat("a", MaxStoredBody+10)
	body, truncated := storedBody(big, false)
	if len(body) != MaxStoredBody || !truncated {
		t.Errorf("len %d truncated %v", len(body), truncated)
	}
	body, _ = storedBody("ok\x00\xff", false)
	if body != "ok�" {
		t.Errorf("not sanitized: %q", body)
	}
}

func TestShortErr(t *testing.T) {
	cases := []struct {
		err  error
		want string
	}{
		{&url.Error{Op: "Get", URL: "http://x.test/", Err: context.DeadlineExceeded}, "Timed out waiting for a response"},
		{errors.New(`Get "https://x.test/": context deadline exceeded (Client.Timeout exceeded while awaiting headers)`), "Timed out waiting for a response"},
		{errors.New(`Get "http://x.test/": dial tcp 127.0.0.1:80: connectex: No connection could be made because the target machine actively refused it.`), "Connection refused"},
		{errors.New(`Get "http://x.test/": dial tcp 1.2.3.4:80: connect: connection refused`), "Connection refused"},
		{errors.New(`Get "https://x.test/": http: server gave HTTP response to HTTPS client`), "Plain HTTP on the HTTPS port"},
		{errors.New(`Get "https://x.test/": tls: first record does not look like a TLS handshake`), "TLS handshake failed: first record does not look like a TLS handshake"},
		{errors.New(`Get "http://x.test/": EOF`), "Connection closed before a response"},
		{errors.New(`Get "http://x.test/": something odd happened`), "Something odd happened"},
		{errors.New("plain"), "Plain"},
	}
	for _, c := range cases {
		if got := shortErr(c.err); got != c.want {
			t.Errorf("shortErr(%v) = %q, want %q", c.err, got, c.want)
		}
	}
	if got := dnsReason(&net.DNSError{Err: "no such host", Name: "x.test", IsNotFound: true}); got != "DNS lookup failed: no such host" {
		t.Errorf("dnsReason = %q", got)
	}
}
