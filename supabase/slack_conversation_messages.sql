create table if not exists public.slack_conversation_messages (
  id text primary key,
  workspace_key text not null,
  channel_id text not null,
  thread_ts text not null,
  message_ts text not null,
  role text not null check (role in ('user', 'assistant')),
  user_id text,
  text text not null,
  created_at timestamptz not null default now()
);

create index if not exists slack_conversation_messages_workspace_channel_message_ts_idx
  on public.slack_conversation_messages (workspace_key, channel_id, message_ts desc);

create index if not exists slack_conversation_messages_workspace_channel_thread_ts_idx
  on public.slack_conversation_messages (workspace_key, channel_id, thread_ts, message_ts desc);
