# Filmetric

> Find the Best Screen for Every Movie.

Filmetric is a premium, data-driven single-page application (SPA) designed for cinema enthusiasts who care about projection quality, aspect ratios, and format matching. It helps users discover IMAX, Dolby Cinema, and Premium Large Format (PLF) screens, ranks them by distance, and matches movies to the ideal format.

---

## Features

1. **Format Recommendation Engine**:
   - Matches movie genres, runtimes, and cinematography details to the optimal format (e.g., *Oppenheimer* $\rightarrow$ **IMAX 1.43**, *Dune: Part Two* $\rightarrow$ **IMAX 1.90**, *Avatar* $\rightarrow$ **Dolby Cinema**).
   - Resolves movie metadata instantly using the **OMDb API**.

2. **Supabase Theatre Database Integration**:
   - Integrates live cinema screen listings across four primary schemas: `indian_imax`, `plfs`, `other_screens`, and `international_imax`.
   - Offers dynamic search, format filters, and page-by-page loading.

3. **Technical Specs & Data-First Design**:
   - Displays real auditoriums with exact measurements, projections, aspect ratios, and seating capacities.
   - Elegant, premium dark theme utilizing harmonized typography (DM Sans & JetBrains Mono) and minimal, structured visual hierarchies.

4. **Proximity Rankings ("Near Me")**:
   - Detects user geolocation to rank coordinating IMAX theatres using the **Haversine formula**.

5. **Rankings Dashboard**:
   - Sorts screens by confirmed physical screen area (width × height), seating capacity, and geography.

---

## Tech Stack

* **Frontend**: HTML5, Vanilla JavaScript, Vanilla CSS (Design System v2.0)
* **Backend Database**: Supabase (PostgreSQL REST API)
* **Metadata API**: OMDb API (IMDb index integration)
* **Routing**: Hash-based client-side SPA routing (`#/screens`, `#/movies`, `#/near-me`, `#/rankings`)

