# Dedicated search

Desktop fallback: when no search API key is configured, `web_search` uses the
visible browser to search Bing and retrieve source links. No API key is required
for this path. Consent and Stop remain in effect. Challenge/consent pages are
reported rather than bypassed. Restricted destinations remain blocked
at the navigation, session network and tool layers, including result filtering.
Configured API keys still use API search; API errors are not silently hidden.

For optional API discovery in the installed app, open Settings → Web search and
save your Brave Search API key. It uses OS-backed encrypted storage, separate from model credentials; new
tasks read it immediately. The app never sends saved keys back to the renderer.
An OS permission prompt may appear. Removing a saved key does not clear an
externally configured environment variable.

Alternatively, set `BRAVE_SEARCH_API_KEY` in the desktop main-process or trusted
widget-backend environment. Development loads local `.env`. Never put the key in
renderer code, widget scripts,
source control, or public installers. It is separate from the model API key.

When an API key is configured, `web_search` uses Brave's Web Search API. Both model providers can plan
and refine queries, then open returned URLs using the existing browser tools.
The keyless research path uses the same discovery interface, without claiming AI synthesis.
Search queries respect browsing consent; Stop cancels the active search.

Snippets are untrusted discovery data, not verified evidence. Research progress
counts actual source-page reads. Instructions require cross-checking primary
sources and citing URLs actually inspected. Never send private CRM data in queries.

Hosts without browser fallback report missing API configuration. Rejected keys,
quota limits, malformed API responses and timeouts produce explicit errors rather
than silently switching modes. Mocked tests do not verify
production credentials or quota; a live smoke test needs a configured Brave key.

## Prohibited destinations

Restricted destinations remain prohibited regardless of saved settings, earlier conversations,
search results or model instructions. The shared destination policy checks stable host
fingerprints, including subdomains, before agent actions
or page reads, and removes those URLs from discovery results. The desktop app
also cancels requests in every Electron session before transmission, including
redirects, popups, embedded frames and other page resources. Old prohibited
homepages and restored update tabs cannot reopen the service.

After a blocked desktop navigation, Go back restores the still-loaded allowed
page when one is available and refreshes its browsing indicator. A denied popup
records the attempted destination on its originating tab so the agent reports
the policy refusal. Same-document history and hash changes cannot clear that
refusal before explicit recovery or a new navigation. Embedded widgets refuse
activation of controls associated with a prohibited-action form, including
ordinary buttons: a page handler can submit the form programmatically. Checks
also cover the actual submitter's resolved destination. The embedded widget cannot inspect the browser's
history destinations, so its Back and Forward tools refuse unknown targets;
the agent must navigate to an explicit allowed URL instead.

Keep this restriction independent of Brave key availability. A blocked attempt
must never be reported as a successful open or read. Regression tests exercise
the real desktop network guard with prohibited hostnames mapped to a local
fixture, verify that no restricted request is sent, and verify recovery to an
allowed source. They never contact the prohibited service.

API documentation: https://api-dashboard.search.brave.com/app/documentation/web-search
