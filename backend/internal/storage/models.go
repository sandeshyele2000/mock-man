package storage

import (
	"encoding/json"
	"time"
)

// Models map to the existing migration-defined schema; no automatic schema changes occur.
type configuration struct {
	ID       bool `gorm:"primaryKey;autoIncrement:false"`
	Version  int64
	Document json.RawMessage `gorm:"type:json"`
}

func (configuration) TableName() string { return "configuration" }

type attemptRecord struct {
	Project     string `gorm:"primaryKey"`
	Environment string `gorm:"primaryKey"`
	Endpoint    string `gorm:"primaryKey"`
	Revision    string `gorm:"primaryKey"`
	Session     string `gorm:"primaryKey"`
	Attempt     int64
	TouchedAt   time.Time `gorm:"default:now()"`
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
