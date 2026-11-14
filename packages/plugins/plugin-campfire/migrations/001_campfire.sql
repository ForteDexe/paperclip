CREATE TABLE plugin_campfire_c1a2fb4ac8.rooms (
  id uuid PRIMARY KEY,
  space_id uuid NOT NULL REFERENCES public.spaces(id) ON DELETE CASCADE,
  project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (space_id, name)
);

CREATE TABLE plugin_campfire_c1a2fb4ac8.room_members (
  room_id uuid NOT NULL REFERENCES plugin_campfire_c1a2fb4ac8.rooms(id) ON DELETE CASCADE,
  space_id uuid NOT NULL REFERENCES public.spaces(id) ON DELETE CASCADE,
  agent_id uuid NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  handle text NOT NULL,
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (room_id, agent_id),
  UNIQUE (space_id, agent_id)
);

CREATE UNIQUE INDEX campfire_room_handle_unique
  ON plugin_campfire_c1a2fb4ac8.room_members (room_id, lower(handle));

CREATE TABLE plugin_campfire_c1a2fb4ac8.agent_sessions (
  room_id uuid NOT NULL,
  space_id uuid NOT NULL,
  agent_id uuid NOT NULL,
  session_id text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'closed', 'failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (room_id, agent_id),
  FOREIGN KEY (room_id, agent_id)
    REFERENCES plugin_campfire_c1a2fb4ac8.room_members(room_id, agent_id)
    ON DELETE CASCADE,
  UNIQUE (session_id)
);

CREATE TABLE plugin_campfire_c1a2fb4ac8.messages (
  id uuid PRIMARY KEY,
  seq bigserial NOT NULL,
  room_id uuid NOT NULL REFERENCES plugin_campfire_c1a2fb4ac8.rooms(id) ON DELETE CASCADE,
  space_id uuid NOT NULL REFERENCES public.spaces(id) ON DELETE CASCADE,
  author_kind text NOT NULL CHECK (author_kind IN ('human', 'agent', 'system')),
  author_agent_id uuid REFERENCES public.agents(id) ON DELETE SET NULL,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (room_id, seq)
);

CREATE INDEX campfire_messages_room_seq
  ON plugin_campfire_c1a2fb4ac8.messages (room_id, seq);

CREATE TABLE plugin_campfire_c1a2fb4ac8.message_mentions (
  message_id uuid NOT NULL REFERENCES plugin_campfire_c1a2fb4ac8.messages(id) ON DELETE CASCADE,
  agent_id uuid NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  PRIMARY KEY (message_id, agent_id)
);

CREATE TABLE plugin_campfire_c1a2fb4ac8.message_deliveries (
  id uuid PRIMARY KEY,
  message_id uuid NOT NULL REFERENCES plugin_campfire_c1a2fb4ac8.messages(id) ON DELETE CASCADE,
  agent_id uuid NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'delivered', 'failed')),
  run_id text,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  UNIQUE (message_id, agent_id)
);
