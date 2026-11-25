// Created by Sandesh
package storage

import (
	"encoding/json"
	"time"
)

// Metadata and payloads have separate rows. Documents never contain child arrays.
type configuration struct {
	ID            bool `gorm:"primaryKey;autoIncrement:false"`
	Version       int64
	SchemaVersion int
}

func (configuration) TableName() string { return "workspace_state" }

type entityRow struct {
	Revision        string
	ID              string
	ProjectID       string
	FeatureID       string
	EndpointID      string
	Version         int64
	MetadataVersion int64
	Position        int64
	Document        json.RawMessage `gorm:"type:jsonb"`
	Body            json.RawMessage `gorm:"type:jsonb"`
}

type attemptRecord struct {
	Project      string `gorm:"primaryKey"`
	Environment  string `gorm:"primaryKey"`
	Endpoint     string `gorm:"primaryKey"`
	Revision     string `gorm:"primaryKey"`
	Session      string `gorm:"primaryKey"`
	Attempt      int64
	Cursor       string    `gorm:"not null;default:''"`
	LastResponse string    `gorm:"not null;default:''"`
	TouchedAt    time.Time `gorm:"default:now()"`
}

func (attemptRecord) TableName() string { return "attempts" }

type requestLog struct {
	ID          int64     `gorm:"primaryKey;autoIncrement"`
	CreatedAt   time.Time `gorm:"default:now();autoCreateTime:false"`
	Project     string
	Environment string
	Session     string
	Detail      json.RawMessage `gorm:"type:jsonb"`
}

func (requestLog) TableName() string { return "request_logs" }
