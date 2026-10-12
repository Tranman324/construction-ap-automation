BEGIN;

-- Serving surface for the NCG COI compliance configuration (certificate holder
-- identity + aliases, cancellation-notice minimum, coverage requirements, and
-- coverage-type aliases), previously hardcoded in the frontend
-- (coiComplianceConfig.ts). Single-row JSONB config; the compliance ENGINE stays
-- client-side this session — only its config source moves server-side. A richer
-- versioned/effective-dated model is a documented future step and is NOT built
-- here. Seed is value-identical to the frontend constant at migration time.
-- Additive-only; never applied by workers.
CREATE TABLE IF NOT EXISTS coi_compliance_config (
  id INTEGER PRIMARY KEY DEFAULT 1,
  config JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by TEXT,
  CONSTRAINT coi_compliance_config_singleton CHECK (id = 1)
);

INSERT INTO coi_compliance_config (id, config)
VALUES (1, '{"certificateHolder":{"name":"Northwind Contracting Group Inc.","nameAliases":["northwind contracting group","northwind contracting group inc","northwind contracting group inc.","northwind contracting group, inc.","ncg"],"address":"500 Example Gateway, Suite 180, Springfield, GA 30000"},"cancellationNoticeMinimumDays":30,"coverageRequirements":[{"type":"general-liability","label":"Commercial General Liability","required":true,"limits":[{"key":"eachOccurrence","label":"Each Occurrence","minimum":1000000},{"key":"generalAggregate","label":"General Aggregate","minimum":2000000},{"key":"productsCompOps","label":"Products-Comp/Op Agg","minimum":2000000},{"key":"damageToRented","label":"Damage to Rented Premises","minimum":50000},{"key":"medicalExpense","label":"Medical Expense","minimum":5000},{"key":"personalAdvInjury","label":"Personal & Adv Injury","minimum":1000000}]},{"type":"automobile","label":"Automobile Liability","required":true,"limits":[{"key":"combinedSingleLimit","label":"Combined Single Limit","minimum":1000000}]},{"type":"umbrella","label":"Umbrella / Excess Liability","required":true,"limits":[{"key":"eachOccurrence","label":"Each Occurrence","minimum":1000000},{"key":"aggregate","label":"Aggregate","minimum":1000000}]},{"type":"workers-comp","label":"Workers Compensation","required":true,"limits":[{"key":"eachAccident","label":"Each Accident","minimum":1000000},{"key":"diseaseEachEmployee","label":"Disease - Each Employee","minimum":1000000},{"key":"diseasePolicyLimit","label":"Disease - Policy Limit","minimum":1000000}]},{"type":"professional","label":"Professional Liability","required":false,"limits":[{"key":"eachLoss","label":"Each Loss","minimum":1000000},{"key":"aggregate","label":"Aggregate","minimum":1000000}]}],"coverageTypeAliases":{"general-liability":"general-liability","general liability":"general-liability","commercial general liability":"general-liability","cgl":"general-liability","gl":"general-liability","automobile":"automobile","auto":"automobile","auto liability":"automobile","automobile liability":"automobile","commercial auto":"automobile","umbrella":"umbrella","excess":"umbrella","umbrella / excess":"umbrella","umbrella/excess":"umbrella","excess liability":"umbrella","umbrella liability":"umbrella","workers-comp":"workers-comp","workers comp":"workers-comp","workers compensation":"workers-comp","workers'' compensation":"workers-comp","wc":"workers-comp","professional":"professional","professional liability":"professional","e&o":"professional","errors and omissions":"professional"}}'::jsonb)
ON CONFLICT (id) DO NOTHING;

COMMIT;
