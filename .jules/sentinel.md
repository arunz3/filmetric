## 2024-05-18 - [Fix XSS in User Content]
**Vulnerability:** User-generated content (reviews, usernames, photo URLs, correction requests) was inserted into innerHTML without sanitization, leading to Stored XSS vulnerabilities.
**Learning:** Vanilla JavaScript applications using template literals for rendering HTML need explicit HTML escaping for all user inputs.
**Prevention:** Always use `escapeHtml()` when interpolating variables containing user input into HTML strings.
