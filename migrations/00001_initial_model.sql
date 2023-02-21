CREATE EXTENSION btree_gin;

CREATE TABLE event (
    id TEXT PRIMARY KEY NOT NULL CHECK (id ~* '^[a-f0-9]{64}$'),
    pubkey TEXT NOT NULL CHECK (pubkey ~* '^[a-f0-9]{64}$'),
    created_at INTEGER NOT NULL CHECK (created_at >= 0),
    kind INTEGER NOT NULL CHECK (kind >= 0),
    raw TEXT NOT NULL
);

CREATE INDEX event_id_spgist_idx ON event USING spgist (id);
CREATE INDEX event_pubkey_spgist_idx ON event USING spgist (pubkey);
CREATE INDEX event_kind_idx ON event (kind);
CREATE INDEX event_created_at_idx ON event (created_at DESC);

CREATE OR REPLACE FUNCTION jsonb_array_to_text_array(_js jsonb)
  RETURNS text[]
  LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS
'SELECT ARRAY(SELECT jsonb_array_elements_text(_js))';

CREATE TABLE tag (
    event_id CHAR(64) REFERENCES event(id) ON DELETE CASCADE,
    tag TEXT NOT NULL,
    values TEXT[] NOT NULL,

    PRIMARY KEY (event_id, tag, values)
);

CREATE INDEX tag_tag_values_idx ON tag USING gin (event_id, tag, values);

CREATE FUNCTION event_notify() RETURNS TRIGGER AS $$
DECLARE
BEGIN
  PERFORM pg_notify('event', NEW.raw);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER event_notify_trigger
  AFTER INSERT OR UPDATE ON event
  FOR EACH ROW
  EXECUTE PROCEDURE event_notify();