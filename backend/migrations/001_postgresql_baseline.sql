-- SCC Platform — PostgreSQL baseline schema
-- Apply ONLY to empty/authorized databases. Never against operational data silently.
-- Compatible with SQLAlchemy 2 models in app/db/models.py

BEGIN;

CREATE TABLE IF NOT EXISTS list_items (
    id VARCHAR(36) PRIMARY KEY,
    list_type VARCHAR(64) NOT NULL,
    label VARCHAR(200) NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS ix_list_items_list_type ON list_items (list_type);

CREATE TABLE IF NOT EXISTS cases (
    id VARCHAR(36) PRIMARY KEY,
    case_id VARCHAR(32) NOT NULL UNIQUE,
    record_type VARCHAR(32) NOT NULL,
    status VARCHAR(32) NOT NULL,
    project VARCHAR(120),
    department VARCHAR(120),
    title VARCHAR(200) NOT NULL,
    occurred_on DATE NOT NULL,
    week_year INTEGER NOT NULL,
    week_number INTEGER NOT NULL,
    risk_level VARCHAR(80),
    created_at TIMESTAMPTZ NOT NULL,
    is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
    fields JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS ix_cases_case_id ON cases (case_id);
CREATE INDEX IF NOT EXISTS ix_cases_record_type ON cases (record_type);
CREATE INDEX IF NOT EXISTS ix_cases_status ON cases (status);
CREATE INDEX IF NOT EXISTS ix_cases_week ON cases (week_year, week_number);

CREATE TABLE IF NOT EXISTS contacts (
    id VARCHAR(36) PRIMARY KEY,
    project_id VARCHAR(36) NOT NULL,
    project VARCHAR(120) NOT NULL,
    category VARCHAR(64) NOT NULL,
    name VARCHAR(120) NOT NULL,
    job_title VARCHAR(120),
    role VARCHAR(120),
    contact_number VARCHAR(80),
    email VARCHAR(200)
);
CREATE INDEX IF NOT EXISTS ix_contacts_project_id ON contacts (project_id);

CREATE TABLE IF NOT EXISTS users (
    id VARCHAR(36) PRIMARY KEY,
    username VARCHAR(80) NOT NULL UNIQUE,
    display_name VARCHAR(120) NOT NULL,
    badge_number VARCHAR(80),
    email VARCHAR(200),
    role VARCHAR(20) NOT NULL,
    password_hash VARCHAR(200) NOT NULL,
    must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    projects JSONB
);
CREATE INDEX IF NOT EXISTS ix_users_username ON users (username);
CREATE INDEX IF NOT EXISTS ix_users_role ON users (role);

CREATE TABLE IF NOT EXISTS sessions (
    token VARCHAR(80) PRIMARY KEY,
    user_id VARCHAR(36) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    expires_at TIMESTAMPTZ,
    purpose VARCHAR(16) NOT NULL DEFAULT 'api'
);
CREATE INDEX IF NOT EXISTS ix_sessions_user_id ON sessions (user_id);

CREATE TABLE IF NOT EXISTS app_state (
    key VARCHAR(64) PRIMARY KEY,
    value JSONB NOT NULL,
    note TEXT
);

CREATE TABLE IF NOT EXISTS audit_events (
    id VARCHAR(36) PRIMARY KEY,
    occurred_at TIMESTAMPTZ NOT NULL,
    actor_user_id VARCHAR(36),
    actor_name VARCHAR(120) NOT NULL,
    action VARCHAR(64) NOT NULL,
    category VARCHAR(32) NOT NULL,
    summary VARCHAR(400) NOT NULL,
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    case_id VARCHAR(32)
);
CREATE INDEX IF NOT EXISTS ix_audit_events_occurred_at ON audit_events (occurred_at);
CREATE INDEX IF NOT EXISTS ix_audit_events_action ON audit_events (action);
CREATE INDEX IF NOT EXISTS ix_audit_events_category ON audit_events (category);
CREATE INDEX IF NOT EXISTS ix_audit_events_case_id ON audit_events (case_id);

CREATE TABLE IF NOT EXISTS weather_hourly_readings (
    id VARCHAR(36) PRIMARY KEY,
    station_id VARCHAR(32) NOT NULL,
    project VARCHAR(120) NOT NULL,
    location VARCHAR(160) NOT NULL,
    observed_on DATE NOT NULL,
    hour INTEGER NOT NULL,
    wind_ms DOUBLE PRECISION,
    temp_c DOUBLE PRECISION,
    rh_percent DOUBLE PRECISION,
    co2_ppm DOUBLE PRECISION,
    pm25 DOUBLE PRECISION,
    pm10 DOUBLE PRECISION,
    heat_index DOUBLE PRECISION,
    category_level INTEGER,
    category_name VARCHAR(64),
    remarks TEXT,
    status VARCHAR(16) NOT NULL DEFAULT 'ok',
    logged_by VARCHAR(120),
    updated_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT uq_weather_hourly_station_day_hour UNIQUE (station_id, observed_on, hour)
);
CREATE INDEX IF NOT EXISTS ix_weather_hourly_station_id ON weather_hourly_readings (station_id);
CREATE INDEX IF NOT EXISTS ix_weather_hourly_project ON weather_hourly_readings (project);
CREATE INDEX IF NOT EXISTS ix_weather_hourly_observed_on ON weather_hourly_readings (observed_on);

CREATE TABLE IF NOT EXISTS asset_classifications (
    asset_number VARCHAR(80) PRIMARY KEY,
    asset_category VARCHAR(120) NOT NULL,
    asset_type VARCHAR(120) NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_asset_classifications_category ON asset_classifications (asset_category);
CREATE INDEX IF NOT EXISTS ix_asset_classifications_type ON asset_classifications (asset_type);

CREATE TABLE IF NOT EXISTS weather_weekly_logs (
    id VARCHAR(48) PRIMARY KEY,
    project VARCHAR(120) NOT NULL,
    week_year INTEGER NOT NULL,
    week_number INTEGER NOT NULL,
    week_start DATE NOT NULL,
    week_end DATE NOT NULL,
    location VARCHAR(160) NOT NULL,
    station_count INTEGER NOT NULL DEFAULT 1,
    hours_logged INTEGER NOT NULL DEFAULT 0,
    hours_expected INTEGER NOT NULL DEFAULT 0,
    max_temp DOUBLE PRECISION NOT NULL DEFAULT 0,
    max_humidity DOUBLE PRECISION NOT NULL DEFAULT 0,
    max_heat_index DOUBLE PRECISION NOT NULL DEFAULT 0,
    highest_category JSONB NOT NULL DEFAULT '{}'::jsonb,
    remarks TEXT,
    submitted_by VARCHAR(120) NOT NULL,
    submitted_at TIMESTAMPTZ NOT NULL,
    days_by_station JSONB NOT NULL DEFAULT '[]'::jsonb,
    CONSTRAINT uq_weather_weekly_project_week UNIQUE (project, week_start)
);
CREATE INDEX IF NOT EXISTS ix_weather_weekly_project ON weather_weekly_logs (project);
CREATE INDEX IF NOT EXISTS ix_weather_weekly_week_number ON weather_weekly_logs (week_number);
CREATE INDEX IF NOT EXISTS ix_weather_weekly_week_start ON weather_weekly_logs (week_start);

COMMIT;
