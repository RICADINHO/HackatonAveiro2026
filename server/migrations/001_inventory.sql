BEGIN;
CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA public;
CREATE SCHEMA IF NOT EXISTS aveiro;
SET LOCAL search_path TO aveiro, public;

CREATE TABLE IF NOT EXISTS aveiro.items (
    id uuid PRIMARY KEY,
    category text NOT NULL CHECK (category IN ('sinalizacao', 'iluminacao', 'residuos')),
    class_name text NOT NULL,
    label text NOT NULL,
    position geography(Point, 4326) NOT NULL,
    position_manually_corrected boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS items_position_idx ON aveiro.items USING gist (position);
CREATE INDEX IF NOT EXISTS items_class_idx ON aveiro.items (class_name);

CREATE TABLE IF NOT EXISTS aveiro.images (
    id uuid PRIMARY KEY,
    file_path text NOT NULL UNIQUE CHECK (file_path = id::text || '.jpg'),
    camera_position geography(Point, 4326) NOT NULL,
    camera_heading double precision NOT NULL CHECK (camera_heading >= 0 AND camera_heading < 360),
    uploader_id uuid NOT NULL,
    uploader_name text,
    submitted_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS images_camera_position_idx ON aveiro.images USING gist (camera_position);

CREATE TABLE IF NOT EXISTS aveiro.detections (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    image_id uuid NOT NULL REFERENCES aveiro.images (id) ON DELETE CASCADE,
    item_id uuid NOT NULL REFERENCES aveiro.items (id) ON DELETE CASCADE,
    predicted_class text NOT NULL,
    confidence double precision NOT NULL CHECK (confidence BETWEEN 0 AND 1),
    bbox jsonb NOT NULL,
    estimated_position geography(Point, 4326) NOT NULL
);
CREATE INDEX IF NOT EXISTS detections_image_idx ON aveiro.detections (image_id);
CREATE INDEX IF NOT EXISTS detections_item_idx ON aveiro.detections (item_id);

CREATE TABLE IF NOT EXISTS aveiro.reports (
    id uuid PRIMARY KEY,
    description text NOT NULL CHECK (char_length(description) BETWEEN 1 AND 4000),
    author_id uuid NOT NULL,
    item_id uuid REFERENCES aveiro.items (id) ON DELETE SET NULL,
    status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
    submitted_at timestamptz NOT NULL DEFAULT now(),
    resolved_by uuid,
    resolved_at timestamptz,
    CHECK ((status = 'open' AND resolved_by IS NULL AND resolved_at IS NULL)
        OR (status = 'resolved' AND resolved_by IS NOT NULL AND resolved_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS reports_item_idx ON aveiro.reports (item_id);

CREATE TABLE IF NOT EXISTS aveiro.image_previews (
    id uuid PRIMARY KEY,
    owner_id uuid NOT NULL,
    metadata jsonb NOT NULL,
    detections jsonb NOT NULL,
    expires_at timestamptz NOT NULL DEFAULT now() + interval '30 minutes'
);
CREATE INDEX IF NOT EXISTS image_previews_expiry_idx ON aveiro.image_previews (expires_at);
COMMIT;
