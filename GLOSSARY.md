# AI Usage Monitor

A web dashboard that reads AI provider usage and displays it as tiers,
percentages and reset times.

## Language

**Provider**:
A supported AI service whose usage the monitor reads (anthropic, claude, gemini,
ollama, openai, opencode, openrouter). Registered once in the provider registry.
_Avoid_: service, vendor, backend

**Credential**:
The per-provider secret used to call the provider API — an API key, a session
cookie or an OAuth token. Its format varies per provider.
_Avoid_: token, key, password

**Scraper**:
The provider-specific logic that turns a provider response into a `Result`.
_Avoid_: fetcher, adapter, client

**Result**:
The discriminated union a scraper returns: `UsageResult` (`status: 'ok'`) or
`ErrorResult` (`status: 'error'`).
_Avoid_: response, payload

**Tier**:
A usage limit inside a provider plan, with a name and a percentage (for example
"Standard 5h", "Extended 7d").
_Avoid_: quota, window, bucket

**Plan**:
The subscription plan a provider account is on.
_Avoid_: subscription, offer

**Meter**:
A rolling quota window of the OpenCode Go plan (5-hour, week and month), each
with a limit and a used amount.
_Avoid_: gauge, counter

**Refresh interval**:
How often the dashboard re-fetches provider usage, in minutes. Drives both the
frontend polling and the backend cache TTL.
_Avoid_: poll interval, TTL

**Overall percentage**:
The combined usage percentage across a provider's tiers.
_Avoid_: total, score
