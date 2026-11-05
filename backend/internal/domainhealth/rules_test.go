package domainhealth

import "testing"

func TestParseStatusSpec(t *testing.T) {
	cases := []struct {
		in        string
		canonical string
		match     []int
		miss      []int
	}{
		{"200", "200", []int{200}, []int{201, 301}},
		{" 200, 301-302 ", "200,301-302", []int{200, 301, 302}, []int{303}},
		{"2xx,401", "2xx,401", []int{200, 204, 299, 401}, []int{301, 403}},
		{"300-399", "3xx", []int{301}, []int{200}},
	}
	for _, c := range cases {
		spec, err := ParseStatusSpec(c.in)
		if err != nil {
			t.Fatalf("%q: %v", c.in, err)
		}
		if got := spec.String(); got != c.canonical {
			t.Errorf("%q: canonical %q, want %q", c.in, got, c.canonical)
		}
		for _, code := range c.match {
			if !spec.Match(code) {
				t.Errorf("%q should match %d", c.in, code)
			}
		}
		for _, code := range c.miss {
			if spec.Match(code) {
				t.Errorf("%q should not match %d", c.in, code)
			}
		}
	}
	for _, bad := range []string{"", "abc", "600", "302-301", "6xx", "99"} {
		if _, err := ParseStatusSpec(bad); err == nil {
			t.Errorf("%q should fail", bad)
		}
	}
}

func TestRulesNormalize(t *testing.T) {
	r, err := Rules{Expected: "2XX"}.Normalize()
	if err != nil {
		t.Fatal(err)
	}
	if r.Path != "/" || r.Expected != "2xx" || r.TimeoutSeconds != DefaultTimeoutSeconds {
		t.Errorf("unexpected defaults: %+v", r)
	}
	if _, err := (Rules{Path: "health"}).Normalize(); err == nil {
		t.Error("path without leading slash should fail")
	}
	if _, err := (Rules{TimeoutSeconds: 61}).Normalize(); err == nil {
		t.Error("timeout above max should fail")
	}
}
