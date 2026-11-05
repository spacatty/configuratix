package handlers

import (
	"context"
	"time"

	"configuratix/backend/internal/database"
	"configuratix/backend/internal/models"

	"github.com/google/uuid"
)

// waitForJob polls a job until it reaches a terminal status, the timeout elapses or ctx is
// cancelled (client went away). Polling starts fast (150ms) and backs off to 1s.
// On timeout the latest job state is returned together with context.DeadlineExceeded.
func waitForJob(ctx context.Context, db *database.DB, jobID uuid.UUID, timeout time.Duration) (*models.Job, error) {
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	delay := 150 * time.Millisecond
	var job models.Job
	for {
		if err := db.GetContext(context.Background(), &job, "SELECT "+models.JobColumns+" FROM jobs WHERE id = $1", jobID); err != nil {
			return nil, err
		}
		if models.IsTerminalJobStatus(job.Status) {
			return &job, nil
		}
		select {
		case <-ctx.Done():
			return &job, context.DeadlineExceeded
		case <-time.After(delay):
		}
		if delay < time.Second {
			delay = delay * 3 / 2
		}
	}
}
