// Created by Sandesh
package config

import (
	"errors"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"strconv"

	"github.com/caarlos0/env/v11"
	"github.com/joho/godotenv"
)

type Config struct {
	PublicHost         string   `env:"PUBLIC_HOST" envDefault:"localhost"`
	BindAddress        string   `env:"BIND_ADDRESS" envDefault:"127.0.0.1"`
	AdminPort          int      `env:"ADMIN_PORT" envDefault:"8080"`
	MockPort           int      `env:"MOCK_PORT" envDefault:"9091"`
	DashboardPort      int      `env:"DASHBOARD_PORT" envDefault:"5173"`
	DatabaseURL        string   `env:"DATABASE_URL" envDefault:"postgres://mockman:mockman@127.0.0.1:54329/mockman?sslmode=disable"`
	AdminAddr          string   `env:"ADMIN_ADDR"`
	AdminOrigin        string   `env:"ADMIN_ORIGIN"`
	DashboardOrigin    string   `env:"DASHBOARD_ORIGIN"`
	MockAddr           string   `env:"MOCK_ADDR"`
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
	for _, port := range []int{cfg.AdminPort, cfg.MockPort, cfg.DashboardPort} {
		if port < 1 || port > 65535 {
			return Config{}, fmt.Errorf("port must be between 1 and 65535: %d", port)
		}
	}
	adminAddr := cfg.AdminAddr
	if cfg.AdminAddr == "" {
		cfg.AdminAddr = net.JoinHostPort(cfg.BindAddress, strconv.Itoa(cfg.AdminPort))
	}
	if cfg.MockAddr == "" {
		cfg.MockAddr = net.JoinHostPort(cfg.BindAddress, strconv.Itoa(cfg.MockPort))
	}
	if cfg.AdminOrigin == "" {
		cfg.AdminOrigin = "http://" + net.JoinHostPort(cfg.PublicHost, strconv.Itoa(cfg.AdminPort))
		if adminAddr != "" {
			cfg.AdminOrigin = "http://" + adminAddr
		}
	}
	if cfg.DashboardOrigin == "" {
		cfg.DashboardOrigin = "http://" + net.JoinHostPort(cfg.PublicHost, strconv.Itoa(cfg.DashboardPort))
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
