'use strict';

const routeBoundaryFiles = [
  'server.js',
  'routes/**',
  'modules/**/routes.js',
  'modules/**/routes/**',
];

const databaseBoundaryPatterns = [
  '**/lib/db',
  '**/lib/db.js',
  '**/lib/**/db',
  '**/lib/**/db.js',
  'pg/**',
  '@supabase/supabase-js/**',
];

const boundaryMessage = 'Routes and server wiring must call domain services; database clients belong in services.';

// One-off scripts and standalone daemons must not import the shared API pool
// (lib/db) or the invoices supabase re-export of it; they use lib/scriptDb.js
// (a single pg.Client with guaranteed teardown). This prevents a stray script
// from holding session-pool connections (the 2026-07-15 exhaustion incident).
const scriptBoundaryFiles = [
  'scripts/**/*.js',
  'modules/**/scripts/**/*.js',
];

const scriptDbBoundaryPatterns = [
  '**/lib/db',
  '**/lib/db.js',
  '**/lib/**/db',
  '**/lib/**/db.js',
  '**/services/supabase',
  '**/services/supabase.js',
];

const scriptBoundaryMessage = 'Scripts must use lib/scriptDb.js (single client, guaranteed teardown), not the shared API pool (lib/db / services/supabase).';

module.exports = [
  {
    files: routeBoundaryFiles,
    rules: {
      // Covers ES module import/export declarations.
      'no-restricted-imports': ['error', {
        paths: [
          { name: 'pg', message: boundaryMessage },
          { name: '@supabase/supabase-js', message: boundaryMessage },
        ],
        patterns: [
          { group: databaseBoundaryPatterns, message: boundaryMessage },
        ],
      }],
      // Covers CommonJS require() declarations in this codebase.
      'no-restricted-modules': ['error', {
        paths: [
          { name: 'pg', message: boundaryMessage },
          { name: '@supabase/supabase-js', message: boundaryMessage },
        ],
        patterns: databaseBoundaryPatterns,
      }],
    },
  },
  {
    files: scriptBoundaryFiles,
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          { group: scriptDbBoundaryPatterns, message: scriptBoundaryMessage },
        ],
      }],
      'no-restricted-modules': ['error', {
        patterns: scriptDbBoundaryPatterns,
      }],
    },
  },
];
