# Security policy

## Reporting a vulnerability

Please do not open a public issue for security problems. Report them privately through
GitHub: **Security** tab → **Report a vulnerability**. I aim to reply within 7 days.

## Scope

This is a portfolio snapshot of a production system. It contains no live credentials, tenant IDs,
or customer data. All configuration is read from environment variables (see
`apps/api/.env.example`), and every identifier in mocks and fixtures is synthetic.

Secrets must never be committed. CI runs a secret scan on every push.
