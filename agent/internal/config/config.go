package config

import (
	"encoding/json"
	"os"
	"path/filepath"
)

const (
	ConfigDir  = "/etc/configuratix"
	ConfigFile = "agent.json"
)

type Config struct {
	ServerURL string `json:"server_url"`
	AgentID   string `json:"agent_id"`
	APIKey    string `json:"api_key"`
}

func Load() (*Config, error) {
	path := filepath.Join(ConfigDir, ConfigFile)
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}

	var config Config
	if err := json.Unmarshal(data, &config); err != nil {
		return nil, err
	}

	return &config, nil
}

func (c *Config) Save() error {
	if err := os.MkdirAll(ConfigDir, 0755); err != nil {
		return err
	}

	data, err := json.MarshalIndent(c, "", "  ")
	if err != nil {
		return err
	}

	path := filepath.Join(ConfigDir, ConfigFile)
	return os.WriteFile(path, data, 0600)
}

