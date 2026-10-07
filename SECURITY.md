# Security Policy

## Reporting a vulnerability

If you discover a security vulnerability, please open an issue on GitHub at
[github.com/openhoat/ai-usage-monitor/issues](https://github.com/openhoat/ai-usage-monitor/issues).

We will acknowledge receipt within 48 hours and work on a fix as soon as
possible.

## Credentials

This tool stores provider credentials (API keys, session cookies) in a local
config file (`~/.config/ai-usage-monitor/config.json`) or reads them from
environment variables. Never commit real credentials: the config file, `.env`
and `.secrets` are gitignored.
