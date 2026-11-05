package domainhealth

import (
	"crypto/tls"
	"io"
	"net"
	"net/http"
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

	statusCode, ms, body, err := probeHTTP(client, "https://"+in.FQDN+path, needle != "")
	if err != nil {
		statusCode, ms, body, err = probeHTTP(client, "http://"+in.FQDN+path, needle != "")
	}

	if err == nil {
		res := Result{StatusCode: &statusCode, ResponseMS: &ms, Status: "unhealthy"}
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

// maxBodyRead caps how much of the response is searched for Rules.BodyContains.
const maxBodyRead = 256 << 10

func probeHTTP(client *http.Client, url string, readBody bool) (int, int, string, error) {
	start := time.Now()
	resp, err := client.Get(url)
	if err != nil {
		return 0, 0, "", err
	}
	defer resp.Body.Close()
	ms := int(time.Since(start).Milliseconds())
	var body string
	if readBody {
		b, _ := io.ReadAll(io.LimitReader(resp.Body, maxBodyRead))
		body = string(b)
	}
	return resp.StatusCode, ms, body, nil
}

func shortErr(err error) string {
	s := err.Error()
	if len(s) > 300 {
		s = s[:300]
	}
	return s
}
