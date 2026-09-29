-- Wiwana control-plane schema (PostgreSQL 15+)

create extension if not exists "pgcrypto";

create table if not exists users (
  id text primary key,
  phone text unique,
  wechat_open_id text unique,
  display_name text not null default '新用户',
  role text not null default 'user',
  status text not null default 'active',
  created_at timestamptz not null default now()
);

create table if not exists user_quotas (
  user_id text primary key references users(id) on delete cascade,
  daily_tokens integer,
  daily_images integer,
  daily_videos integer,
  max_running_tasks integer
);

create table if not exists projects (
  id text primary key,
  user_id text not null references users(id) on delete cascade,
  name text not null,
  workspace_key text not null,
  environment text not null default 'project-workspace',
  preview_domain text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists projects_user_idx on projects (user_id, updated_at desc);

create table if not exists tasks (
  id text primary key,
  user_id text not null references users(id) on delete cascade,
  project_id text not null references projects(id) on delete cascade,
  type text not null,
  title text not null,
  prompt text not null,
  status text not null default 'queued',
  progress integer not null default 0,
  session_id text,
  container_id text,
  error text,
  result_summary text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  updated_at timestamptz not null default now()
);
create index if not exists tasks_user_idx on tasks (user_id, created_at desc);
create index if not exists tasks_status_idx on tasks (status);

create table if not exists messages (
  id text primary key,
  task_id text not null references tasks(id) on delete cascade,
  role text not null,
  text text not null,
  created_at timestamptz not null default now()
);
create index if not exists messages_task_idx on messages (task_id, created_at);

create table if not exists task_events (
  task_id text not null references tasks(id) on delete cascade,
  seq integer not null,
  event jsonb not null,
  created_at timestamptz not null default now(),
  primary key (task_id, seq)
);

create table if not exists artifacts (
  id text primary key,
  task_id text references tasks(id) on delete set null,
  project_id text not null references projects(id) on delete cascade,
  user_id text not null references users(id) on delete cascade,
  kind text not null,
  name text not null,
  path text not null,
  mime text not null,
  size_bytes bigint not null default 0,
  preview_url text,
  download_url text,
  share_enabled boolean not null default false,
  share_slug text unique,
  created_at timestamptz not null default now()
);
create index if not exists artifacts_user_idx on artifacts (user_id, created_at desc);

create table if not exists containers (
  id text primary key,
  project_id text not null references projects(id) on delete cascade,
  task_id text,
  provider text not null,
  external_id text not null,
  state text not null,
  endpoint text,
  runtime_token text,
  preview_port integer,
  started_at timestamptz not null default now(),
  last_activity_at timestamptz not null default now(),
  stopped_at timestamptz
);

create table if not exists usage_daily (
  user_id text not null references users(id) on delete cascade,
  day date not null,
  tokens bigint not null default 0,
  images integer not null default 0,
  videos integer not null default 0,
  container_minutes integer not null default 0,
  tasks integer not null default 0,
  primary key (user_id, day)
);

create table if not exists notifications (
  id text primary key,
  user_id text not null references users(id) on delete cascade,
  task_id text,
  level text not null default 'info',
  title text not null,
  body text not null default '',
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists automations (
  id text primary key,
  user_id text not null references users(id) on delete cascade,
  project_id text not null references projects(id) on delete cascade,
  name text not null,
  enabled boolean not null default true,
  trigger jsonb not null,
  action_prompt text not null,
  last_run_at timestamptz,
  next_run_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists connectors (
  id text primary key,
  user_id text not null references users(id) on delete cascade,
  provider text not null,
  status text not null default 'connected',
  credential_ref text not null,
  created_at timestamptz not null default now()
);

create table if not exists otps (
  phone text primary key,
  code text not null,
  expires_at timestamptz not null
);

-- Existing databases: bring `containers` up to date with the cloud-computer columns.
alter table containers add column if not exists runtime_token text;
