-- ─────────────────────────────────────────────────────────────
-- Circa Smart Farming — Supabase Schema
-- Run this in your Supabase SQL editor
-- ─────────────────────────────────────────────────────────────

-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- Base stations (one per turret)
create table if not exists base_stations (
  id          text primary key,        -- e.g. "station-001"
  name        text not null,
  field_x     float not null default 0, -- position in the field grid (0-1 normalized)
  field_y     float not null default 0,
  crop_type   text,
  online      boolean not null default false,
  created_at  timestamptz not null default now()
);

-- Nodes (ESP32 sensor nodes reporting to a base station)
create table if not exists nodes (
  id          text primary key,         -- e.g. "node-001"
  station_id  text references base_stations(id) on delete cascade,
  name        text not null,
  field_x     float not null default 0,
  field_y     float not null default 0,
  crop_type   text,
  online      boolean not null default false,
  created_at  timestamptz not null default now()
);

-- Live sensor readings (time-series)
create table if not exists sensor_readings (
  id           bigserial primary key,
  entity_type  text not null check (entity_type in ('station', 'node')),
  entity_id    text not null,
  metric       text not null,           -- 'humidity' | 'temperature' | 'soil_moisture' | 'status'
  value        float not null,
  recorded_at  timestamptz not null default now()
);

-- Index for fast queries by entity + time
create index if not exists sensor_readings_entity_time
  on sensor_readings (entity_id, recorded_at desc);

-- Schedules / IFTTT rules
create table if not exists schedules (
  id          uuid primary key default uuid_generate_v4(),
  station_id  text references base_stations(id) on delete cascade,
  name        text not null,
  trigger     jsonb not null,           -- { type: 'time'|'condition', cron?:..., metric?:..., operator?:..., threshold?:... }
  conditions  jsonb not null default '[]'::jsonb,
  actions     jsonb not null,           -- [{ type: 'fire_turret', angle, duration }, ...]
  enabled     boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Enable RLS (Row Level Security)
alter table base_stations enable row level security;
alter table nodes enable row level security;
alter table sensor_readings enable row level security;
alter table schedules enable row level security;

-- Public read policies (tighten for production with auth.uid())
create policy "Public read base_stations" on base_stations for select using (true);
create policy "Public insert base_stations" on base_stations for insert with check (true);
create policy "Public read nodes" on nodes for select using (true);
create policy "Public insert nodes" on nodes for insert with check (true);
create policy "Public read readings" on sensor_readings for select using (true);
create policy "Public insert readings" on sensor_readings for insert with check (true);
create policy "Public read schedules" on schedules for select using (true);
create policy "Public all schedules" on schedules for all using (true);
