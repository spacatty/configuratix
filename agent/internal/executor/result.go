package executor

import "encoding/json"

// Capabilities advertised in the heartbeat (see agent/COMMANDS.md).
var Capabilities = []string{
	"run.v2",
	"steps.if",
	"steps.capture",
	"steps.retries",
	"steps.env",
	"steps.continue_on_error",
	"rollback_steps",
	"file.atomic",
	"file.validate",
	"vars.quote",
	"vars.escape",
	"action.nginx_test",
	"action.assert",
	"action.script",
	"action.list",
	"logs.stream",
	"job.cancel",
	"job.timeout",
	"result.structured",
	"update.v2",
	"terminal.persistent",
}

// Step result statuses.
const (
	StepOK      = "ok"
	StepFailed  = "failed"
	StepSkipped = "skipped"
)

// StepResult is one entry of result_json.steps.
type StepResult struct {
	Index            int             `json:"index"`
	ID               string          `json:"id,omitempty"`
	Name             string          `json:"name"`
	Action           string          `json:"action"`
	Status           string          `json:"status"`
	ExitCode         int             `json:"exit_code"` // -1 when not applicable / killed
	DurationMs       int64           `json:"duration_ms"`
	Attempts         int             `json:"attempts,omitempty"`
	OutputTail       string          `json:"output_tail"`
	Error            string          `json:"error,omitempty"`
	ContinuedOnError bool            `json:"continued_on_error,omitempty"`
	Data             json.RawMessage `json:"data,omitempty"`
}

// Result is stored by the backend in jobs.result_json.
type Result struct {
	Version     int             `json:"version"` // schema version, 1
	JobType     string          `json:"job_type"`
	Status      string          `json:"status"` // completed, failed, cancelled (set by worker)
	Error       string          `json:"error,omitempty"`
	DurationMs  int64           `json:"duration_ms"`
	Steps       []StepResult    `json:"steps"`
	RolledBack  bool            `json:"rolled_back"`
	RollbackLog string          `json:"rollback_log,omitempty"`
	Data        json.RawMessage `json:"data,omitempty"`

	// After runs once the final job update has been sent (e.g. agent restart).
	After func() `json:"-"`
}

func newResult(jobType string) *Result {
	return &Result{Version: 1, JobType: jobType, Steps: []StepResult{}}
}
