-- Derived from the independently reviewed October 1 corrected prototype.
-- Explicit local/staging initialization only; never run by a callable.
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS fuzzystrmatch;
CREATE TABLE IF NOT EXISTS publication (singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton), revision bigint NOT NULL, fence jsonb NOT NULL);
INSERT INTO publication VALUES(true,0,'[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]') ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS revisions (revision bigint PRIMARY KEY, fence jsonb NOT NULL, published_at timestamptz NOT NULL DEFAULT clock_timestamp());
INSERT INTO revisions VALUES(0,'[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]',clock_timestamp()) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS inbox (shard smallint NOT NULL, seq bigint NOT NULL, payload jsonb NOT NULL, digest text NOT NULL, PRIMARY KEY(shard,seq));
CREATE TABLE IF NOT EXISTS entities (
 space text NOT NULL CHECK(space IN ('score','saver')), kind text NOT NULL, id text NOT NULL, parent_id text,
 valid_from bigint NOT NULL, valid_to bigint NOT NULL DEFAULT 9223372036854775807,
 visible boolean NOT NULL, dto jsonb NOT NULL, fingerprint text NOT NULL,
 latitude double precision, longitude double precision, geo geography(Point,4326),
 name_key bytea NOT NULL, id_key bytea NOT NULL, fields text NOT NULL,
 state text NOT NULL, city text NOT NULL, zip text NOT NULL, finder_name text NOT NULL, finder_close text NOT NULL,
 score double precision NOT NULL DEFAULT 0, reviews double precision NOT NULL DEFAULT 0,
 value_score double precision, flavor_score double precision, quality_score double precision, enjoyed_score double precision,
 PRIMARY KEY(space,kind,id,valid_from)
);
CREATE UNIQUE INDEX IF NOT EXISTS entity_current ON entities(space,kind,id) WHERE valid_to=9223372036854775807;
CREATE INDEX IF NOT EXISTS entity_geo ON entities USING gist(geo);
CREATE INDEX IF NOT EXISTS entity_parent ON entities(space,kind,parent_id,valid_from,valid_to);
CREATE INDEX IF NOT EXISTS entity_text ON entities USING gin(fields gin_trgm_ops);
CREATE INDEX IF NOT EXISTS entity_finder ON entities(space,kind,state,zip text_pattern_ops);
CREATE INDEX IF NOT EXISTS entity_city ON entities USING gin(city gin_trgm_ops);
CREATE INDEX IF NOT EXISTS entity_rank_prefix ON entities(space,kind,score DESC,reviews DESC,name_key);
CREATE INDEX IF NOT EXISTS entity_name_prefix ON entities(space,kind,name_key);
CREATE INDEX IF NOT EXISTS entity_gc ON entities(valid_to) WHERE valid_to<9223372036854775807;
CREATE TABLE IF NOT EXISTS sessions (id text PRIMARY KEY, actor text NOT NULL, realm text NOT NULL, revision bigint NOT NULL REFERENCES revisions(revision), criteria jsonb NOT NULL, criteria_hash text NOT NULL, membership_ms bigint NOT NULL, expires_ms bigint NOT NULL, idle_ms bigint NOT NULL);
CREATE INDEX IF NOT EXISTS session_gc ON sessions(expires_ms,revision);
CREATE TABLE IF NOT EXISTS receipts (session_id text NOT NULL REFERENCES sessions(id) ON DELETE CASCADE, operation text NOT NULL, request_hash text NOT NULL, response jsonb NOT NULL, PRIMARY KEY(session_id,operation));
CREATE OR REPLACE FUNCTION app_miles(a double precision,b double precision,c double precision,d double precision) RETURNS double precision LANGUAGE plpgsql IMMUTABLE STRICT PARALLEL SAFE AS $$
DECLARE la double precision; lb double precision; ls double precision; os double precision; h double precision;
BEGIN
la:=a*(3.141592653589793/180); lb:=c*(3.141592653589793/180);
ls:=sin((lb-la)/2); os:=sin(((d-b)*(3.141592653589793/180))/2);
h:=ls*ls+cos(la)*cos(lb)*os*os;
RETURN (6378137*(2*atan2(sqrt(greatest(0,least(1,h))),sqrt(greatest(0,1-h)))))/1609.344;
END $$;
CREATE OR REPLACE FUNCTION finder_score(n text,q text) RETURNS double precision LANGUAGE plpgsql IMMUTABLE STRICT PARALLEL SAFE AS $$
DECLARE qt text[]; nt text[]; t text; k text; matched integer:=0; yes boolean;
BEGIN
IF n='' OR q='' THEN RETURN 0; END IF;
IF n=q THEN RETURN 100; END IF;
IF starts_with(n,q) THEN RETURN 90; END IF;
IF position(q in n)>0 THEN RETURN 80; END IF;
SELECT array_agg(DISTINCT x) INTO qt FROM (SELECT unnest(string_to_array(q,' ')) x UNION ALL SELECT left(v,-1) FROM unnest(string_to_array(q,' ')) v WHERE length(v)>3 AND right(v,1)='s') z;
SELECT array_agg(DISTINCT x) INTO nt FROM (SELECT unnest(string_to_array(n,' ')) x UNION ALL SELECT left(v,-1) FROM unnest(string_to_array(n,' ')) v WHERE length(v)>3 AND right(v,1)='s') z;
FOREACH t IN ARRAY qt LOOP
 yes:=t=ANY(nt);
 IF NOT yes AND length(t)>=3 THEN FOREACH k IN ARRAY nt LOOP IF starts_with(k,t) THEN yes:=true; EXIT; END IF; END LOOP; END IF;
 IF yes THEN matched:=matched+1; END IF;
END LOOP;
IF matched=cardinality(qt) THEN RETURN 70; END IF;
RETURN CASE WHEN matched>0 AND matched=cardinality(qt)-1 THEN 55 ELSE 0 END;
END $$;
ALTER TABLE entities ADD COLUMN IF NOT EXISTS pref_city text NOT NULL DEFAULT '';
ALTER TABLE entities ADD COLUMN IF NOT EXISTS pref_state text NOT NULL DEFAULT '';
ALTER TABLE entities ADD COLUMN IF NOT EXISTS finder_tokens text[] NOT NULL DEFAULT '{}';
CREATE OR REPLACE FUNCTION finder_close_score(n text,q text,nt text[],qt text[]) RETURNS float8 LANGUAGE plpgsql IMMUTABLE STRICT PARALLEL SAFE AS $$
DECLARE prev int[]; cur int[]; i int; j int; shared int; total int; score float8; longest int; edit_distance int;
BEGIN
IF n=q THEN RETURN 2; END IF;
IF position(n in q)>0 OR position(q in n)>0 THEN RETURN 1; END IF;
IF starts_with(n,q) OR starts_with(q,n) THEN RETURN 0.92; END IF;
SELECT count(*) INTO shared FROM (SELECT unnest(nt) INTERSECT SELECT unnest(qt)) z;
SELECT count(*) INTO total FROM (SELECT unnest(nt) UNION SELECT unnest(qt)) z;
IF n ~ '^[a-z0-9 ]*$' AND q ~ '^[a-z0-9 ]*$' AND octet_length(n)<=255 AND octet_length(q)<=255 THEN
 edit_distance:=levenshtein(n,q,1,1,1);
ELSE
prev:=ARRAY(SELECT generate_series(0,length(n)));
FOR i IN 1..length(q) LOOP
 cur:=ARRAY[i];
 FOR j IN 1..length(n) LOOP cur:=array_append(cur,least(cur[j]+1,prev[j+1]+1,prev[j]+CASE WHEN substr(q,i,1)=substr(n,j,1) THEN 0 ELSE 1 END)); END LOOP;
 prev:=cur;
END LOOP;
 edit_distance:=prev[length(n)+1];
END IF;
longest:=greatest(length(n),length(q));score:=greatest(CASE WHEN total=0 THEN 0 ELSE shared::float8/total END,CASE WHEN longest=0 THEN 0 ELSE 1-edit_distance::float8/longest END);
RETURN CASE WHEN score>=0.55 THEN score ELSE 0 END;
END $$;

ALTER TABLE entities ADD COLUMN IF NOT EXISTS raw_city_lower text NOT NULL DEFAULT '';
ALTER TABLE entities ADD COLUMN IF NOT EXISTS raw_zip_lower text NOT NULL DEFAULT '';

ALTER TABLE sessions ADD COLUMN IF NOT EXISTS lease_ms bigint NOT NULL DEFAULT 0;

ALTER TABLE entities ADD COLUMN IF NOT EXISTS recall text NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS entity_recall ON entities USING gin(recall gin_trgm_ops);
CREATE INDEX IF NOT EXISTS entity_terms ON entities USING gin(string_to_array(recall,chr(1)));
CREATE TABLE IF NOT EXISTS admissions(actor text NOT NULL,realm text NOT NULL,operation text NOT NULL,criteria_hash text NOT NULL,fence jsonb NOT NULL,membership_ms bigint NOT NULL,session_id text,PRIMARY KEY(actor,realm,operation));

DROP INDEX IF EXISTS entity_rank;
DROP INDEX IF EXISTS entity_name;

CREATE TABLE IF NOT EXISTS bootstrap(singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton), ready boolean NOT NULL DEFAULT false);
INSERT INTO bootstrap VALUES(true,false) ON CONFLICT DO NOTHING;

ALTER TABLE bootstrap ALTER COLUMN ready SET DEFAULT false;

-- Canonical immutable ordering of source timestamp representations. New model
-- Date/toDate values are normalized to seconds/nanoseconds before persistence.
CREATE OR REPLACE FUNCTION proof_offer_key(dto jsonb) RETURNS text LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $$
DECLARE t jsonb := dto->'createdAt'; sec jsonb; nano jsonb; sv numeric; nv numeric;
BEGIN
 IF t ? 'seconds' OR t ? 'nanoseconds' THEN sec:=t->'seconds'; nano:=t->'nanoseconds';
 ELSE sec:=t->'_seconds'; nano:=t->'_nanoseconds'; END IF;
 IF jsonb_typeof(sec) IS DISTINCT FROM 'number' OR jsonb_typeof(nano) IS DISTINCT FROM 'number' THEN RETURN NULL; END IF;
 sv:=sec::text::numeric; nv:=nano::text::numeric;
 IF sv<>trunc(sv) OR nv<>trunc(nv) OR sv < -62135596800 OR sv > 253402300799 OR nv < 0 OR nv >= 1000000000 THEN RETURN NULL; END IF;
 RETURN 'v1:' || lpad((sv::bigint+62135596800)::text,12,'0') || ':' || lpad(nv::bigint::text,9,'0');
END $$;
CREATE INDEX IF NOT EXISTS entity_parent_latitude ON entities(space,kind,latitude,valid_from,valid_to) WHERE visible AND kind='restaurant';

ALTER TABLE entities ADD COLUMN IF NOT EXISTS projection jsonb NOT NULL DEFAULT '{}';
ALTER TABLE entities ADD COLUMN IF NOT EXISTS index_path text NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS entity_index_path ON entities(index_path,valid_from,valid_to);
CREATE TABLE IF NOT EXISTS source_heads (
 index_path text PRIMARY KEY, shard smallint NOT NULL, payload jsonb NOT NULL, digest text NOT NULL
);
CREATE TABLE IF NOT EXISTS ingestion_progress (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton), fence jsonb NOT NULL,
 state text NOT NULL CHECK(state IN ('empty','receiving','ready','blocked')), failure jsonb
);
INSERT INTO ingestion_progress VALUES(true,'[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]','empty',NULL) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS revision_pins (
 id text PRIMARY KEY, revision bigint NOT NULL REFERENCES revisions(revision),
 expires_ms bigint NOT NULL, lease_ms bigint NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS revision_pin_expiry ON revision_pins(expires_ms,revision);
ALTER TABLE revisions ADD COLUMN IF NOT EXISTS source_manifest jsonb;

ALTER TABLE ingestion_progress ADD COLUMN IF NOT EXISTS target jsonb;
ALTER TABLE ingestion_progress ADD COLUMN IF NOT EXISTS epoch text;

CREATE TABLE IF NOT EXISTS refinement_work (
 id text PRIMARY KEY, session_id text NOT NULL, revision bigint NOT NULL REFERENCES revisions(revision),
 expires_ms bigint NOT NULL, state jsonb
);
CREATE INDEX IF NOT EXISTS refinement_expiry ON refinement_work(expires_ms);
CREATE INDEX IF NOT EXISTS refinement_revision ON refinement_work(revision);
CREATE TABLE IF NOT EXISTS projection_poison (
 index_path text PRIMARY KEY, revision bigint NOT NULL, shard smallint NOT NULL, seq bigint NOT NULL, digest text NOT NULL
);

-- Finite per-intent source watermark; retained through the pin lifetime.
CREATE TABLE IF NOT EXISTS admission_targets (
 id text PRIMARY KEY, expires_ms bigint NOT NULL, target jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS admission_target_expiry ON admission_targets(expires_ms,id);

-- Ordinary publication reads these 48 rows. Initialization alone reconciles
-- preexisting derived heads; a full independent audit remains explicit.
CREATE TABLE IF NOT EXISTS source_manifest_partitions (
 shard smallint NOT NULL CHECK(shard>=0 AND shard<16),
 collection text NOT NULL CHECK(collection IN ('restaurant_search_index','dish_search_index','bitesaver_offer_index')),
 count bigint NOT NULL CHECK(count>=0), xor bit(256) NOT NULL, PRIMARY KEY(shard,collection)
);
INSERT INTO source_manifest_partitions(shard,collection,count,xor)
SELECT s,c,coalesce(h.count,0),coalesce(h.xor,repeat('0',256)::bit(256))
FROM generate_series(0,15) s CROSS JOIN unnest(ARRAY['restaurant_search_index','dish_search_index','bitesaver_offer_index']) c
LEFT JOIN (SELECT shard,payload->>'collection' AS collection,count(*) AS count,bit_xor(('x'||digest)::bit(256)) AS xor
 FROM source_heads GROUP BY shard,payload->>'collection') h ON h.shard=s AND h.collection=c
ON CONFLICT(shard,collection) DO NOTHING;
CREATE OR REPLACE FUNCTION maintain_source_manifest() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' AND OLD.shard=NEW.shard AND OLD.payload->>'collection'=NEW.payload->>'collection' AND OLD.digest=NEW.digest THEN RETURN NEW; END IF;
 IF TG_OP IN ('DELETE','UPDATE') THEN
  UPDATE source_manifest_partitions SET count=count-1,xor=xor # ('x'||OLD.digest)::bit(256)
   WHERE shard=OLD.shard AND collection=OLD.payload->>'collection';
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing old source manifest partition'; END IF;
 END IF;
 IF TG_OP IN ('INSERT','UPDATE') THEN
  UPDATE source_manifest_partitions SET count=count+1,xor=xor # ('x'||NEW.digest)::bit(256)
   WHERE shard=NEW.shard AND collection=NEW.payload->>'collection';
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing new source manifest partition'; END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS source_manifest_change ON source_heads;
CREATE TRIGGER source_manifest_change AFTER INSERT OR UPDATE OR DELETE ON source_heads FOR EACH ROW EXECUTE FUNCTION maintain_source_manifest();

CREATE OR REPLACE FUNCTION reset_source_manifest() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 UPDATE source_manifest_partitions SET count=0,xor=repeat('0',256)::bit(256);
 RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS source_manifest_truncate ON source_heads;
CREATE TRIGGER source_manifest_truncate AFTER TRUNCATE ON source_heads
FOR EACH STATEMENT EXECUTE FUNCTION reset_source_manifest();
CREATE INDEX IF NOT EXISTS entity_parent_geometry ON entities USING gist ((geo::geometry))
WHERE visible AND kind='restaurant';
