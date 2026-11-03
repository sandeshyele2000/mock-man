package config

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"

	"github.com/caarlos0/env/v11"
	"github.com/joho/godotenv"
)

type Config struct {
	DatabaseURL        string   `env:"DATABASE_URL" envDefault:"postgres://mockman:mockman@127.0.0.1:54329/mockman?sslmode=disable"`
	AdminAddr          string   `env:"ADMIN_ADDR" envDefault:"127.0.0.1:8080"`
	AdminOrigin        string   `env:"ADMIN_ORIGIN"`
	DashboardOrigin    string   `env:"DASHBOARD_ORIGIN" envDefault:"http://127.0.0.1:5173"`
	MockAddr           string   `env:"MOCK_ADDR" envDefault:"127.0.0.1:9090"`
	MockAllowedOrigins []string `env:"MOCK_ALLOWED_ORIGINS" envSeparator:","`
}

// Load reads .env from the current directory or its parent, then parses process settings.
// Existing process environment values take precedence over values from .env.
func Load() (Config, error) {
	if err := loadDotEnv(); err != nil {
		return Config{}, err
	}
	var cfg Config
	if err := env.Parse(&cfg); err != nil {
		return Config{}, fmt.Errorf("read environment configuration: %w", err)
	}
	if cfg.AdminOrigin == "" {
		cfg.AdminOrigin = "http://" + cfg.AdminAddr
	}
	return cfg, nil
}

func loadDotEnv() error {
	cwd, err := os.Getwd()
	if err != nil {
		return err
	}
	candidates := []string{filepath.Join(cwd, ".env"), filepath.Join(cwd, "..", ".env")}
	for _, path := range candidates {
		if _, err := os.Stat(path); errors.Is(err, os.ErrNotExist) {
			continue
		} else if err != nil {
			return fmt.Errorf("inspect %s: %w", path, err)
		}
		if err := godotenv.Load(path); err != nil {
			return fmt.Errorf("load %s: %w", path, err)
		}
	}
	return nil
}
