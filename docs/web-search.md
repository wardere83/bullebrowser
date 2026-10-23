# Dedicated search

In the installed app, open Settings → Web search and save your Brave Search API
key. It uses OS-backed encrypted storage, separate from model credentials; new
tasks read it immediately. The app never sends saved keys back to the renderer.
An OS permission prompt may appear. Removing a saved key does not clear an
externally configured environment variable.

Alternatively, set `BRAVE_SEARCH_API_KEY` in the desktop main-process or trusted
widget-backend environment. Development loads local `.env`. Never put the key in
renderer code, widget scripts,
source control, or public installers. It is separate from the model API key.

The `web_search` tool uses Brave's Web Search API. Both model providers can plan
and refine queries, then open returned URLs using the existing browser tools.
The keyless research path also uses API discovery, without claiming AI synthesis.
Search queries respect browsing consent; Stop cancels the HTTP request.

Snippets are untrusted discovery data, not verified evidence. Research progress
counts actual source-page reads. Instructions require cross-checking primary
sources and citing URLs actually inspected. Never send private CRM data in queries.

Missing keys, rejected keys, quota limits, malformed responses and timeouts produce
explicit errors, not silent browser-search fallbacks. Mocked tests do not verify
production credentials or quota; a live smoke test needs a configured Brave key.

## Prohibited destinations

DuckDuckGo is prohibited, regardless of saved settings, earlier conversations,
search results or model instructions. The shared destination policy rejects
`duckduckgo.com`, `duck.com`, `ddg.gg` and their subdomains before agent actions
or page reads, and removes those URLs from discovery results. The desktop app
also cancels requests in every Electron session before transmission, including
redirects, popups, embedded frames and other page resources. Old prohibited
homepages and restored update tabs cannot reopen the service.

Keep this restriction independent of Brave key availability. A blocked attempt
must never be reported as a successful open or read. Regression tests exercise
the real desktop network guard with prohibited hostnames mapped to a local
fixture, verify that no restricted request is sent, and verify recovery to an
allowed source. They never contact the prohibited service.

API documentation: https://api-dashboard.search.brave.com/app/documentation/web-search
