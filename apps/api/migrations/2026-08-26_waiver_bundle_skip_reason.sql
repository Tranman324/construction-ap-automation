-- W13 (2026-08-26): persist the auto-link multi-waiver-bundle skip reason.
-- waiverAutoLinkService already detects stacked waiver forms (>2 lien-waiver
-- pages) and skips auto-linking with reason 'multi-waiver-bundle' — but the
-- signal was log-only. Persisting it lets the UI render a "split this
-- document" notice on the waiver. No new detection logic (binding ruling 10).

ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS waiver_auto_link_skip_reason TEXT;

COMMENT ON COLUMN documents.waiver_auto_link_skip_reason IS 'Why pipeline auto-link skipped this lien waiver (e.g. multi-waiver-bundle). Set by waiverAutoLinkService; rendered as a split notice in the UI.';
