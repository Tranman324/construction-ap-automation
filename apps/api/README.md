# Toolbox API

Backend API server for the NCG Toolbox platform. Serves the [Toolbox 3.0](../web) frontend.

## Architecture

```
toolbox-api/
├── server.js              ← Express entry point — mounts all module routes
├── config.js              ← Central config (paths, ports, env vars)
├── middleware/             ← Shared middleware (auth, rate limiting)
├── lib/                   ← Shared utilities (db pool, MS Graph client)
├── modules/
│   ├── invoices/          ← Invoice processing module
│   │   ├── routes/        ← API route handlers
│   │   ├── services/      ← Business logic (OCR, classification, Spectrum, etc.)
│   │   └── scripts/       ← Pipeline automation (email ingestion, cron jobs)
│   └── feature-requests/  ← Feature request board module
├── migrations/            ← Database migrations (Supabase/Postgres)
├── docs/                  ← Specs, architecture docs
├── tests/                 ← Test fixtures and runners
└── schema.sql             ← Database schema reference
```

## Modules

| Module | Routes | Description |
|--------|--------|-------------|
| **invoices** | `/api/invoices`, `/api/vendors`, `/api/jobs`, `/api/pipeline`, `/api/splits`, etc. | Invoice processing, classification, approval workflows, Spectrum ERP integration |
| **feature-requests** | `/api/feature-requests` | Internal feature request board with voting |
| **projects** | *(planned)* | Project management dashboard |
| **estimates** | *(planned)* | Leads and estimates tracking |

## Setup

```bash
cp .env.example .env
# Fill in real values — see .env.example for documentation
npm install
node server.js
```

## Database Migrations

Migration files live in `migrations/` and are run through the in-repo tracker:

```bash
npm run migrate -- list
npm run migrate -- apply --confirm-target
```

See `docs/MIGRATIONS.md` for production bootstrap, historical marking, and target-verification steps.

## Operations

Operational runbooks (restart, deploy verification, rollback) are kept in the private deployment repo.

## Auth

All routes (except `/api/health`) require authentication via one of:
1. **Internal proxy secret** — `x-internal-secret` header from the Next.js frontend proxy
2. **JWT Bearer token** — `Authorization: Bearer <token>` signed with `NEXTAUTH_SECRET`

See `middleware/auth.js` for details.

## Related

- **Frontend:** [Toolbox-3.0](../web) (Next.js, deployed on Vercel)
- **Database:** Supabase (PostgreSQL)
- **ERP:** Viewpoint Spectrum (REST API integration)
