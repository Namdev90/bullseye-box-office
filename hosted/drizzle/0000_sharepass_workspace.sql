CREATE TABLE sharepass_workspaces (
  owner_id TEXT PRIMARY KEY,
  revision INTEGER NOT NULL CHECK (revision >= 1),
  payload TEXT NOT NULL
);
