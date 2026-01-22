package dns

import (
	"context"
	"fmt"
)

// SyncService handles comparing and syncing DNS records between local DB and remote provider
type SyncService struct{}

// NewSyncService creates a new sync service
func NewSyncService() *SyncService {
	return &SyncService{}
}

// Compare compares local records with remote records and returns the diff
func (s *SyncService) Compare(localRecords []Record, remoteRecords []Record) *SyncResult {
	result := &SyncResult{
		InSync:    true,
		Created:   []Record{},
		Updated:   []Record{},
		Deleted:   []Record{},
		Conflicts: []Conflict{},
		Errors:    []string{},
	}

	// Build maps for comparison using name:type as key
	localMap := make(map[string]Record)
	remoteMap := make(map[string]Record)

	for _, r := range localRecords {
		key := fmt.Sprintf("%s:%s", r.Name, r.Type)
		localMap[key] = r
	}

	for _, r := range remoteRecords {
		key := fmt.Sprintf("%s:%s", r.Name, r.Type)
		remoteMap[key] = r
	}

	// Find records in local but not in remote (need to create)
	// Find records that differ (conflicts)
	for key, local := range localMap {
		if remote, exists := remoteMap[key]; exists {
			// Both exist - check if values match
			if local.Value != remote.Value {
				result.InSync = false
				result.Conflicts = append(result.Conflicts, Conflict{
					RecordName:  local.Name,
					RecordType:  local.Type,
					LocalValue:  local.Value,
					RemoteValue: remote.Value,
					RemoteID:    remote.ID,
					LocalID:     local.ID,
				})
			}
		} else {
			// In local only - needs to be created on remote
			result.InSync = false
			result.Created = append(result.Created, local)
		}
	}

	// Find records in remote but not in local (remote-only)
	for key, remote := range remoteMap {
		if _, exists := localMap[key]; !exists {
			result.InSync = false
			result.Deleted = append(result.Deleted, remote)
		}
	}

	return result
}

// ApplyToRemote pushes local records to the remote provider
func (s *SyncService) ApplyToRemote(ctx context.Context, provider Provider, domain string, localRecords []Record, remoteRecords []Record) (*SyncResult, error) {
	comparison := s.Compare(localRecords, remoteRecords)
	result := &SyncResult{
		Created:   []Record{},
		Updated:   []Record{},
		Deleted:   []Record{},
		Conflicts: []Conflict{},
		Errors:    []string{},
	}

	// Create missing records
	for _, record := range comparison.Created {
		created, err := provider.CreateRecord(ctx, domain, record)
		if err != nil {
			result.Errors = append(result.Errors, fmt.Sprintf("Failed to create %s %s: %v", record.Type, record.Name, err))
			continue
		}
		result.Created = append(result.Created, *created)
	}

	// Update conflicting records (use local value)
	for _, conflict := range comparison.Conflicts {
		localRecord := Record{
			Name:  conflict.RecordName,
			Type:  conflict.RecordType,
			Value: conflict.LocalValue,
			TTL:   600,
		}
		updated, err := provider.UpdateRecord(ctx, domain, conflict.RemoteID, localRecord)
		if err != nil {
			result.Errors = append(result.Errors, fmt.Sprintf("Failed to update %s %s: %v", conflict.RecordType, conflict.RecordName, err))
			continue
		}
		result.Updated = append(result.Updated, *updated)
	}

	// Delete remote-only records
	for _, record := range comparison.Deleted {
		err := provider.DeleteRecord(ctx, domain, record.ID)
		if err != nil {
			result.Errors = append(result.Errors, fmt.Sprintf("Failed to delete %s %s: %v", record.Type, record.Name, err))
			continue
		}
		result.Deleted = append(result.Deleted, record)
	}

	result.InSync = len(result.Errors) == 0
	return result, nil
}

// ImportFromRemote returns remote records that can be imported into local DB
func (s *SyncService) ImportFromRemote(ctx context.Context, provider Provider, domain string) ([]Record, error) {
	return provider.ListRecords(ctx, domain)
}

