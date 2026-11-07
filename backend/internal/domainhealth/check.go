package domainhealth

import (
	"crypto/tls"
	"io"
	"net"
	"net/http"
	"sort"
	"strings"
	"time"
)

// Input is everything needed to compute domain health from a live check.
type Input struct {
	FQDN               string
	AssignedMachineID  *string // nil or empty UUID string means unassigned
	MachineIP          *string
	ExpectedHTTPStatus int    // 0 or invalid uses 200; ignored when Rules.Expected is set
	Path               string // request path; empty uses "/"; ignored when Rules.Path is set
	Rules              Rules  // preset or custom rules; zero values fall back to the fields above
}

// Result is the outcome of a live check.
type Result struct {
	Status     string // idle | healthy | unhealthy | proxied
	StatusCode *int   // HTTP status of the probe (nil when no HTTP response)
	ResponseMS *int   // time to response headers of the successful probe
	Error      string // short reason when no HTTP response was received, or why the response didn't match
	// What the probe got back (set whenever there was an HTTP response).
	Headers       string // "Key: value" lines, sorted
	Body          string // first MaxStoredBody bytes, valid UTF-8
	BodyTruncated bool
}

// ValidPath reports whether p is acceptable as a health check path.
func ValidPath(p string) bool {
	if p == "" {
		return true
	}
	if !strings.HasPrefix(p, "/") || len(p) > 512 {
		return false
	}
	for _, r := range p {
		if r <= ' ' || r == 0x7f {
			return false
		}
	}
	return true
}

// ComputeStatus runs DNS + HTTP(S) checks and returns the new status string.
func ComputeStatus(in Input) string {
	return Check(in).Status
}

// Check runs DNS + HTTP(S) checks and returns status plus probe details.
func Check(in Input) Result {
	if in.AssignedMachineID == nil || *in.AssignedMachineID == "" {
		return Result{Status: "idle"}
	}

	expected := in.ExpectedHTTPStatus
	if expected <= 0 || expected > 999 {
		expected = 200
	}
	spec, err := ParseStatusSpec(in.Rules.Expected)
	if err != nil {
		spec = StatusSpec{{expected, expected}}
	}
	path := in.Rules.Path
	if path == "" {
		path = in.Path
	}
	if path == "" || !ValidPath(path) {
		path = "/"
	}
	timeout := in.Rules.TimeoutSeconds
	if timeout <= 0 || timeout > MaxTimeoutSeconds {
		timeout = DefaultTimeoutSeconds
	}
	needle := in.Rules.BodyContains

	ips, dnsErr := net.LookupIP(in.FQDN)

	dnsMatchesMachine := false
	if dnsErr == nil && in.MachineIP != nil && *in.MachineIP != "" {
		for _, ip := range ips {
			if ip.String() == *in.MachineIP {
				dnsMatchesMachine = true
				break
			}
		}
	}

	client := &http.Client{
		Timeout: time.Duration(timeout) * time.Second,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			return http.ErrUseLastResponse
		},
		Transport: &http.Transport{
			TLSClientConfig: &tls.Config{
				InsecureSkipVerify: true,
			},
		},
	}

	p, err := probeHTTP(client, "https://"+in.FQDN+path)
	if err != nil {
		p, err = probeHTTP(client, "http://"+in.FQDN+path)
	}

	if err == nil {
		statusCode, ms, body := p.status, p.ms, p.body
		res := Result{StatusCode: &statusCode, ResponseMS: &ms, Status: "unhealthy", Headers: p.headers}
		res.Body, res.BodyTruncated = storedBody(body, p.bodyTruncated)
		switch {
		case !spec.Match(statusCode):
			res.Error = "Expected " + spec.String()
		case needle != "" && !strings.Contains(body, needle):
			res.Error = "Response body doesn't contain \"" + needle + "\""
		default:
			res.Status = "healthy"
		}
		return res
	}

	res := Result{Error: shortErr(err)}
	switch {
	case dnsErr != nil:
		res.Status = "unhealthy"
		res.Error = "DNS lookup failed: " + shortErr(dnsErr)
	case dnsMatchesMachine:
		res.Status = "unhealthy"
	default:
		res.Status = "proxied"
	}
	return res
}

const (
	// maxBodyRead caps how much of the response is read (and searched for Rules.BodyContains).
	maxBodyRead = 256 << 10
	// MaxStoredBody caps the body kept for display after a failed check.
	MaxStoredBody = 32 << 10
	maxStoredHeaders = 8 << 10
)

type probe struct {
	status, ms    int
	headers, body string
	bodyTruncated bool // more than maxBodyRead was available
}

func probeHTTP(client *http.Client, url string) (probe, error) {
	start := time.Now()
	resp, err := client.Get(url)
	if err != nil {
		return probe{}, err
	}
	defer resp.Body.Close()
	p := probe{status: resp.StatusCode, ms: int(time.Since(start).Milliseconds()), headers: formatHeaders(resp.Header)}
	b, _ := io.ReadAll(io.LimitReader(resp.Body, maxBodyRead+1))
	if len(b) > maxBodyRead {
		b, p.bodyTruncated = b[:maxBodyRead], true
	}
	p.body = string(b)
	return p, nil
}

func formatHeaders(h http.Header) string {
	keys := make([]string, 0, len(h))
	for k := range h {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	var sb strings.Builder
	for _, k := range keys {
		for _, v := range h[k] {
			sb.WriteString(k + ": " + v + "\n")
		}
	}
	return sanitizeText(sb.String(), maxStoredHeaders)
}

// storedBody trims the body for storage; Postgres TEXT needs valid UTF-8 without NUL bytes.
func storedBody(body string, truncated bool) (string, bool) {
	if len(body) > MaxStoredBody {
		body, truncated = body[:MaxStoredBody], true
	}
	return sanitizeText(body, MaxStoredBody+64), truncated
}

func sanitizeText(s string, max int) string {
	s = strings.ToValidUTF8(strings.ReplaceAll(s, "\x00", ""), "\uFFFD")
	if len(s) > max {
		s = strings.ToValidUTF8(s[:max], "")
	}
	return s
}

func shortErr(err error) string {
	s := err.Error()
	if len(s) > 300 {
		s = s[:300]
	}
	return s
}
