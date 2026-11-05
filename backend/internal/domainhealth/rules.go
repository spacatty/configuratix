package domainhealth

import (
	"fmt"
	"strconv"
	"strings"
)

// Rules are the probe settings a domain is checked with, from a preset or its own columns.
type Rules struct {
	Path           string `json:"path"`            // "/" when empty
	Expected       string `json:"expected"`        // status spec, e.g. "200", "200,301-302", "2xx"
	BodyContains   string `json:"body_contains"`   // "" = don't inspect the body
	TimeoutSeconds int    `json:"timeout_seconds"` // 0 = DefaultTimeoutSeconds
}

const (
	DefaultTimeoutSeconds = 15
	MaxTimeoutSeconds     = 60
	maxBodyContains       = 512
)

// Normalize trims the rules and validates them, filling defaults.
func (r Rules) Normalize() (Rules, error) {
	r.Path = strings.TrimSpace(r.Path)
	if r.Path == "" {
		r.Path = "/"
	}
	if !ValidPath(r.Path) {
		return r, fmt.Errorf("path must start with / and contain no spaces or control characters (max 512 chars)")
	}
	r.Expected = strings.TrimSpace(r.Expected)
	if r.Expected == "" {
		r.Expected = "200"
	}
	spec, err := ParseStatusSpec(r.Expected)
	if err != nil {
		return r, err
	}
	r.Expected = spec.String()
	r.BodyContains = strings.TrimSpace(r.BodyContains)
	if len(r.BodyContains) > maxBodyContains {
		return r, fmt.Errorf("body_contains is limited to %d characters", maxBodyContains)
	}
	if r.TimeoutSeconds == 0 {
		r.TimeoutSeconds = DefaultTimeoutSeconds
	}
	if r.TimeoutSeconds < 1 || r.TimeoutSeconds > MaxTimeoutSeconds {
		return r, fmt.Errorf("timeout_seconds must be between 1 and %d", MaxTimeoutSeconds)
	}
	return r, nil
}

type statusRange struct{ lo, hi int }

// StatusSpec is a set of accepted HTTP status codes.
type StatusSpec []statusRange

// ParseStatusSpec parses comma-separated codes, ranges ("200-299") and classes ("2xx").
func ParseStatusSpec(s string) (StatusSpec, error) {
	var out StatusSpec
	for _, tok := range strings.Split(s, ",") {
		tok = strings.ToLower(strings.TrimSpace(tok))
		if tok == "" {
			continue
		}
		var r statusRange
		switch {
		case len(tok) == 3 && strings.HasSuffix(tok, "xx") && tok[0] >= '1' && tok[0] <= '5':
			base := int(tok[0]-'0') * 100
			r = statusRange{base, base + 99}
		case strings.Contains(tok, "-"):
			a, b, _ := strings.Cut(tok, "-")
			lo, err1 := strconv.Atoi(strings.TrimSpace(a))
			hi, err2 := strconv.Atoi(strings.TrimSpace(b))
			if err1 != nil || err2 != nil || lo > hi {
				return nil, fmt.Errorf("invalid status range %q", tok)
			}
			r = statusRange{lo, hi}
		default:
			c, err := strconv.Atoi(tok)
			if err != nil {
				return nil, fmt.Errorf("invalid status %q (use codes like 200, ranges like 200-299 or classes like 2xx)", tok)
			}
			r = statusRange{c, c}
		}
		if r.lo < 100 || r.hi > 599 {
			return nil, fmt.Errorf("status %q must be between 100 and 599", tok)
		}
		out = append(out, r)
	}
	if len(out) == 0 {
		return nil, fmt.Errorf("at least one expected status is required")
	}
	if len(out) > 32 {
		return nil, fmt.Errorf("too many expected statuses")
	}
	return out, nil
}

// Match reports whether code is accepted.
func (s StatusSpec) Match(code int) bool {
	for _, r := range s {
		if code >= r.lo && code <= r.hi {
			return true
		}
	}
	return false
}

// String renders the spec canonically ("200,301-302,2xx").
func (s StatusSpec) String() string {
	parts := make([]string, len(s))
	for i, r := range s {
		switch {
		case r.lo == r.hi:
			parts[i] = strconv.Itoa(r.lo)
		case r.lo%100 == 0 && r.hi == r.lo+99:
			parts[i] = fmt.Sprintf("%dxx", r.lo/100)
		default:
			parts[i] = fmt.Sprintf("%d-%d", r.lo, r.hi)
		}
	}
	return strings.Join(parts, ",")
}

// FirstCode is the lowest single code of the spec, used for the legacy integer column.
func (s StatusSpec) FirstCode() int {
	return s[0].lo
}
