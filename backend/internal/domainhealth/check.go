package domainhealth

import (
	"crypto/tls"
	"net"
	"net/http"
	"time"
)

// Input is everything needed to compute domain health from a live check.
type Input struct {
	FQDN               string
	AssignedMachineID  *string // nil or empty UUID string means unassigned
	MachineIP          *string
	ExpectedHTTPStatus int // 0 or invalid uses 200
}

// ComputeStatus runs DNS + HTTP(S) checks and returns the new status string.
func ComputeStatus(in Input) string {
	if in.AssignedMachineID == nil || *in.AssignedMachineID == "" {
		return "idle"
	}

	expected := in.ExpectedHTTPStatus
	if expected <= 0 || expected > 999 {
		expected = 200
	}

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
		Timeout: 15 * time.Second,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			return http.ErrUseLastResponse
		},
		Transport: &http.Transport{
			TLSClientConfig: &tls.Config{
				InsecureSkipVerify: true,
			},
		},
	}

	statusCode, ok := probeHTTP(client, "https://"+in.FQDN)
	if !ok {
		statusCode, ok = probeHTTP(client, "http://"+in.FQDN)
	}

	if ok {
		if statusCode == expected {
			return "healthy"
		}
		return "unhealthy"
	}

	if dnsErr != nil {
		return "unhealthy"
	}
	if dnsMatchesMachine {
		return "unhealthy"
	}
	return "proxied"
}

func probeHTTP(client *http.Client, url string) (statusCode int, ok bool) {
	resp, err := client.Get(url)
	if err != nil {
		return 0, false
	}
	defer resp.Body.Close()
	return resp.StatusCode, true
}
