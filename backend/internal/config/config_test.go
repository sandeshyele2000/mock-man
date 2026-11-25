package config

import (
	"os"
	"testing"
)

func TestSharedHostAndPorts(t *testing.T) {
	t.Chdir(t.TempDir())
	for _, key := range []string{"ADMIN_ADDR", "MOCK_ADDR", "ADMIN_ORIGIN", "DASHBOARD_ORIGIN", "MOCK_ORIGIN"} {
		t.Setenv(key, "")
	}
	t.Setenv("PUBLIC_HOST", "studio.vpn")
	t.Setenv("BIND_ADDRESS", "0.0.0.0")
	t.Setenv("ADMIN_PORT", "18080")
	t.Setenv("MOCK_PORT", "19091")
	t.Setenv("DASHBOARD_PORT", "15173")
	cfg, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.AdminAddr != "0.0.0.0:18080" || cfg.MockAddr != "0.0.0.0:19091" || cfg.AdminOrigin != "http://studio.vpn:18080" || cfg.DashboardOrigin != "http://studio.vpn:15173" || cfg.MockOrigin != "http://studio.vpn:19091" {
		t.Fatalf("unexpected configuration: %+v", cfg)
	}
	t.Setenv("ADMIN_ADDR", "127.0.0.1:18081")
	cfg, err = Load()
	if err != nil || cfg.AdminOrigin != "http://127.0.0.1:18081" {
		t.Fatalf("legacy address override: %+v, %v", cfg, err)
	}
	t.Setenv("MOCK_ORIGIN", "https://public.example.com/mockman-mock/")
	t.Setenv("ADMIN_ORIGIN", "https://admin.example.com")
	cfg, err = Load()
	if err != nil || cfg.AdminOrigin != "https://admin.example.com" || cfg.MockOrigin != "https://public.example.com/mockman-mock/" {
		t.Fatalf("public override: %+v, %v", cfg, err)
	}
}

func TestDotEnvAndInvalidPort(t *testing.T) {
	t.Chdir(t.TempDir())
	for _, key := range []string{"ADMIN_ADDR", "MOCK_ADDR", "ADMIN_ORIGIN", "DASHBOARD_ORIGIN", "MOCK_ORIGIN"} {
		t.Setenv(key, "")
	}
	t.Setenv("ADMIN_PORT", "0")
	if _, err := Load(); err == nil {
		t.Fatal("expected invalid port error")
	}
	t.Setenv("ADMIN_PORT", "65536")
	if _, err := Load(); err == nil {
		t.Fatal("expected invalid port error")
	}
	t.Setenv("ADMIN_PORT", "18080")
	t.Setenv("MOCK_PORT", "19091")
	t.Setenv("DASHBOARD_PORT", "15173")
	t.Setenv("PUBLIC_HOST", "studio.vpn")
	if err := os.WriteFile(".env", []byte("PUBLIC_HOST=ignored.vpn\n"), 0600); err != nil {
		t.Fatal(err)
	}
	cfg, err := Load()
	if err != nil || cfg.PublicHost != "studio.vpn" {
		t.Fatalf("process environment should win: %+v, %v", cfg, err)
	}
}
