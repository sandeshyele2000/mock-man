// Created by Sandesh
package main

import (
	"context"
	"errors"
	"log/slog"
	"mockman/internal/admin"
	"mockman/internal/config"
	"mockman/internal/runtime"
	"mockman/internal/storage"
	"mockman/migrations"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"
)

func main() {
	if err := run(); err != nil {
		slog.Error("mockman stopped", "error", err)
	}
}

func run() error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()
	store, err := openStore(ctx, cfg)
	if err != nil {
		return err
	}
	defer store.Close()
	if err := store.Init(ctx, migrations.Schema); err != nil {
		return err
	}
	servers := newServers(cfg, store)
	return serve(ctx, servers, store)
}

func openStore(ctx context.Context, cfg config.Config) (*storage.Store, error) {
	startup, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	return storage.Open(startup, cfg.DatabaseURL)
}

func newServers(cfg config.Config, store *storage.Store) []*http.Server {
	mock := runtime.CORS(runtime.Handler(store), cfg.MockAllowedOrigins)
	adminHandler := admin.Server{Store: store, Origin: cfg.AdminOrigin, DashboardOrigin: cfg.DashboardOrigin, Runtime: mock}.Handler()
	return []*http.Server{
		{Addr: cfg.AdminAddr, Handler: adminHandler},
		{Addr: cfg.MockAddr, Handler: mock},
	}
}

func serve(ctx context.Context, servers []*http.Server, store *storage.Store) error {
	errs := make(chan error, len(servers))
	for _, server := range servers {
		configureServer(server)
		go listen(server, errs)
	}
	cleanupTicker := time.NewTicker(time.Minute)
	defer cleanupTicker.Stop()
	defer shutdownServers(servers)
	for {
		select {
		case <-ctx.Done():
			return nil
		case err := <-errs:
			if !errors.Is(err, http.ErrServerClosed) {
				return err
			}
		case <-cleanupTicker.C:
			if err := cleanupExpiredState(ctx, store); err != nil {
				slog.Warn("retention cleanup", "error", err)
			}
		}
	}
}

func configureServer(server *http.Server) {
	server.ReadHeaderTimeout = 5 * time.Second
	server.ReadTimeout = 10 * time.Second
	server.WriteTimeout = 40 * time.Second
	server.IdleTimeout = 60 * time.Second
	server.MaxHeaderBytes = 32 << 10
}

func listen(server *http.Server, errs chan<- error) {
	slog.Info("listening", "address", server.Addr)
	errs <- server.ListenAndServe()
}

func shutdownServers(servers []*http.Server) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	for _, server := range servers {
		_ = server.Shutdown(ctx)
	}
}

func cleanupExpiredState(parent context.Context, store *storage.Store) error {
	ctx, cancel := context.WithTimeout(parent, 5*time.Second)
	defer cancel()
	return store.Cleanup(ctx)
}
