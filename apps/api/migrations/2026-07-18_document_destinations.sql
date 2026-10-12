BEGIN;

-- Serving surface for the SharePoint destination catalog: the folder tree and
-- the per-document-type default destination paths, previously hardcoded in the
-- frontend (documentDestinations.ts + the *_DESTINATION constants). Single-row
-- JSONB config; Settings writes replace the validated config atomically. Seed is
-- value-identical to the frontend constants at migration time. Additive-only;
-- never applied by workers.
CREATE TABLE IF NOT EXISTS document_destinations (
  id INTEGER PRIMARY KEY DEFAULT 1,
  config JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by TEXT,
  CONSTRAINT document_destinations_singleton CHECK (id = 1)
);

INSERT INTO document_destinations (id, config)
VALUES (1, '{"rootLabel":"(Job root)","tree":[{"id":"contracts","name":"01 Contracts","children":[{"id":"subcontracts","name":"Subcontracts","children":[]},{"id":"executed-agreements","name":"Executed Agreements","children":[]}]},{"id":"financials","name":"02 Financials","children":[{"id":"pay-applications","name":"Pay Applications","children":[]},{"id":"lien-waivers","name":"Lien Waivers","children":[]},{"id":"retention","name":"Retention","children":[]}]},{"id":"insurance","name":"03 Insurance & Compliance","children":[{"id":"coi","name":"Certificates of Insurance","children":[]},{"id":"w9","name":"W-9s","children":[]},{"id":"safety","name":"Safety Documents","children":[]}]},{"id":"closeout","name":"04 Closeout","children":[{"id":"warranties","name":"Warranties","children":[]},{"id":"om-manuals","name":"O&M Manuals","children":[]},{"id":"as-builts","name":"As-Builts","children":[]}]},{"id":"archive","name":"99 Archive","children":[]}],"defaults":{"subcontract":"01 Contracts / Subcontracts","warranty":"04 Closeout / Warranties","lien-waiver":"02 Financials / Lien Waivers","other":"(Job root)"}}'::jsonb)
ON CONFLICT (id) DO NOTHING;

COMMIT;
