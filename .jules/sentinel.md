## 2025-02-14 - Fix Cross-Site Scripting (XSS) Vulnerabilities in DOM Rendering
**Vulnerability:** Untrusted user input (usernames, reviews) and external API data (OMDb movie titles) were being interpolated directly into HTML template strings rendered via `innerHTML`.
**Learning:** Vanilla JS SPAs that use string template literals for rendering HTML components are highly susceptible to XSS if not explicitly sanitized. This was present across multiple components (navigation, screen details, movie suggestions, profile).
**Prevention:** Always use `escapeHtml()` when interpolating any external or user-provided data into HTML strings. For vanilla JS, maintain a utility function like `escapeHtml` that replaces `&`, `<`, `>`, `"`, and `'` with their HTML entities.
