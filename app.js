// Filmetric — Premium Cinema Discovery Platform
// Version 3.0 — Real Supabase + TMDB Data

document.addEventListener("DOMContentLoaded", () => {
  const appViewport = document.getElementById("app-viewport");

  // ── Global data stores ────────────────────────────────
  // Populated by loadAllData()
  window.DB = {
    indianImax: [],        // raw indian_imax rows
    plfs: [],              // raw plfs rows
    otherScreens: [],      // raw other_screens rows
    intlImax: [],          // raw international_imax rows
    allScreens: [],        // merged unified screen objects
  };

  // ── Supabase credentials (read from .env or localStorage) ─
  const SP_URL_KEY  = "filmetric_supabase_url";
  const SP_ANON_KEY = "filmetric_supabase_anon_key";
  const OMDB_KEY_LS = "filmetric_omdb_key";

  let spUrl     = "";
  let spAnonKey = "";
  let omdbKey   = "";
  let supabase  = null;

  // ── Format image picker ───────────────────────────────
  const FORMAT_IMAGES = {
    imax:     ["images/pvr_priya_imax.png", "images/forum_shantiniketan_imax.png", "images/pvr_superplex.png"],
    dolby:    ["images/pvr_maison_dolby.png", "images/pvr_directors_cut.png"],
    plf:      ["images/prasads_large_screen.png", "images/ariesplex_sl.png"],
    epiq:     ["images/ariesplex_sl.png", "images/pvr_superplex.png"],
    onyx:     ["images/luxe_phoenix_mall.png"],
    screenx:  ["images/luxe_phoenix_mall.png", "images/pvr_directors_cut.png"],
    other:    ["images/luxe_phoenix_mall.png", "images/ariesplex_sl.png", "images/pvr_directors_cut.png"],
  };

  function computeHash(str) {
    let h = 5381;
    for (let i = 0; i < str.length; i++) h = ((h << 5) + h) ^ str.charCodeAt(i);
    return Math.abs(h);
  }

  function pickImage(format, hash) {
    const f = (format || "").toUpperCase();
    let pool;
    if (f.includes("IMAX"))   pool = FORMAT_IMAGES.imax;
    else if (f.includes("DOLBY")) pool = FORMAT_IMAGES.dolby;
    else if (f.includes("EPIQ")) pool = FORMAT_IMAGES.epiq;
    else if (f.includes("ONYX")) pool = FORMAT_IMAGES.onyx;
    else if (f.includes("SCREENX") || f.includes("SCREEN X")) pool = FORMAT_IMAGES.screenx;
    else if (f.includes("PLF") || f.includes("PXL") || f.includes("PCX")) pool = FORMAT_IMAGES.plf;
    else pool = FORMAT_IMAGES.other;
    return pool[hash % pool.length];
  }

  // ── Unified screen model builders ─────────────────────
  function fromIndianImax(r) {
    const hash = computeHash((r.location || "") + (r.city || "") + String(r.id));
    const widthFt  = parseFloat(r.width_ft)  || null;
    const heightFt = parseFloat(r.height_ft) || null;
    const area = (widthFt && heightFt) ? Math.round(widthFt * heightFt) : null;
    return {
      _table:      "indian_imax",
      id:          `ii-${r.id}`,
      name:        r.location,
      city:        r.city,
      state:       null,
      country:     "India",
      format:      "IMAX",
      projection:  r.projection,
      aspectRatio: (r.aspect_ratio || "").replace(" Ratio", "").trim(),
      widthFt,
      heightFt,
      area,
      seats:       r.seats || null,
      status:      r.status || "Open",
      lat:         r.lat  || null,
      lon:         r.long || null,
      image:       pickImage("IMAX", hash),
    };
  }

  function fromPlf(r) {
    const hash = computeHash((r.theatre || "") + (r.city || "") + String(r.id));
    return {
      _table:      "plfs",
      id:          `plf-${r.id}`,
      name:        r.theatre,
      city:        r.city,
      state:       null,
      country:     "India",
      format:      "PLF",
      projection:  null,
      aspectRatio: null,
      widthFt:     null,
      heightFt:    null,
      area:        null,
      seats:       null,
      status:      "Open",
      lat:         r.lat  || null,
      lon:         r.long || null,
      remarks:     r.remarks || null,
      image:       pickImage("PLF", hash),
    };
  }

  function fromOtherScreen(r) {
    const hash = computeHash((r.theatre_name || "") + (r.city || "") + String(r.id));
    const tech = (r.technology || "").toUpperCase();
    let format = r.technology || "Large Screen";
    if (tech.includes("DOLBY")) format = "Dolby Cinema";
    else if (tech.includes("EPIQ"))   format = "EPIQ";
    else if (tech.includes("ONYX"))   format = "Samsung Onyx";
    else if (tech.includes("SCREENX") || tech.includes("SCREEN X")) format = "ScreenX";
    else if (tech.includes("HDR"))    format = "HDR by Barco";

    // Parse width from width_height field e.g. "98.6ft"
    let widthFt = null;
    if (r.width_height) {
      const m = String(r.width_height).match(/[\d.]+/);
      if (m) widthFt = parseFloat(m[0]);
    }

    return {
      _table:      "other_screens",
      id:          `os-${r.id}`,
      name:        r.theatre_name,
      city:        r.city,
      state:       null,
      country:     "India",
      format,
      projection:  r.projection,
      aspectRatio: r.aspect_ratio || null,
      widthFt,
      heightFt:    null,
      area:        null,
      seats:       r.seats || null,
      status:      r.status || "Open",
      lat:         r.lat  || null,
      lon:         r.long || null,
      audio:       r.audio || null,
      image:       pickImage(format, hash),
    };
  }

  function fromIntlImax(r) {
    const hash = computeHash((r.cinema_name || "") + (r.location || "") + String(r.id));
    let widthFt = null, heightFt = null, area = null;
    if (r.screen_size) {
      const m = String(r.screen_size).match(/([\d.]+)\s*[x×]\s*([\d.]+)/i);
      if (m) { widthFt = parseFloat(m[1]); heightFt = parseFloat(m[2]); area = Math.round(widthFt * heightFt); }
    }
    return {
      _table:      "international_imax",
      id:          `int-${r.id}`,
      name:        r.cinema_name,
      city:        r.location,
      state:       null,
      country:     r.country,
      format:      "IMAX",
      projection:  r.projection,
      aspectRatio: r.is_1_43_dual_laser_asia ? "1.43:1" : null,
      widthFt,
      heightFt,
      area,
      seats:       r.seats || null,
      status:      "Open",
      lat:         null,
      lon:         null,
      screenSize:  r.screen_size || null,
      image:       pickImage("IMAX", hash),
    };
  }

  // ── Supabase fetcher ───────────────────────────────────
  async function sbFetch(table, select = "*") {
    const res = await fetch(`${spUrl}/rest/v1/${table}?select=${encodeURIComponent(select)}`, {
      headers: { "apikey": spAnonKey, "Authorization": `Bearer ${spAnonKey}` }
    });
    if (!res.ok) throw new Error(`${table}: ${res.status} ${await res.text()}`);
    return res.json();
  }

  // ── Load all data ──────────────────────────────────────
  async function loadAllData() {
    // Read credentials from .env or localStorage
    try {
      const r = await fetch("/.env");
      if (r.ok) {
        const txt = await r.text();
        for (const line of txt.split("\n")) {
          const clean = line.trim();
          if (clean.startsWith("#") || !clean.includes("=")) continue;
          const [k, ...vp] = clean.split("=");
          const v = vp.join("=").trim();
          if (k.trim() === "SUPABASE_URL") spUrl = v;
          else if (k.trim() === "SUPABASE_ANON_KEY") spAnonKey = v;
          else if (k.trim() === "OMDB_API_KEY") omdbKey = v;
        }
      }
    } catch (_) {}

    // Fallback to localStorage
    if (!spUrl)     spUrl     = localStorage.getItem(SP_URL_KEY) || "";
    if (!spAnonKey) spAnonKey = localStorage.getItem(SP_ANON_KEY) || "";
    if (!omdbKey)   omdbKey   = localStorage.getItem(OMDB_KEY_LS) || "";

    // Load from local config.js if present
    if (window.FILMETRIC_CONFIG) {
      if (!spUrl)     spUrl     = window.FILMETRIC_CONFIG.SUPABASE_URL || "";
      if (!spAnonKey) spAnonKey = window.FILMETRIC_CONFIG.SUPABASE_ANON_KEY || "";
      if (!omdbKey)   omdbKey   = window.FILMETRIC_CONFIG.OMDB_API_KEY || "";
    }

    // Init Supabase client for auth
    if (spUrl && spAnonKey && window.supabase) {
      try { supabase = window.supabase.createClient(spUrl, spAnonKey); } catch (_) {}
    }

    if (!spUrl || !spAnonKey) {
      console.warn("Filmetric: No Supabase credentials. Showing empty state.");
      return;
    }

    try {
      const [ii, plf, os, intl] = await Promise.all([
        sbFetch("indian_imax"),
        sbFetch("plfs"),
        sbFetch("other_screens"),
        sbFetch("international_imax"),
      ]);

      window.DB.indianImax   = ii   || [];
      window.DB.plfs         = plf  || [];
      window.DB.otherScreens = os   || [];
      window.DB.intlImax     = intl || [];

      // Log: table counts
      console.log("indian_imax count:", ii ? ii.length : 0);
      console.log("plfs count:", plf ? plf.length : 0);
      console.log("other_screens count:", os ? os.length : 0);
      console.log("international_imax count:", intl ? intl.length : 0);

      // Build unified allScreens (India only, for main browse)
      const mapped = [
        ...ii.map(r  => fromIndianImax(r)),
        ...plf.map(r => fromPlf(r)),
        ...os.map(r  => fromOtherScreen(r)),
      ];
      window.DB.allScreens = mapped;

      // Log: allScreens.length
      console.log("allScreens.length:", mapped.length);

      // Output all unique format values
      console.log("Unique formats:", new Set(mapped.map(s => s.format)));

      console.log(`Filmetric: Loaded ${ii.length} Indian IMAX + ${plf.length} PLFs + ${os.length} other screens + ${intl.length} international IMAX.`);
    } catch (e) {
      console.error("Filmetric: Data load failed —", e.message);
    }
  }

  // ── Auth Layer & Context ────────────────────────────────
  let currentUser = null;
  let authCallbacks = [];

  // Global Auth object configuration
  window.Auth = {
    user: null,
    profile: null,
    loading: true,
    signIn: authSignIn,
    signUp: authSignUp,
    signInWithGoogle: authSignInWithGoogle,
    signOut: authSignOut
  };

  async function getOrCreateProfile(user) {
    if (!supabase) {
      const mockProfiles = JSON.parse(localStorage.getItem("filmetric_mock_profiles") || "{}");
      if (mockProfiles[user.id]) {
        return mockProfiles[user.id];
      }
      const newProfile = {
        id: user.id,
        username: user.username || user.user_metadata?.username || user.email.split("@")[0],
        avatar_url: user.avatarUrl || "",
        role: "user",
        created_at: new Date().toISOString()
      };
      mockProfiles[user.id] = newProfile;
      localStorage.setItem("filmetric_mock_profiles", JSON.stringify(mockProfiles));
      return newProfile;
    }

    try {
      const { data: profile, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .maybeSingle();

      if (profile) return profile;

      let username = user.user_metadata?.full_name || user.user_metadata?.name || user.user_metadata?.username;
      if (!username) {
        username = user.email.split("@")[0];
      }
      const avatarUrl = user.user_metadata?.avatar_url || "";
      
      const newProfile = {
        id: user.id,
        username: username,
        avatar_url: avatarUrl,
        role: 'user',
        created_at: new Date().toISOString()
      };

      const { data: inserted, error: insertError } = await supabase
        .from('profiles')
        .insert(newProfile)
        .select()
        .maybeSingle();

      if (insertError) {
        console.error("Profile creation error:", insertError);
        return newProfile;
      }
      return inserted || newProfile;
    } catch (err) {
      console.error("Profile handler exception:", err);
      return {
        id: user.id,
        username: user.email.split("@")[0],
        avatar_url: "",
        role: "user",
        created_at: new Date().toISOString()
      };
    }
  }

  async function initAuth() {
    window.Auth.loading = true;
    if (supabase) {
      const { data: { session } } = await supabase.auth.getSession();
      await handleAuthSession(session);
      supabase.auth.onAuthStateChange(async (_e, session) => {
        await handleAuthSession(session);
      });
    } else {
      const saved = localStorage.getItem("filmetric_session");
      await handleAuthSession(saved ? JSON.parse(saved) : null);
    }
  }

  async function handleAuthSession(session) {
    window.Auth.loading = true;
    if (session) {
      const u = session.user;
      const profile = await getOrCreateProfile(u);
      window.Auth.user = u;
      window.Auth.profile = profile;
      currentUser = {
        id: u.id,
        email: u.email,
        jwt: session.access_token || "",
        username: profile.username,
        avatarUrl: profile.avatar_url,
        role: profile.role || 'user',
        joinDate: profile.created_at
          ? new Date(profile.created_at).toLocaleDateString("en-US", { month: "long", year: "numeric" })
          : "2025",
      };
    } else {
      window.Auth.user = null;
      window.Auth.profile = null;
      currentUser = null;
      localStorage.removeItem("filmetric_session");
    }
    window.Auth.loading = false;
    authCallbacks.forEach(cb => cb(currentUser));
  }

  async function authSignUp(email, password, username) {
    if (supabase) {
      const { data, error } = await supabase.auth.signUp({ email, password, options: { data: { username } } });
      if (error) throw error;
      return data;
    }
    const users = JSON.parse(localStorage.getItem("filmetric_users") || "[]");
    if (users.find(u => u.email === email)) throw new Error("Email already registered");
    const user = { id: `mock-${Date.now()}`, email, username, created_at: new Date().toISOString() };
    users.push({ ...user, password });
    localStorage.setItem("filmetric_users", JSON.stringify(users));
    const session = { access_token: "mock-token", user };
    await handleAuthSession(session);
    localStorage.setItem("filmetric_session", JSON.stringify(session));
    return session;
  }

  async function authSignIn(email, password) {
    if (supabase) {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      return data;
    }
    const users = JSON.parse(localStorage.getItem("filmetric_users") || "[]");
    const user = users.find(u => u.email === email && u.password === password);
    if (!user) throw new Error("Invalid email or password");
    const session = { access_token: "mock-token", user };
    await handleAuthSession(session);
    localStorage.setItem("filmetric_session", JSON.stringify(session));
    return session;
  }

  async function authSignInWithGoogle() {
    if (supabase) {
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: window.location.origin + window.location.pathname
        }
      });
      if (error) throw error;
      return data;
    } else {
      const mockUser = {
        id: `google-mock-${Date.now()}`,
        email: "googleuser@example.com",
        user_metadata: {
          full_name: "Google Explorer",
          avatar_url: "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=80&h=80&q=80"
        }
      };
      const session = { access_token: "mock-google-token", user: mockUser };
      await handleAuthSession(session);
      localStorage.setItem("filmetric_session", JSON.stringify(session));
      return session;
    }
  }

  async function authSignOut() {
    if (supabase) await supabase.auth.signOut();
    await handleAuthSession(null);
  }

  function onAuthStateChange(cb) {
    authCallbacks.push(cb);
    cb(currentUser);
    return () => { authCallbacks = authCallbacks.filter(c => c !== cb); };
  }

  // ── Database Operations & Community Helpers ─────────────
  async function fetchTheatreReviews(theatreId) {
    if (supabase) {
      const { data, error } = await supabase
        .from('theatre_ratings')
        .select('*, profiles(username, avatar_url)')
        .eq('theatre_id', theatreId);
      if (error) {
        console.error("Error fetching reviews:", error);
        return [];
      }
      return data || [];
    } else {
      const allRatings = JSON.parse(localStorage.getItem("filmetric_theatre_ratings") || "[]");
      const filtered = allRatings.filter(r => r.theatre_id === theatreId);
      const profiles = JSON.parse(localStorage.getItem("filmetric_mock_profiles") || "{}");
      return filtered.map(r => ({
        ...r,
        profiles: profiles[r.user_id] || { username: "Mock User", avatar_url: "" }
      }));
    }
  }

  async function fetchTheatrePhotos(theatreId) {
    if (supabase) {
      const { data, error } = await supabase
        .from('theatre_photos')
        .select('*')
        .eq('theatre_id', theatreId)
        .eq('approved', true);
      if (error) {
        console.error("Error fetching photos:", error);
        return [];
      }
      return data || [];
    } else {
      const all = JSON.parse(localStorage.getItem("filmetric_theatre_photos") || "[]");
      return all.filter(p => p.theatre_id === theatreId && p.approved === true);
    }
  }

  async function addOrUpdateReview(theatreId, rating, reviewText) {
    if (!currentUser) throw new Error("Authentication required");

    const reviewData = {
      user_id: currentUser.id,
      theatre_id: theatreId,
      rating: parseInt(rating),
      review: reviewText,
      created_at: new Date().toISOString()
    };

    if (supabase) {
      const { data: existing } = await supabase
        .from('theatre_ratings')
        .select('id')
        .eq('theatre_id', theatreId)
        .eq('user_id', currentUser.id)
        .maybeSingle();

      if (existing) {
        const { error } = await supabase
          .from('theatre_ratings')
          .update({ rating: reviewData.rating, review: reviewData.review })
          .eq('id', existing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('theatre_ratings')
          .insert({
            id: crypto.randomUUID ? crypto.randomUUID() : `r-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            ...reviewData
          });
        if (error) throw error;
      }
    } else {
      const allRatings = JSON.parse(localStorage.getItem("filmetric_theatre_ratings") || "[]");
      const idx = allRatings.findIndex(r => r.theatre_id === theatreId && r.user_id === currentUser.id);
      if (idx !== -1) {
        allRatings[idx].rating = reviewData.rating;
        allRatings[idx].review = reviewData.review;
      } else {
        allRatings.push({
          id: `mock-r-${Date.now()}`,
          ...reviewData
        });
      }
      localStorage.setItem("filmetric_theatre_ratings", JSON.stringify(allRatings));
    }
  }

  async function deleteReview(reviewId, theatreId) {
    if (!currentUser) throw new Error("Authentication required");

    if (supabase) {
      const { error } = await supabase
        .from('theatre_ratings')
        .delete()
        .eq('id', reviewId);
      if (error) throw error;
    } else {
      let allRatings = JSON.parse(localStorage.getItem("filmetric_theatre_ratings") || "[]");
      allRatings = allRatings.filter(r => r.id !== reviewId);
      localStorage.setItem("filmetric_theatre_ratings", JSON.stringify(allRatings));
    }
  }

  // ── Utilities ──────────────────────────────────────────
  function escapeHtml(str) {
    if (!str) return "";
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }
  function setMeta({ title, description, canonicalPath, schema }) {
    document.title = title || "Filmetric — Find the Best Screen for Every Movie";
    
    const descEl = document.getElementById("meta-desc");
    if (descEl) descEl.setAttribute("content", description || "");

    const ogTitle = document.getElementById("og-title");
    if (ogTitle) ogTitle.setAttribute("content", title || "");

    const ogDesc = document.getElementById("og-desc");
    if (ogDesc) ogDesc.setAttribute("content", description || "");

    const ogUrl = document.getElementById("og-url");
    if (ogUrl) ogUrl.setAttribute("content", `https://filmetric.com/${canonicalPath || ""}`);

    const twTitle = document.getElementById("tw-title");
    if (twTitle) twTitle.setAttribute("content", title || "");

    const twDesc = document.getElementById("tw-desc");
    if (twDesc) twDesc.setAttribute("content", description || "");

    const canonLink = document.getElementById("canonical-link");
    if (canonLink) canonLink.setAttribute("href", `https://filmetric.com/${canonicalPath || ""}`);

    // Clean up old JSON-LD script tags
    document.querySelectorAll('script[type="application/ld+json"]').forEach(s => s.remove());

    // Inject dynamic schemas (WebSite and Organization default, custom route-specific schema if provided)
    const baseSchemas = [
      {
        "@context": "https://schema.org",
        "@type": "WebSite",
        "name": "Filmetric",
        "url": "https://filmetric.com/"
      },
      {
        "@context": "https://schema.org",
        "@type": "Organization",
        "name": "Filmetric",
        "url": "https://filmetric.com/",
        "logo": "https://filmetric.com/logo.png"
      }
    ];

    if (schema) {
      if (Array.isArray(schema)) {
        baseSchemas.push(...schema);
      } else {
        baseSchemas.push(schema);
      }
    }

    baseSchemas.forEach(sObj => {
      const script = document.createElement("script");
      script.type = "application/ld+json";
      script.text = JSON.stringify(sObj);
      document.head.appendChild(script);
    });
  }

  function navigate(url) {
    window.history.pushState({}, "", url);
    resolveRoute();
  }

  function haversine(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  function showToast(msg, duration = 3000) {
    let container = document.querySelector(".toast-container");
    if (!container) {
      container = document.createElement("div");
      container.className = "toast-container";
      document.body.appendChild(container);
    }
    const toast = document.createElement("div");
    toast.className = "toast";
    toast.textContent = msg;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), duration);
  }

  let userCoords = null;
  let screensSearchQuery = "";
  let screensFormatFilter = "";
  let screensPage = 1;
  const SCREENS_PER_PAGE = 18;
  let selectedMovie = null;

  // ── OMDb API ─────────────────────────────────────────
  const OMDB_BASE = "https://www.omdbapi.com/";

  async function omdbSearch(query) {
    if (!omdbKey) throw new Error("No OMDb API key. Add it in Settings.");
    const r = await fetch(`${OMDB_BASE}?s=${encodeURIComponent(query)}&type=movie&apikey=${omdbKey}`);
    if (!r.ok) throw new Error("OMDb search failed");
    const d = await r.json();
    if (d.Response === "False") return [];
    return (d.Search || []).slice(0, 6);
  }

  async function omdbDetail(id) {
    if (!omdbKey) throw new Error("No OMDb API key.");
    const r = await fetch(`${OMDB_BASE}?i=${id}&plot=full&apikey=${omdbKey}`);
    if (!r.ok) throw new Error("OMDb movie detail failed");
    const d = await r.json();
    if (d.Response === "False") throw new Error(d.Error || "Movie details not found");
    return d;
  }

  // Format recommendation engine (based on title, genres)
  function recommendFormat(movie) {
    const title = (movie.Title || "").toLowerCase();
    const genres = (movie.Genre || "").toLowerCase();

    // Oppenheimer → IMAX 1.43
    if (title.includes("oppenheimer")) {
      return {
        format: "IMAX 1.43",
        reason: "Shot on 15/70mm IMAX film, presenting the full 1.43:1 aspect ratio on compatible dual-laser and film screens."
      };
    }
    // Dune Part Two → IMAX 1.90
    if (title.includes("dune") && (title.includes("two") || title.includes("2"))) {
      return {
        format: "IMAX 1.90",
        reason: "Captured specifically for IMAX, utilizing the digital 1.90:1 aspect ratio to fill the height of digital IMAX screens."
      };
    }
    // Avatar → Dolby Cinema
    if (title.includes("avatar")) {
      return {
        format: "Dolby Cinema",
        reason: "Benefits immensely from Dolby Vision's high dynamic range, peak brightness, and deep Dolby Atmos object-based sound."
      };
    }
    // Animation → Dolby Cinema
    if (genres.includes("animation")) {
      return {
        format: "Dolby Cinema",
        reason: "Vibrant animated color palettes and multi-channel sound design shine best with Dolby Vision projection and Dolby Atmos audio."
      };
    }
    // Action / Sci-Fi → IMAX
    if (genres.includes("action") || genres.includes("sci-fi") || genres.includes("science fiction")) {
      return {
        format: "IMAX",
        reason: "High-octane action sequences and visual-effects-heavy titles thrive on the scale and high-impact sound design of IMAX screens."
      };
    }
    // Drama → Dolby Cinema
    if (genres.includes("drama") || genres.includes("thriller")) {
      return {
        format: "Dolby Cinema",
        reason: "Dolby Vision provides superior contrast and shadow detail, perfect for the emotional weight and dark scenes of dramas and thrillers."
      };
    }
    // Default fallback
    return {
      format: "Dolby Cinema",
      reason: "Dolby Cinema offers the most balanced and premium presentation with high-contrast dual laser and object-based sound."
    };
  }

  // Get matching screens based on recommendation format
  function getMatchingScreens(format) {
    const screens = window.DB.allScreens || [];
    const fmt = (format || "").toUpperCase();
    
    if (fmt.includes("1.43")) {
      // Find Gujarat Science City or IMAX screens with 1.43 capability
      const imax = screens.filter(s => s.format === "IMAX");
      const exact = imax.filter(s => s.aspectRatio === "1.43:1" || (s.projection || "").includes("15/70") || (s.projection || "").includes("GT"));
      const rest = imax.filter(s => !exact.includes(s));
      return [...exact, ...rest].slice(0, 5);
    } else if (fmt.includes("1.90") || fmt === "IMAX") {
      // Return standard IMAX screens
      return screens.filter(s => s.format === "IMAX").slice(0, 5);
    } else if (fmt.includes("DOLBY")) {
      // Return Dolby screens
      return screens.filter(s => (s.format || "").toUpperCase().includes("DOLBY")).slice(0, 5);
    } else {
      // Return PLFs and other screens
      return screens.filter(s => s.format === "PLF" || s.format === "EPIQ").slice(0, 5);
    }
  }

  // ── Layout ────────────────────────────────────────────
  function getHeaderHtml(active = "") {
    const nav = [
      { href: "#/screens",  label: "Screens",  key: "screens"  },
      { href: "#/movies",   label: "Movies",   key: "movies"   },
      { href: "#/near-me",  label: "Near Me",  key: "nearme"   },
      { href: "#/rankings", label: "Rankings", key: "rankings" },
    ];

    const navLinks = nav.map(n =>
      `<a href="${n.href}" class="nav-link${active === n.key ? " active" : ""}">${n.label}</a>`
    ).join("");

    const mobileNavLinks = nav.map(n =>
      `<a href="${n.href}" class="mobile-nav-link">${n.label}</a>`
    ).join("");

    let userWidget = "";
    if (currentUser) {
      const initials = (currentUser.username || "?").substring(0, 2).toUpperCase();
      const avatar = currentUser.avatarUrl
        ? `<img src="${currentUser.avatarUrl}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">`
        : initials;
      userWidget = `
        <div class="user-menu-wrap" id="user-menu-wrap">
          <button class="user-menu-trigger" id="user-menu-trigger">
            <div class="user-avatar-sm">${avatar}</div>
            <span class="desktop-only" style="margin-left:0;">${currentUser.username}</span>
          </button>
          <div class="user-dropdown" id="user-dropdown">
            <a href="#/profile">Profile</a>
            <a href="#/profile?tab=reviews">My Reviews</a>
            <a href="#/profile?tab=contributions">My Contributions</a>
            <button id="signout-btn">Logout</button>
          </div>
        </div>`;
    } else {
      userWidget = `<button class="btn btn-ghost btn-sm auth-trigger-btn" id="header-login-btn">Login</button>`;
    }

    return `
      <header class="site-header">
        <div class="container header-inner">
          <a href="#/" class="header-brand">Filmetric</a>
          <nav class="header-nav desktop-only">${navLinks}</nav>
          <div class="header-actions">
            <button class="icon-btn search-trigger-btn" id="search-trigger" aria-label="Search" title="Search screens">
              <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
              </svg>
            </button>
            ${userWidget}
            <button class="icon-btn hamburger-btn" id="hamburger-btn" aria-label="Menu">
              <svg width="18" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 18 14">
                <path d="M0 1h18M0 7h18M0 13h18"/>
              </svg>
            </button>
          </div>
        </div>
      </header>

      <div class="mobile-backdrop" id="mobile-backdrop">
        <div class="mobile-panel">
          <div class="mobile-panel-head">
            <span class="header-brand">Filmetric</span>
            <button class="icon-btn" id="mobile-close">
              <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                <path d="M18 6 6 18M6 6l12 12"/>
              </svg>
            </button>
          </div>
          ${mobileNavLinks}
          <div class="mobile-auth-section">
            ${currentUser
              ? `<a href="#/profile" class="mobile-nav-link">Profile</a>
                 <a href="#/profile?tab=reviews" class="mobile-nav-link">My Reviews</a>
                 <a href="#/profile?tab=contributions" class="mobile-nav-link">My Contributions</a>
                 <button class="btn btn-ghost btn-full mt-2 auth-trigger-signout">Logout</button>`
              : `<button class="btn btn-primary btn-full auth-trigger-btn">Login</button>`
            }
          </div>
        </div>
      </div>

      <div class="search-overlay" id="search-overlay">
        <div class="search-overlay-inner">
          <form id="search-form" style="display:contents;">
            <input type="text" id="search-input" placeholder="Search screens by name, city, format..." autocomplete="off">
            <button type="submit" class="btn btn-primary btn-sm">Search</button>
          </form>
          <button class="icon-btn" id="search-close">
            <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <path d="M18 6 6 18M6 6l12 12"/>
            </svg>
          </button>
        </div>
      </div>`;
  }

  function getFooterHtml() {
    const totalScreens = window.DB.allScreens.length + window.DB.intlImax.length;
    return `
      <footer class="site-footer">
        <div class="container">
          <div class="footer-inner">
            <div>
              <div class="footer-brand">Filmetric</div>
              <div class="footer-tagline">Find the best screen<br>for every movie.</div>
            </div>
            <div>
              <div class="footer-col-title">Discover</div>
              <div class="footer-links">
                <a href="#/screens" class="footer-link">Browse Screens</a>
                <a href="#/near-me" class="footer-link">Near Me</a>
                <a href="#/movies" class="footer-link">Movie Formats</a>
                <a href="#/rankings" class="footer-link">Rankings</a>
              </div>
            </div>
            <div>
              <div class="footer-col-title">Company</div>
              <div class="footer-links">
                <a href="#/about" class="footer-link">About</a>
                <a href="#/privacy" class="footer-link">Privacy Policy</a>
                <a href="#/terms" class="footer-link">Terms of Service</a>
                <a href="mailto:contact@filmetric.com" class="footer-link">Contact</a>
              </div>
            </div>
          </div>
          <div class="footer-bottom">
            <span class="footer-copy">&copy; 2025 Filmetric. All rights reserved.</span>
            ${totalScreens > 0 ? `<span class="footer-copy">${totalScreens} screens in database.</span>` : ""}
          </div>
        </div>
      </footer>`;
  }

  function renderLayout(mainHtml, activeNav = "") {
    appViewport.innerHTML = getHeaderHtml(activeNav) + `<main>${mainHtml}</main>` + getFooterHtml();
    attachLayoutListeners();
  }

  function attachLayoutListeners() {
    const burger    = document.getElementById("hamburger-btn");
    const backdrop  = document.getElementById("mobile-backdrop");
    const mClose    = document.getElementById("mobile-close");

    if (burger   && backdrop) burger.addEventListener("click", () => backdrop.classList.add("open"));
    if (mClose   && backdrop) mClose.addEventListener("click", () => backdrop.classList.remove("open"));
    if (backdrop) backdrop.addEventListener("click", e => { if (e.target === backdrop) backdrop.classList.remove("open"); });

    const searchTrigger = document.getElementById("search-trigger");
    const searchOverlay = document.getElementById("search-overlay");
    const searchClose   = document.getElementById("search-close");
    const searchForm    = document.getElementById("search-form");
    const searchInput   = document.getElementById("search-input");

    if (searchTrigger && searchOverlay) searchTrigger.addEventListener("click", () => { searchOverlay.classList.add("open"); searchInput?.focus(); });
    if (searchClose   && searchOverlay) searchClose.addEventListener("click", () => searchOverlay.classList.remove("open"));
    if (searchForm && searchInput) {
      searchForm.addEventListener("submit", e => {
        e.preventDefault();
        const q = searchInput.value.trim();
        if (q) { searchOverlay.classList.remove("open"); screensSearchQuery = q; navigate(`#/screens?q=${encodeURIComponent(q)}`); }
      });
    }

    const userWrap    = document.getElementById("user-menu-wrap");
    const userTrigger = document.getElementById("user-menu-trigger");
    if (userTrigger && userWrap) {
      userTrigger.addEventListener("click", e => { e.stopPropagation(); userWrap.classList.toggle("open"); });
      document.addEventListener("click", e => { if (userWrap && !userWrap.contains(e.target)) userWrap.classList.remove("open"); });
    }

    document.querySelectorAll(".auth-trigger-btn").forEach(btn => {
      btn.addEventListener("click", () => { if (backdrop) backdrop.classList.remove("open"); showAuthModal(); });
    });
    document.querySelectorAll(".auth-trigger-signout").forEach(btn => {
      btn.addEventListener("click", () => { if (backdrop) backdrop.classList.remove("open"); showSignOutModal(); });
    });

    const signoutBtn = document.getElementById("signout-btn");
    if (signoutBtn) signoutBtn.addEventListener("click", showSignOutModal);

    if (backdrop) {
      backdrop.querySelectorAll(".mobile-nav-link").forEach(link => {
        link.addEventListener("click", () => backdrop.classList.remove("open"));
      });
    }
  }

  // ── Router ────────────────────────────────────────────
  function initRouter() {
    document.addEventListener("click", e => {
      const a = e.target.closest("a");
      if (a) {
        const href = a.getAttribute("href");
        if (href && (href.startsWith("#") || href.startsWith("/")) &&
            !a.hasAttribute("download") && a.target !== "_blank") {
          e.preventDefault();
          navigate(href);
        }
      }
    });
    window.addEventListener("popstate", resolveRoute);
    onAuthStateChange(() => resolveRoute());
  }

  function resolveRoute() {
    window.scrollTo(0, 0);
    const hash = window.location.hash || "#/";
    let routePath = hash;
    let qp = new URLSearchParams();
    const qi = hash.indexOf("?");
    if (qi !== -1) { routePath = hash.substring(0, qi); qp = new URLSearchParams(hash.substring(qi)); }

    if (routePath === "#/" || routePath === "#" || routePath === "#/home") {
      renderHomeView();
    } else if (routePath === "#/screens" || routePath === "#/search") {
      const q = qp.get("q");
      if (q) screensSearchQuery = q;
      renderScreensView();
    } else if (routePath.startsWith("#/screen/")) {
      renderDetailView(routePath.substring(9));
    } else if (routePath === "#/near-me") {
      renderNearMeView();
    } else if (routePath === "#/movies" || routePath === "#/find-screen") {
      renderMoviesView();
    } else if (routePath === "#/rankings") {
      renderRankingsView();
    } else if (routePath.startsWith("#/profile")) {
      renderProfileView();
    } else if (routePath === "#/settings") {
      renderSettingsView();
    } else if (routePath === "#/about") {
      renderAboutView();
    } else if (routePath === "#/privacy") {
      renderPrivacyView();
    } else if (routePath === "#/terms") {
      renderTermsView();
    } else {
      renderHomeView();
    }
  }

  // ── Shared components ─────────────────────────────────
  function screenCardHtml(s) {
    const loc = [s.city, s.country !== "India" ? s.country : null].filter(Boolean).join(", ");
    
    // Format badge specific styling class
    const fClass = (s.format || "").toLowerCase().replace(/\s+/g, "-");
    
    // Compute display size string
    let sizeStr = "—";
    if (s.widthFt && s.heightFt) {
      sizeStr = `${s.widthFt} × ${s.heightFt} ft`;
    } else if (s.widthFt) {
      sizeStr = `${s.widthFt} ft wide`;
    } else if (s.screenSize) {
      sizeStr = s.screenSize;
    }

    return `
      <a href="#/screen/${s.id}" class="screen-card data-card">
        <div class="screen-card-format-banner format-${fClass}">
          <span class="format-badge-text">${s.format}</span>
        </div>
        <div class="screen-card-body">
          <div class="screen-card-name">${s.name}</div>
          <div class="screen-card-location">${loc}</div>
          
          <div class="screen-card-specs-grid">
            <div class="spec-item spec-format">
              <span class="spec-label">Format</span>
              <span class="spec-val">${s.format}</span>
            </div>
            <div class="spec-item spec-projection">
              <span class="spec-label">Projection</span>
              <span class="spec-val" title="${s.projection || "—"}">${s.projection || "—"}</span>
            </div>
            <div class="spec-item spec-aspect">
              <span class="spec-label">Aspect Ratio</span>
              <span class="spec-val">${s.aspectRatio || "—"}</span>
            </div>
            <div class="spec-item spec-dimensions">
              <span class="spec-label">Dimensions</span>
              <span class="spec-val">${sizeStr}</span>
            </div>
            <div class="spec-item spec-capacity">
              <span class="spec-label">Capacity</span>
              <span class="spec-val">${s.seats ? `${s.seats} seats` : "—"}</span>
            </div>
          </div>
        </div>
      </a>`;
  }

  function skeletonCardsHtml(n = 6) {
    return Array.from({ length: n }, () => `
      <div class="screen-card skeleton-card">
        <div class="skeleton-img"></div>
        <div class="screen-card-body">
          <div class="skeleton skeleton-line" style="width:40%;height:10px;"></div>
          <div class="skeleton skeleton-line" style="width:75%;height:14px;margin-top:0.5rem;"></div>
          <div class="skeleton skeleton-line" style="width:55%;height:11px;"></div>
        </div>
      </div>`).join("");
  }

  function noDataHtml(msg = "No Supabase credentials configured.") {
    return `
      <div style="text-align:center;padding:4rem 2rem;">
        <div style="font-size:0.875rem;color:var(--text-2);margin-bottom:0.75rem;">${msg}</div>
        <a href="#/settings" class="btn btn-ghost btn-sm">Configure in Settings</a>
      </div>`;
  }

  // ── HOME VIEW ─────────────────────────────────────────
  function renderHomeView() {
    setMeta({
      title: "Filmetric — Find the Best Screen for Every Movie",
      description: "Discover premium cinema screens. Compare IMAX, Dolby Cinema, and large format screens.",
      canonicalPath: ""
    });
    const screens = window.DB.allScreens;
    // Priority: Indian IMAX first, then PLF, then other
    const imax  = screens.filter(s => s._table === "indian_imax");
    const plf   = screens.filter(s => s._table === "plfs");
    const other = screens.filter(s => s._table === "other_screens");
    const featured = [...imax, ...plf, ...other].slice(0, 6);

    const html = `
      ${heroHtml()}
      <div class="divider"></div>
      ${formatsHtml()}
      <div class="divider"></div>
      ${featuredScreensHtml(featured, screens.length)}
      ${nearMeCTAHtml()}
      <div class="divider"></div>
      ${moviePreviewHtml()}
    `;
    renderLayout(html, "home");
  }

  function heroHtml() {
    return `
      <section class="hero">
        <div class="hero-content">
          <div class="hero-eyebrow">Premium Cinema Discovery</div>
          <h1 class="hero-headline">Find the Best Screen<br>for Every Movie.</h1>
          <p class="hero-sub">Discover IMAX, Dolby Cinema, and premium large format screens across India and the world.</p>
          <div class="hero-actions">
            <a href="#/screens" class="btn btn-primary btn-lg">Explore Screens</a>
            <a href="#/near-me" class="btn btn-ghost btn-lg">Find Near Me</a>
          </div>
        </div>
        <div class="hero-scroll">
          <span>Scroll</span>
          <div class="hero-scroll-line"></div>
        </div>
      </section>`;
  }

  function formatsHtml() {
    const formats = [
      { key: "IMAX",    name: "IMAX",         spec: "1.43:1 — 1.90:1",     desc: "The largest cinema format. Dual 4K laser on screens up to 22m tall." },
      { key: "Dolby",   name: "Dolby Cinema",  spec: "Dolby Vision + Atmos", desc: "HDR laser projection with Dolby Atmos spatial audio." },
      { key: "PLF",     name: "PLF",           spec: "Premium Large Format", desc: "Oversized screens with enhanced projection beyond standard multiplexes." },
      { key: "EPIQ",    name: "EPIQ",          spec: "PVR/Miraj format",     desc: "Six-story screens with 4K laser and 11.1 surround audio." },
      { key: "Samsung Onyx", name: "Samsung Onyx", spec: "Direct View LED", desc: "Bright, flicker-free LED display without projector or lens." },
    ];
    return `
      <section class="section-gap">
        <div class="container">
          <div class="section-header">
            <div>
              <div class="section-label">Formats</div>
              <div class="section-title">Premium Cinema Formats</div>
            </div>
            <a href="#/screens" class="section-link">Browse all screens</a>
          </div>
          <div class="formats-grid">
            ${formats.map(f => `
              <div class="format-card" data-format="${f.key}">
                <div class="format-name">${f.name}</div>
                <div class="format-spec">${f.spec}</div>
                <div class="format-desc">${f.desc}</div>
              </div>`).join("")}
          </div>
        </div>
      </section>`;
  }

  function featuredScreensHtml(featured, total) {
    const countLabel = total > 0 ? `View all ${total} screens` : "Browse all screens";
    const cards = featured.length > 0
      ? featured.map(s => screenCardHtml(s)).join("")
      : skeletonCardsHtml(6);
    return `
      <section class="section-gap">
        <div class="container">
          <div class="section-header">
            <div>
              <div class="section-label">Featured</div>
              <div class="section-title">Notable Screens</div>
            </div>
            <a href="#/screens" class="section-link">${countLabel}</a>
          </div>
          <div class="screens-grid">${cards}</div>
        </div>
      </section>`;
  }

  function nearMeCTAHtml() {
    // Use real IMAX screens with coordinates for the preview
    const withCoords = window.DB.indianImax
      .filter(r => r.lat && r.long)
      .slice(0, 3);

    const previewRows = withCoords.length > 0
      ? withCoords.map((r, i) => `
          <div class="nearme-screen-row">
            <span class="nearme-rank">${String(i + 1).padStart(2, "0")}</span>
            <span class="nearme-row-name">${r.location}</span>
            <span class="nearme-row-format">IMAX</span>
            <span class="nearme-row-dist">${r.city}</span>
          </div>`).join("")
      : `<div class="nearme-screen-row">
          <span class="nearme-row-name" style="color:var(--text-3);font-size:0.8rem;">Location access required</span>
        </div>`;

    return `
      <section class="nearme-section section-gap">
        <div class="container">
          <div class="nearme-inner">
            <div>
              <div class="section-label">Location</div>
              <h2 class="nearme-headline">The Best Cinema Experience Starts Near You.</h2>
              <p class="nearme-desc">Filmetric ranks IMAX and premium screens by distance from your location.</p>
              <a href="#/near-me" class="btn btn-primary">Find Screens Near Me</a>
            </div>
            <div class="nearme-visual">${previewRows}</div>
          </div>
        </div>
      </section>`;
  }

  function moviePreviewHtml() {
    const hasKey = !!omdbKey;
    return `
      <section class="movie-preview-section section-gap">
        <div class="container">
          <div class="movie-preview-inner">
            <div>
              <div class="movie-preview-label">Movie Formats</div>
              <h2 class="movie-preview-headline">Best Format for Your Movie.</h2>
              <p class="movie-preview-desc">Not every screen is right for every film. Filmetric matches genres and cinematography to the optimal format.</p>
              <a href="#/movies" class="btn btn-ghost">Find Your Format</a>
            </div>
            <div class="movie-preview-card">
              <div class="movie-row">
                <span class="movie-row-label">Watching</span>
                <span class="movie-row-val">Oppenheimer</span>
              </div>
              <div class="movie-row">
                <span class="movie-row-label">Genre</span>
                <span class="movie-row-val">Drama, History</span>
              </div>
              <div class="movie-row">
                <span class="movie-row-label">Runtime</span>
                <span class="movie-row-val">181 minutes</span>
              </div>
              <div class="movie-row">
                <span class="movie-row-label">Recommended</span>
                <span class="movie-row-val format-highlight">IMAX 1.43:1</span>
              </div>
            </div>
          </div>
        </div>
      </section>`;
  }

  // ── SCREENS VIEW ──────────────────────────────────────
  // Format filter values derived from actual data
  function getDistinctFormats() {
    const formats = new Set();
    window.DB.allScreens.forEach(s => {
      const f = (s.format || "").toUpperCase();
      if (f.includes("IMAX"))        formats.add("IMAX");
      else if (f.includes("DOLBY"))  formats.add("Dolby Cinema");
      else if (f.includes("EPIQ"))   formats.add("EPIQ");
      else if (f.includes("PLF") || f.includes("PXL") || f.includes("PCX")) formats.add("PLF");
      else if (f.includes("ONYX"))   formats.add("Samsung Onyx");
      else if (f.includes("SCREENX") || f.includes("SCREEN X")) formats.add("ScreenX");
      else if (f.includes("HDR"))    formats.add("HDR by Barco");
      else                           formats.add("Other");
    });
    return ["All", ...Array.from(formats).sort()];
  }

  function renderScreensView() {
    setMeta({
      title: "Browse Cinema Screens | Filmetric",
      description: "Browse the database of premium movie screens, IMAX, Dolby Cinema, and PLF auditoriums across India.",
      canonicalPath: "#/screens"
    });
    screensPage = 1;
    const formats = getDistinctFormats();
    const chips = formats.map(f => `
      <button class="chip${screensFormatFilter === (f === "All" ? "" : f) ? " active" : ""}"
        data-format="${f === "All" ? "" : f}">${f}</button>`
    ).join("");

    const total = window.DB.allScreens.length;
    const html = `
      <div class="container">
        <div class="page-header" style="display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:1rem;">
          <div>
            <h1 class="page-title" style="margin:0;">Screens</h1>
            <div class="page-subtitle" style="margin-top:0.25rem;">${total > 0 ? `${total} screens in database` : "No data — check Settings"}</div>
          </div>
          <button class="btn btn-primary btn-sm" id="submit-missing-screen-btn">Submit Missing Screen</button>
        </div>
        <div class="filter-bar">
          <input type="text" class="filter-search" id="screens-search"
            placeholder="Search by name, city, format..." value="${screensSearchQuery}">
          <div class="filter-chips" id="format-chips">${chips}</div>
        </div>
        <div class="results-count" id="results-count"></div>
        <div class="screens-list-grid" id="screens-grid"></div>
        <div class="load-more-wrap" id="load-more-wrap">
          <button class="btn btn-ghost" id="load-more-btn">Load more</button>
        </div>
      </div>`;

    renderLayout(html, "screens");
    renderScreensList();
    attachScreensListeners();
    document.getElementById("submit-missing-screen-btn")?.addEventListener("click", showSubmitScreenModal);
  }

  function getFilteredScreens() {
    let list = window.DB.allScreens;
    if (screensSearchQuery) {
      const q = screensSearchQuery.toLowerCase();
      list = list.filter(s =>
        (s.name   || "").toLowerCase().includes(q) ||
        (s.city   || "").toLowerCase().includes(q) ||
        (s.format || "").toLowerCase().includes(q)
      );
    }
    if (screensFormatFilter) {
      const fq = screensFormatFilter.toUpperCase();
      list = list.filter(s => {
        const f = (s.format || "").toUpperCase();
        if (fq === "IMAX")         return f.includes("IMAX");
        if (fq === "DOLBY CINEMA") return f.includes("DOLBY");
        if (fq === "EPIQ")         return f.includes("EPIQ");
        if (fq === "PLF")          return f.includes("PLF") || f.includes("PXL") || f.includes("PCX");
        if (fq === "SAMSUNG ONYX") return f.includes("ONYX");
        if (fq === "SCREENX")      return f.includes("SCREENX") || f.includes("SCREEN X");
        if (fq === "HDR BY BARCO") return f.includes("HDR");
        return f.includes(fq);
      });
    }
    console.log("filteredScreens.length:", list.length);
    return list;
  }

  function renderScreensList() {
    const all   = getFilteredScreens();
    const countEl   = document.getElementById("results-count");
    const grid      = document.getElementById("screens-grid");
    const loadWrap  = document.getElementById("load-more-wrap");

    if (countEl) countEl.textContent = `${all.length} screens found`;

    const page = all.slice(0, screensPage * SCREENS_PER_PAGE);
    console.log("Number of records rendered:", page.length);
    if (grid) {
      if (page.length === 0) {
        grid.innerHTML = `<div style="padding:3rem;text-align:center;color:var(--text-3);grid-column:1/-1;">
          <div style="font-size:0.9rem;color:var(--text-2);margin-bottom:0.5rem;">No screens found</div>
          <div style="font-size:0.8rem;">Try a different search or filter</div>
        </div>`;
      } else {
        grid.innerHTML = page.map(s => screenCardHtml(s)).join("");
      }
    }
    if (loadWrap) loadWrap.style.display = page.length >= all.length ? "none" : "flex";
  }

  let screensSearchTimer = null;
  function attachScreensListeners() {
    const input = document.getElementById("screens-search");
    if (input) {
      input.addEventListener("input", () => {
        clearTimeout(screensSearchTimer);
        screensSearchTimer = setTimeout(() => {
          screensSearchQuery = input.value;
          screensPage = 1;
          renderScreensList();
        }, 250);
      });
    }
    document.getElementById("format-chips")?.addEventListener("click", e => {
      const chip = e.target.closest(".chip");
      if (!chip) return;
      screensFormatFilter = chip.dataset.format;
      screensPage = 1;
      document.querySelectorAll("#format-chips .chip").forEach(c => c.classList.toggle("active", c === chip));
      renderScreensList();
    });
    document.getElementById("load-more-btn")?.addEventListener("click", () => {
      screensPage++;
      renderScreensList();
    });
  }

  // ── DETAIL VIEW ───────────────────────────────────────
  function renderDetailView(id) {
    // Search across all screens including international
    const intl = window.DB.intlImax.map(r => fromIntlImax(r));
    const all  = [...window.DB.allScreens, ...intl];
    const s = all.find(sc => sc.id === id);

    if (!s) {
      renderLayout(`
        <div class="container" style="padding:6rem 0;text-align:center;">
          <div class="section-label" style="margin-bottom:1rem;">Not Found</div>
          <p style="color:var(--text-2);margin-bottom:2rem;">Screen not found in database.</p>
          <a href="#/screens" class="btn btn-ghost">Browse Screens</a>
        </div>`);
      return;
    }

    const pageTitle = `${s.name} ${s.format} | ${s.projection || s.format} Screen | Filmetric`;
    const pageDesc = `Explore ${s.name}'s ${s.format} screen specifications, aspect ratio, projection system, screen dimensions, and seating capacity on Filmetric.`;
    setMeta({
      title: pageTitle,
      description: pageDesc,
      canonicalPath: `#/screen/${s.id}`,
      schema: {
        "@context": "https://schema.org",
        "@type": "MovieTheater",
        "name": s.name,
        "address": {
          "@type": "PostalAddress",
          "addressLocality": s.city,
          "addressCountry": s.country
        }
      }
    });

    const loc = [s.city, s.state, s.country !== "India" ? s.country : null].filter(Boolean).join(", ");
    const statusClass = (s.status || "Open") === "Open" ? "open" : "closed";

    const specRows = [
      ["Format",       s.format],
      ["Projection",   s.projection],
      ["Aspect Ratio", s.aspectRatio],
      s.widthFt   ? ["Width",        `${s.widthFt} ft`]          : null,
      s.heightFt  ? ["Height",       `${s.heightFt} ft`]         : null,
      s.area      ? ["Screen Area",  `${s.area.toLocaleString()} sq ft`] : null,
      s.seats     ? ["Seats",        s.seats]                    : null,
      s.audio     ? ["Audio",        s.audio]                    : null,
      s.remarks   ? ["Notes",        s.remarks]                  : null,
    ].filter(Boolean);

    const fClass = (s.format || "").toLowerCase().replace(/\s+/g, "-");
    const html = `
      <div class="container">
        <a href="#/screens" class="detail-back">
          <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
            <path d="m15 18-6-6 6-6"/>
          </svg>
          All Screens
        </a>

        <div class="detail-hero">
          <div class="detail-format-tag">${s.format}</div>
          <h1 class="detail-title">${s.name}</h1>
          <div class="detail-location">${loc}</div>
          <div class="detail-actions" style="display:flex; gap:0.75rem; align-items:center;">
            <div class="status-badge ${statusClass}">
              <span class="status-dot"></span>
              ${s.status || "Open"}
            </div>
            <div id="theatre-rating-summary-badge" class="status-badge" style="border-color:var(--border); color:var(--text-2); display:none;"></div>
          </div>
        </div>

        <div class="detail-grid">
          <div>
            <div class="detail-format-block format-${fClass}">
              <div class="detail-format-badge">${s.format}</div>
              <div class="detail-format-sub">${s.projection || "Premium Cinema Technology"}</div>
            </div>
            
            <div class="specs-card" style="margin-bottom:1.5rem;">
              <div class="specs-card-header">
                <div class="specs-card-title">Technical Specifications</div>
              </div>
              ${specRows.map(([k, v]) => `
                <div class="spec-row">
                  <span class="spec-key">${k}</span>
                  <span class="spec-val">${v}</span>
                </div>`).join("")}
            </div>

            <!-- Photos Gallery -->
            <div id="detail-photos-gallery" style="margin-bottom:1.5rem; display:none;">
              <div class="specs-card">
                <div class="specs-card-header"><div class="specs-card-title">User Uploaded Photos</div></div>
                <div style="padding:1.5rem; display:grid; grid-template-columns:repeat(auto-fill, minmax(140px, 1fr)); gap:1rem;" id="detail-photos-list"></div>
              </div>
            </div>

            <!-- Reviews and Ratings Section -->
            <div class="specs-card">
              <div class="specs-card-header" style="display:flex; justify-content:space-between; align-items:center;">
                <div class="specs-card-title">User Reviews</div>
                <span id="detail-average-rating" style="font-size:0.75rem; font-family:'JetBrains Mono', monospace; text-transform:uppercase; color:var(--cream);">Loading reviews...</span>
              </div>
              <div style="padding:1.5rem;">
                <div id="user-review-form-container" style="margin-bottom:1.5rem; padding-bottom:1.5rem; border-bottom:1px solid var(--border);"></div>
                <div id="detail-reviews-list" style="display:flex; flex-direction:column; gap:1.25rem;"></div>
              </div>
            </div>
          </div>

          <div>
            <div class="specs-card" style="margin-bottom:1rem;">
              <div class="specs-card-header">
                <div class="specs-card-title">Location</div>
              </div>
              <div class="spec-row">
                <span class="spec-key">City</span>
                <span class="spec-val">${s.city}</span>
              </div>
              ${s.country ? `<div class="spec-row"><span class="spec-key">Country</span><span class="spec-val">${s.country}</span></div>` : ""}
              ${s.lat ? `<div class="spec-row"><span class="spec-key">Coordinates</span><span class="spec-val t-mono" style="font-size:0.7rem;">${s.lat.toFixed(4)}, ${s.lon.toFixed(4)}</span></div>` : ""}
            </div>
            ${s.lat ? `
              <div id="detail-map" class="mini-map-preview"></div>
              <a href="https://www.google.com/maps?q=${s.lat},${s.lon}" target="_blank" class="btn btn-ghost btn-full mb-2">
                Open in Maps
              </a>` : ""}
            <a href="#/near-me" class="btn btn-ghost btn-full mb-2">Find Similar Near Me</a>
            <a href="#/screens?q=${encodeURIComponent(s.format.split(" ")[0])}" class="btn btn-ghost btn-full mb-2">
              More Similar Screens
            </a>
            <button id="detail-submit-photo-btn" class="btn btn-ghost btn-full mb-2">Upload Theatre Photo</button>
            <button id="detail-submit-correction-btn" class="btn btn-ghost btn-full mb-3">Submit Correction</button>
            
            ${s.lat ? `
              <div class="specs-card" style="margin-top:1.5rem;">
                <div class="specs-card-header">
                  <div class="specs-card-title">Nearby Premium Screens</div>
                </div>
                <div id="nearby-screens-list"></div>
              </div>` : ""}
          </div>
        </div>
      </div>`;

    renderLayout(html, "screens");

    // Load Leaflet map and populate nearby screens dynamically after content is loaded
    if (s.lat && s.lon) {
      setTimeout(() => {
        const mapContainer = document.getElementById("detail-map");
        if (!mapContainer) return;

        // Initialize Leaflet map
        const map = L.map('detail-map', {
          zoomControl: false,
          attributionControl: false,
          scrollWheelZoom: false,
          dragging: !L.Browser.mobile,
          touchZoom: true
        }).setView([s.lat, s.lon], 13);

        // Add CartoDB Dark Matter tile layer
        L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
          maxZoom: 20
        }).addTo(map);

        // Add custom icon matching branding
        const customIcon = L.divIcon({
          className: 'custom-map-marker',
          html: '<div class="marker-pin"></div>',
          iconSize: [24, 24],
          iconAnchor: [12, 12]
        });

        // Popup content layout
        const popupHtml = `
          <div style="font-family:'DM Sans', sans-serif; color:var(--text); font-size:0.8rem; line-height:1.4;">
            <div style="font-weight:600; color:#fff; margin-bottom:2px;">${s.name}</div>
            <div style="color:var(--text-2); font-size:0.75rem; margin-bottom:2px;">${s.city}</div>
            <div style="color:var(--cream); font-family:'JetBrains Mono', monospace; font-size:0.65rem; text-transform:uppercase; font-weight:500; letter-spacing:0.05em;">${s.format}</div>
          </div>
        `;

        // Add marker
        L.marker([s.lat, s.lon], { icon: customIcon }).addTo(map).bindPopup(popupHtml);

        // Calculate 3 nearest screens (excluding current screen)
        const allOther = window.DB.allScreens || [];
        const geocoded = allOther
          .filter(sc => sc.lat && sc.lon && sc.id !== s.id)
          .map(sc => ({
            ...sc,
            dist: haversine(s.lat, s.lon, sc.lat, sc.lon)
          }))
          .sort((a, b) => a.dist - b.dist)
          .slice(0, 3);

        const listEl = document.getElementById("nearby-screens-list");
        if (listEl) {
          if (geocoded.length === 0) {
            listEl.innerHTML = `<div style="padding:1rem 1.5rem; font-size:0.8rem; color:var(--text-3);">No premium screens nearby.</div>`;
          } else {
            listEl.innerHTML = geocoded.map(sc => {
              const distStr = sc.dist < 1 ? `${Math.round(sc.dist * 1000)} m` : `${sc.dist.toFixed(1)} km`;
              return `
                <a href="#/screen/${sc.id}" class="spec-row" style="display:flex; justify-content:space-between; align-items:center; text-decoration:none; color:inherit; transition:background var(--t) var(--ease);">
                  <div style="text-align:left;">
                    <div style="font-size:0.85rem; font-weight:500; color:var(--text);">${sc.name}</div>
                    <div style="font-size:0.7rem; color:var(--text-2); margin-top:2px;">${distStr} &middot; ${sc.city}</div>
                  </div>
                  <span style="font-family:'JetBrains Mono', monospace; font-size:0.65rem; color:var(--text-3); text-transform:uppercase; letter-spacing:0.05em;">${sc.format}</span>
                </a>`;
            }).join("");
          }
        }
      }, 50);
    }

    // Dynamic loading of reviews and photos
    fetchTheatreReviews(s.id).then(reviews => {
      const count = reviews.length;
      const sum = reviews.reduce((acc, curr) => acc + curr.rating, 0);
      const avg = count > 0 ? (sum / count).toFixed(1) : 0;
      
      const badge = document.getElementById("theatre-rating-summary-badge");
      if (badge && count > 0) {
        badge.innerHTML = `⭐ ${avg} (${count} review${count > 1 ? "s" : ""})`;
        badge.style.display = "inline-flex";
      }

      const avgText = document.getElementById("detail-average-rating");
      if (avgText) {
        avgText.textContent = count > 0 ? `★ ${avg}/5 (${count} review${count > 1 ? "s" : ""})` : "No reviews yet";
      }

      const reviewsList = document.getElementById("detail-reviews-list");
      if (reviewsList) {
        if (reviews.length === 0) {
          reviewsList.innerHTML = `<p style="font-size:0.85rem; color:var(--text-3); text-align:center; padding:1rem 0;">Be the first to review this screen!</p>`;
        } else {
          reviewsList.innerHTML = reviews.map(r => {
            const stars = "★".repeat(r.rating) + "☆".repeat(5 - r.rating);
            const userAvatar = r.profiles?.avatar_url 
              ? `<img src="${r.profiles.avatar_url}" style="width:100%; height:100%; object-fit:cover; border-radius:50%;">`
              : (r.profiles?.username || "?").substring(0,2).toUpperCase();
            
            const isOwnReview = currentUser && r.user_id === currentUser.id;
            const isAdmin = currentUser && currentUser.role === 'admin';
            const deleteBtn = (isOwnReview || isAdmin) 
              ? `<button class="btn btn-ghost delete-review-btn" data-review-id="${r.id}" style="padding:2px 8px; font-size:0.65rem; color:#FF7B72; border-color:rgba(255,123,114,0.15); margin-left:auto;">Delete</button>` 
              : '';

            return `
              <div style="display:flex; gap:1rem; align-items:flex-start;">
                <div style="width:32px; height:32px; background:var(--surface-3); border-radius:50%; display:flex; align-items:center; justify-content:center; font-size:0.75rem; font-weight:600; color:var(--cream); overflow:hidden; border:1px solid var(--border); flex-shrink:0;">${userAvatar}</div>
                <div style="flex:1;">
                  <div style="display:flex; align-items:center; gap:0.5rem;">
                    <span style="font-size:0.85rem; font-weight:600; color:var(--text);">${r.profiles?.username || "Anonymous"}</span>
                    <span style="font-size:0.75rem; color:var(--cream); letter-spacing:-1px;">${stars}</span>
                    ${deleteBtn}
                  </div>
                  <p style="font-size:0.8rem; color:var(--text-2); line-height:1.5; margin-top:4px;">${r.review || ""}</p>
                  <div style="font-size:0.65rem; color:var(--text-3); margin-top:4px;">${new Date(r.created_at).toLocaleDateString()}</div>
                </div>
              </div>
            `;
          }).join("");

          reviewsList.querySelectorAll(".delete-review-btn").forEach(btn => {
            btn.addEventListener("click", async () => {
              if (confirm("Are you sure you want to delete this review?")) {
                try {
                  await deleteReview(btn.dataset.reviewId, s.id);
                  showToast("Review deleted.");
                  resolveRoute();
                } catch (e) {
                  showToast("Failed to delete review: " + e.message);
                }
              }
            });
          });
        }
      }

      const formContainer = document.getElementById("user-review-form-container");
      if (formContainer) {
        if (!currentUser) {
          formContainer.innerHTML = `
            <div style="text-align:center; padding:0.5rem 0;">
              <p style="font-size:0.8rem; color:var(--text-2); margin-bottom:0.75rem;">Sign in to leave a rating and review.</p>
              <button class="btn btn-ghost btn-sm auth-trigger-btn">Login / Sign Up</button>
            </div>`;
          formContainer.querySelector(".auth-trigger-btn")?.addEventListener("click", showAuthModal);
        } else {
          const ownReview = reviews.find(r => r.user_id === currentUser.id);
          formContainer.innerHTML = `
            <div style="display:flex; flex-direction:column; gap:0.75rem;">
              <div style="font-size:0.85rem; font-weight:600; color:var(--text);">${ownReview ? "Update your review" : "Write a review"}</div>
              <div style="display:flex; gap:0.5rem; align-items:center;">
                <span style="font-size:0.75rem; color:var(--text-2);">Rating:</span>
                <select id="user-rating-select" class="form-input" style="width:auto; padding:0.25rem 0.5rem; font-size:0.8rem;">
                  <option value="5" ${ownReview?.rating === 5 ? "selected" : ""}>⭐⭐⭐⭐⭐ (5/5)</option>
                  <option value="4" ${ownReview?.rating === 4 ? "selected" : ""}>⭐⭐⭐⭐ (4/5)</option>
                  <option value="3" ${ownReview?.rating === 3 ? "selected" : ""}>⭐⭐⭐ (3/5)</option>
                  <option value="2" ${ownReview?.rating === 2 ? "selected" : ""}>⭐⭐ (2/5)</option>
                  <option value="1" ${ownReview?.rating === 1 ? "selected" : ""}>⭐ (1/5)</option>
                </select>
              </div>
              <textarea id="user-review-text" class="form-input" style="height:64px; font-size:0.8rem; padding:0.5rem; resize:none;" placeholder="Write your thoughts about this screen (optional)...">${ownReview?.review || ""}</textarea>
              <div style="display:flex; justify-content:flex-end;">
                <button id="submit-review-btn" class="btn btn-primary btn-sm">${ownReview ? "Update" : "Submit"}</button>
              </div>
            </div>`;

          document.getElementById("submit-review-btn")?.addEventListener("click", async () => {
            const rating = parseInt(document.getElementById("user-rating-select").value);
            const text = document.getElementById("user-review-text").value.trim();
            try {
              await addOrUpdateReview(s.id, rating, text);
              showToast(ownReview ? "Review updated." : "Review submitted.");
              resolveRoute();
            } catch (e) {
              showToast("Failed to submit review: " + e.message);
            }
          });
        }
      }
    });

    fetchTheatrePhotos(s.id).then(photos => {
      if (photos.length > 0) {
        const list = document.getElementById("detail-photos-list");
        if (list) {
          list.innerHTML = photos.map(p => `
            <div style="border-radius:var(--r-md); overflow:hidden; border:1px solid var(--border); aspect-ratio:16/9; background:#000;">
              <img src="${p.image_url}" style="width:100%; height:100%; object-fit:cover; cursor:pointer;" alt="Theatre Photo" onclick="window.open('${p.image_url}', '_blank')">
            </div>`).join("");
          document.getElementById("detail-photos-gallery").style.display = "block";
        }
      }
    });

    document.getElementById("detail-submit-photo-btn")?.addEventListener("click", () => {
      showUploadPhotoModal(s.id);
    });
    document.getElementById("detail-submit-correction-btn")?.addEventListener("click", () => {
      showCorrectionModal(s.id);
    });
  }

  // ── NEAR ME VIEW ──────────────────────────────────────
  function renderNearMeView() {
    setMeta({
      title: "Best Cinema Screens Near You | Filmetric",
      description: "Find the closest premium IMAX and Dolby Cinema screens sorted by real-time distance.",
      canonicalPath: "#/near-me"
    });
    renderLayout(`
      <div class="container">
        <div class="nearme-page-header">
          <div class="section-label">Location</div>
          <h1 class="page-title">Best Screens Near You</h1>
          <p class="page-subtitle" style="margin-top:0.5rem;">Showing IMAX screens with confirmed coordinates.</p>
        </div>
        <div id="nearme-body"></div>
      </div>`, "nearme");

    renderNearMeBody();
  }

  function renderNearMeBody() {
    const body = document.getElementById("nearme-body");
    if (!body) return;

    // Only Indian IMAX screens have lat/lon
    const geoScreens = window.DB.indianImax
      .filter(r => r.lat && r.long)
      .map(r => fromIndianImax(r));

    if (geoScreens.length === 0) {
      body.innerHTML = noDataHtml("No screens with location data found.");
      return;
    }

    if (!userCoords) {
      body.innerHTML = `
        <div class="location-prompt">
          <div class="location-prompt-title">Allow Location Access</div>
          <p class="location-prompt-sub">Filmetric uses your location to rank IMAX screens by proximity.</p>
          <button class="btn btn-primary" id="enable-location-btn">Enable Location</button>
        </div>`;

      document.getElementById("enable-location-btn")?.addEventListener("click", () => {
        body.innerHTML = `<div class="location-prompt"><p style="color:var(--text-2);font-size:0.875rem;">Finding your location...</p></div>`;
        navigator.geolocation.getCurrentPosition(
          pos => {
            userCoords = { lat: pos.coords.latitude, lon: pos.coords.longitude };
            renderNearMeResults(body, geoScreens);
          },
          () => {
            body.innerHTML = `
              <div class="location-prompt">
                <div class="location-prompt-title">Location Denied</div>
                <p class="location-prompt-sub">Enable location in browser settings to use this feature.</p>
                <a href="#/screens" class="btn btn-ghost">Browse All Screens</a>
              </div>`;
          }
        );
      });
    } else {
      renderNearMeResults(body, geoScreens);
    }
  }

  function renderNearMeResults(container, geoScreens) {
    const sorted = geoScreens
      .map(s => ({ ...s, dist: haversine(userCoords.lat, userCoords.lon, s.lat, s.lon) }))
      .sort((a, b) => a.dist - b.dist);

    const cards = sorted.map((s, i) => {
      const distStr = s.dist < 1 ? `${Math.round(s.dist * 1000)} m` : `${s.dist.toFixed(1)} km`;
      return `
        <a href="#/screen/${s.id}" class="nearme-screen-card">
          <span class="nearme-card-rank">${String(i + 1).padStart(2, "0")}</span>
          <div class="nearme-card-body">
            <div class="nearme-card-name">${s.name}</div>
            <div class="nearme-card-location">${s.city}${s.aspectRatio ? " · " + s.aspectRatio : ""}</div>
          </div>
          <span class="nearme-card-format">${(s.projection || "IMAX").split(" ").slice(0, 2).join(" ")}</span>
          <span class="nearme-card-dist">${distStr}</span>
        </a>`;
    }).join("");

    container.innerHTML = `
      <div class="location-found">
        <div class="location-dot"></div>
        <span>Location active — ${userCoords.lat.toFixed(4)}N, ${userCoords.lon.toFixed(4)}E</span>
        <button class="btn btn-ghost btn-sm" id="refresh-location" style="margin-left:auto;">Refresh</button>
      </div>
      <p style="font-size:0.75rem;color:var(--text-3);margin-bottom:1.25rem;">
        Showing ${sorted.length} IMAX screens with confirmed coordinates.
      </p>
      ${cards}`;

    document.getElementById("refresh-location")?.addEventListener("click", () => {
      userCoords = null;
      renderNearMeBody();
    });
  }

  // ── RANKINGS VIEW ─────────────────────────────────────
  function renderRankingsView() {
    setMeta({
      title: "Cinema Screen Rankings | Filmetric",
      description: "Rankings of the largest screens, most seats, and projection types across India and the world.",
      canonicalPath: "#/rankings"
    });
    const indianImax = window.DB.indianImax.map(r => fromIndianImax(r));
    const intlImax   = window.DB.intlImax.map(r => fromIntlImax(r));

    // Tab 1 — Largest screens (area = w × h, Indian IMAX only — only table with both w and h)
    const byArea = indianImax
      .filter(s => s.widthFt && s.heightFt)
      .sort((a, b) => (b.area || 0) - (a.area || 0));

    // Tab 2 — Most seats (Indian IMAX + other_screens)
    const bySeats = [...indianImax, ...window.DB.allScreens.filter(s => s._table === "other_screens")]
      .filter(s => s.seats)
      .sort((a, b) => b.seats - a.seats);

    // Tab 3 — Indian IMAX by projection type
    const imaxIndia = indianImax.sort((a, b) => (b.area || 0) - (a.area || 0));

    // Tab 4 — International IMAX by screen size (where available)
    const imaxIntl = intlImax.sort((a, b) => (b.area || 0) - (a.area || 0));

    function rankTableHtml(items, cols) {
      if (items.length === 0) return `<div style="padding:2rem;text-align:center;color:var(--text-3);font-size:0.8rem;">No data available</div>`;
      return items.slice(0, 50).map((s, i) => {
        const loc = [s.city, s.country !== "India" ? s.country : null].filter(Boolean).join(", ");
        const mainVal = cols.val(s);
        return `
          <a href="#/screen/${s.id}" class="rankings-row">
            <span class="rank-num">${i + 1}</span>
            <div>
              <div class="rankings-name">${s.name}</div>
              <div class="rankings-location">${loc}</div>
            </div>
            <span class="rankings-format rankings-hide-mobile">${s.format}</span>
            <span class="rankings-area rankings-hide-mobile">${mainVal}</span>
            <span class="rankings-format">${s.aspectRatio || s.projection?.split(" ")[0] || "—"}</span>
          </a>`;
      }).join("");
    }

    const tabs = [
      { id: "tab-area",   label: "Largest", subtitle: "Ranked by confirmed width × height (sq ft)", items: byArea,    val: s => s.area ? `${s.area.toLocaleString()} sq ft` : "—" },
      { id: "tab-seats",  label: "Most Seats", subtitle: "Ranked by confirmed seat count", items: bySeats,  val: s => s.seats ? `${s.seats} seats` : "—" },
      { id: "tab-india",  label: "IMAX India", subtitle: `${imaxIndia.length} screens`, items: imaxIndia, val: s => s.area ? `${s.area.toLocaleString()} sq ft` : "—" },
      { id: "tab-intl",   label: "IMAX World", subtitle: `${imaxIntl.length} screens`, items: imaxIntl,  val: s => s.screenSize || (s.area ? `${s.area.toLocaleString()} sq ft` : "—") },
    ];

    const tabBtns = tabs.map((t, i) => `
      <button class="chip rankings-tab-btn${i === 0 ? " active" : ""}" data-tab="${t.id}">${t.label}</button>`
    ).join("");

    const tabPanels = tabs.map((t, i) => `
      <div id="${t.id}" class="rankings-panel${i === 0 ? "" : " hidden"}">
        <p style="font-size:0.75rem;color:var(--text-3);margin-bottom:1rem;">${t.subtitle}</p>
        <div class="rankings-table">
          <div class="rankings-table-head">
            <span class="rankings-col-head">#</span>
            <span class="rankings-col-head">Screen</span>
            <span class="rankings-col-head rankings-hide-mobile">Format</span>
            <span class="rankings-col-head rankings-hide-mobile">Size / Seats</span>
            <span class="rankings-col-head">Ratio / Type</span>
          </div>
          ${rankTableHtml(t.items, t)}
        </div>
      </div>`).join("");

    const html = `
      <div class="container">
        <div class="page-header">
          <div class="section-label">Rankings</div>
          <h1 class="page-title">Cinema Screen Rankings</h1>
          <p class="page-subtitle">Based on confirmed data from our database.</p>
        </div>
        <div class="filter-chips" style="margin-bottom:2rem;">${tabBtns}</div>
        ${tabPanels}
      </div>`;

    renderLayout(html, "rankings");

    document.querySelectorAll(".rankings-tab-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(".rankings-tab-btn").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        document.querySelectorAll(".rankings-panel").forEach(p => p.classList.add("hidden"));
        const panel = document.getElementById(btn.dataset.tab);
        if (panel) panel.classList.remove("hidden");
      });
    });
  }

  function renderMoviesView() {
    setMeta({
      title: "Best Format for Your Movie | Filmetric",
      description: "Search any film to discover the ideal cinema format and recommended screens.",
      canonicalPath: "#/movies"
    });
    const hasKey = !!omdbKey;

    const html = `
      <div class="container">
        <div class="page-header">
          <div class="section-label">Formats</div>
          <h1 class="page-title">Best Format for Your Movie</h1>
          <p class="page-subtitle">Search any film to discover the ideal cinema format.</p>
        </div>

        <div class="movies-search-wrap">
          ${!hasKey ? `
            <div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--r-md);padding:1.25rem 1.5rem;margin-bottom:2rem;">
              <p style="font-size:0.8rem;color:var(--text-2);line-height:1.6;">
                Add your OMDb API key in <a href="#/settings" style="color:var(--text);border-bottom:1px solid var(--border-hover);padding-bottom:1px;">Settings</a> to enable movie search.
                Get a key at <a href="https://www.omdbapi.com/apikey.aspx" target="_blank" style="color:var(--text);border-bottom:1px solid var(--border-hover);">omdbapi.com</a>.
              </p>
            </div>` : ""}
          <div class="movies-input-group">
            <input type="text" class="movies-input" id="movie-search-input"
              placeholder="${hasKey ? "Search a movie..." : "Add OMDb key in Settings to search..."}"
              ${!hasKey ? "disabled" : ""} autocomplete="off">
            <div class="movie-suggestions" id="movie-suggestions"></div>
          </div>
          <div id="movie-result"></div>
        </div>
      </div>`;

    renderLayout(html, "movies");
    if (hasKey) attachMoviesListeners();
    if (selectedMovie) renderMovieResult(selectedMovie);
  }

  function renderMovieResult(movie) {
    selectedMovie = movie;
    const rec = recommendFormat(movie);
    
    // SEO update for specific movie
    setMeta({
      title: `Best Screen for Watching ${movie.Title} | Filmetric`,
      description: `Discover the best cinema format, projection specs, and recommended screens for watching ${movie.Title}.`,
      canonicalPath: `#/movies?q=${encodeURIComponent(movie.Title)}`,
      schema: {
        "@context": "https://schema.org",
        "@type": "Movie",
        "name": movie.Title,
        "dateCreated": movie.Year,
        "director": {
          "@type": "Person",
          "name": movie.Director || "Unknown"
        }
      }
    });

    const poster = (movie.Poster && movie.Poster !== "N/A") ? movie.Poster : null;
    const releaseYear = movie.Year || "—";
    
    // Get matching Supabase screens
    const matched = getMatchingScreens(rec.format);
    const screensHtml = matched.map(s => {
      const loc = [s.city, s.country !== "India" ? s.country : null].filter(Boolean).join(", ");
      return `
        <a href="#/screen/${s.id}" class="rankings-row" style="margin-top:0.5rem;padding:0.75rem 1.25rem;">
          <div style="flex:1;">
            <div class="rankings-name" style="font-size:0.85rem;font-weight:500;">${s.name}</div>
            <div class="rankings-location" style="font-size:0.7rem;color:var(--text-2);margin-top:2px;">${loc}</div>
          </div>
          <span class="rankings-format" style="font-size:0.7rem;font-family:'JetBrains Mono',monospace;">${s.format}</span>
        </a>`;
    }).join("");

    const el = document.getElementById("movie-result");
    if (!el) return;

    el.innerHTML = `
      <div class="movie-result-card" style="margin-top:1.5rem;">
        <div class="movie-result-header">
          ${poster ? `<img src="${poster}" alt="${movie.Title}" style="width:96px;height:144px;object-fit:cover;border-radius:var(--r-sm);flex-shrink:0;border:1px solid var(--border);">` : ""}
          <div style="flex:1;">
            <div class="movie-result-title" style="font-size:1.25rem;font-weight:600;color:var(--text);">${movie.Title} <span style="font-weight:300;color:var(--text-2);">(${releaseYear})</span></div>
            <div class="movie-result-genres" style="font-size:0.75rem;color:var(--text-2);margin-top:0.25rem;margin-bottom:0.75rem;">
              ${movie.Genre || "—"} &middot; ${movie.Runtime || "—"}
            </div>
            <div style="font-size:0.78rem;color:var(--text-2);line-height:1.6;margin-bottom:0.75rem;">
              <strong>Director:</strong> ${movie.Director || "—"}<br>
              <strong>IMDb Rating:</strong> ⭐ ${movie.imdbRating || "—"}/10
            </div>
            ${movie.Plot ? `<p style="font-size:0.78rem;color:var(--text-2);line-height:1.6;display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden;">${movie.Plot}</p>` : ""}
          </div>
        </div>
        
        <div style="margin-top:1.5rem;border-top:1px solid var(--border);padding-top:1.5rem;">
          <div class="rec-row" style="margin-top:0;">
            <span class="rec-label">Recommended Format</span>
            <span class="rec-val format-highlight">${rec.format}</span>
          </div>
          <div class="rec-row">
            <span class="rec-label">Reason</span>
            <span class="rec-val" style="font-size:0.8rem;color:var(--text-2);">${rec.reason}</span>
          </div>
        </div>

        <div style="margin-top:1.5rem;border-top:1px solid var(--border);padding-top:1.5rem;">
          <div style="font-family:'JetBrains Mono',monospace;font-size:0.65rem;letter-spacing:0.15em;text-transform:uppercase;color:var(--text-3);margin-bottom:0.75rem;">Best Screens for ${rec.format}</div>
          <div class="rankings-table" style="border-radius:var(--r-md);">
            ${screensHtml || `<div style="padding:1.5rem;text-align:center;font-size:0.8rem;color:var(--text-3);">No matching screens in database</div>`}
          </div>
        </div>
      </div>`;
  }

  let movieSearchTimer = null;
  function attachMoviesListeners() {
    const input = document.getElementById("movie-search-input");
    const suggestions = document.getElementById("movie-suggestions");

    if (!input) return;

    input.addEventListener("input", () => {
      clearTimeout(movieSearchTimer);
      const q = input.value.trim();
      if (!q) { suggestions?.classList.remove("open"); return; }
      movieSearchTimer = setTimeout(async () => {
        try {
          const results = await omdbSearch(q);
          if (results.length === 0) { suggestions?.classList.remove("open"); return; }
          if (suggestions) {
            suggestions.innerHTML = results.map(m => {
              const poster = (m.Poster && m.Poster !== "N/A") ? m.Poster : "";
              const year = m.Year || "";
              return `
                <div class="movie-suggestion-item" data-movie-id="${m.imdbID}">
                  ${poster ? `<img src="${poster}" alt="${m.Title}" class="movie-poster-thumb">` : `<div class="movie-poster-thumb" style="background:var(--surface-3);"></div>`}
                  <div>
                    <div class="movie-suggestion-title">${m.Title}</div>
                    <div class="movie-suggestion-year">${year}</div>
                  </div>
                </div>`;
            }).join("");
            suggestions.classList.add("open");
            // Attach click handlers
            suggestions.querySelectorAll(".movie-suggestion-item").forEach(item => {
              item.addEventListener("click", async () => {
                const id = item.dataset.movieId;
                suggestions.classList.remove("open");
                input.value = item.querySelector(".movie-suggestion-title")?.textContent || "";
                try {
                  const detail = await omdbDetail(id);
                  renderMovieResult(detail);
                } catch (e) {
                  showToast("Failed to load movie details.");
                }
              });
            });
          }
        } catch (e) {
          if (e.message.includes("No OMDb")) {
            if (suggestions) suggestions.innerHTML = `<div style="padding:0.75rem 1rem;font-size:0.8rem;color:var(--text-2);">Add OMDb key in Settings</div>`;
            suggestions?.classList.add("open");
          }
        }
      }, 400);
    });

    document.addEventListener("click", e => {
      if (!input.contains(e.target) && !suggestions?.contains(e.target)) {
        suggestions?.classList.remove("open");
      }
    });
  }

  // ── PROFILE VIEW & CONTRIBUTIONS ──────────────────────
  async function fetchUserContributions(userId) {
    if (supabase) {
      const [reviewsRes, photosRes, correctionsRes, submissionsRes] = await Promise.all([
        supabase.from('theatre_ratings').select('*').eq('user_id', userId),
        supabase.from('theatre_photos').select('*').eq('user_id', userId),
        supabase.from('corrections').select('*').eq('user_id', userId),
        supabase.from('screen_submissions').select('*').eq('user_id', userId)
      ]);
      return {
        reviews: reviewsRes.data || [],
        photos: photosRes.data || [],
        corrections: correctionsRes.data || [],
        submissions: submissionsRes.data || []
      };
    } else {
      const ratings = JSON.parse(localStorage.getItem("filmetric_theatre_ratings") || "[]").filter(r => r.user_id === userId);
      const photos = JSON.parse(localStorage.getItem("filmetric_theatre_photos") || "[]").filter(p => p.user_id === userId);
      const corrections = JSON.parse(localStorage.getItem("filmetric_corrections") || "[]").filter(c => c.user_id === userId);
      const submissions = JSON.parse(localStorage.getItem("filmetric_screen_submissions") || "[]").filter(s => s.user_id === userId);
      return {
        reviews: ratings,
        photos: photos,
        corrections: corrections,
        submissions: submissions
      };
    }
  }

  function getTheatreName(theatreId) {
    const intl = window.DB.intlImax.map(r => fromIntlImax(r));
    const all  = [...window.DB.allScreens, ...intl];
    const s = all.find(sc => sc.id === theatreId);
    return s ? `${s.name} (${s.city})` : `Theatre #${theatreId}`;
  }

  function showEditReviewModal(reviewId, theatreId, currentRating, currentReview) {
    const el = document.createElement("div");
    el.className = "modal-backdrop";
    el.innerHTML = `
      <div class="modal" style="max-width:380px;">
        <div class="modal-header">
          <div class="modal-title">Edit Review</div>
          <button class="icon-btn" id="edit-review-close">
            <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <path d="M18 6 6 18M6 6l12 12"/>
            </svg>
          </button>
        </div>
        <div style="padding:1.5rem; display:flex; flex-direction:column; gap:0.75rem;">
          <div style="display:flex; gap:0.5rem; align-items:center;">
            <span style="font-size:0.75rem; color:var(--text-2);">Rating:</span>
            <select id="edit-rating-select" class="form-input" style="width:auto; padding:0.25rem 0.5rem; font-size:0.8rem;">
              <option value="5" ${currentRating === 5 ? "selected" : ""}>⭐⭐⭐⭐⭐ (5/5)</option>
              <option value="4" ${currentRating === 4 ? "selected" : ""}>⭐⭐⭐⭐ (4/5)</option>
              <option value="3" ${currentRating === 3 ? "selected" : ""}>⭐⭐⭐ (3/5)</option>
              <option value="2" ${currentRating === 2 ? "selected" : ""}>⭐⭐ (2/5)</option>
              <option value="1" ${currentRating === 1 ? "selected" : ""}>⭐ (1/5)</option>
            </select>
          </div>
          <textarea id="edit-review-text" class="form-input" style="height:64px; font-size:0.8rem; padding:0.5rem; resize:none;" placeholder="Write your thoughts about this screen (optional)...">${escapeHtml(currentReview || "")}</textarea>
          <div id="edit-review-error" class="form-error" style="color:#FF7B72; font-size:0.75rem; min-height:1rem;"></div>
          <div style="display:flex; justify-content:flex-end; gap:0.5rem; margin-top:0.5rem;">
            <button id="edit-review-cancel" class="btn btn-ghost btn-sm">Cancel</button>
            <button id="edit-review-submit-btn" class="btn btn-primary btn-sm">Save Changes</button>
          </div>
        </div>
      </div>`;

    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add("open"));
    const close = () => { el.classList.remove("open"); setTimeout(() => el.remove(), 200); };
    
    document.getElementById("edit-review-close")?.addEventListener("click", close);
    document.getElementById("edit-review-cancel")?.addEventListener("click", close);

    document.getElementById("edit-review-submit-btn")?.addEventListener("click", async () => {
      const rating = parseInt(document.getElementById("edit-rating-select").value);
      const text = document.getElementById("edit-review-text").value.trim();
      const errEl = document.getElementById("edit-review-error");
      try {
        await addOrUpdateReview(theatreId, rating, text);
        showToast("Review updated successfully!");
        close();
        renderProfileView();
      } catch (e) {
        errEl.textContent = e.message || "Failed to update review.";
      }
    });
  }

  function renderProfileView() {
    if (!currentUser) {
      renderLayout(`
        <div class="container" style="padding:6rem 0;text-align:center;">
          <div class="section-label" style="margin-bottom:1rem;">Account</div>
          <h2 style="font-size:1.5rem;font-weight:600;color:var(--text);margin-bottom:0.75rem;">Sign in to Filmetric</h2>
          <p style="font-size:0.875rem;color:var(--text-2);margin-bottom:2rem;">Create an account to save favorites and personalize your experience.</p>
          <button class="btn btn-primary auth-trigger-btn">Login or Sign Up</button>
        </div>`);
      document.querySelectorAll(".auth-trigger-btn").forEach(b => b.addEventListener("click", showAuthModal));
      return;
    }

    const hash = window.location.hash || "#/";
    const qi = hash.indexOf("?");
    const qp = qi !== -1 ? new URLSearchParams(hash.substring(qi)) : new URLSearchParams();
    const activeTab = qp.get("tab") || "reviews";

    const initials = (currentUser.username || "?").substring(0, 2).toUpperCase();
    const avatar = currentUser.avatarUrl
      ? `<img src="${currentUser.avatarUrl}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">`
      : initials;

    renderLayout(`
      <div class="container profile-page">
        <div style="display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:1.5rem; border-bottom: 1px solid var(--border); padding-bottom: 2rem; margin-bottom: 2rem;">
          <div class="profile-header" style="border:none; margin:0; padding:0;">
            <div class="profile-avatar">${avatar}</div>
            <div>
              <div class="profile-username">${currentUser.username}</div>
              <div class="profile-join">Member since ${currentUser.joinDate || "June 2026"}</div>
            </div>
          </div>
          <div style="display:flex; gap:0.75rem;">
            <button class="btn btn-ghost btn-sm" id="profile-edit-btn">Edit Profile</button>
            <button class="btn btn-ghost btn-sm" id="profile-signout">Sign Out</button>
          </div>
        </div>

        <div class="stats-grid" style="display:grid; grid-template-columns:repeat(auto-fit, minmax(120px, 1fr)); gap:1rem; margin-bottom:2rem;" id="profile-stats-container">
          <div class="specs-card" style="padding:1.25rem; text-align:center;">
            <div style="font-size:0.7rem; color:var(--text-3); text-transform:uppercase; font-family:'JetBrains Mono', monospace; margin-bottom:0.25rem;">Reviews</div>
            <div style="font-size:1.8rem; font-weight:600; color:var(--text);" id="stats-reviews-count">0</div>
          </div>
          <div class="specs-card" style="padding:1.25rem; text-align:center;">
            <div style="font-size:0.7rem; color:var(--text-3); text-transform:uppercase; font-family:'JetBrains Mono', monospace; margin-bottom:0.25rem;">Photos</div>
            <div style="font-size:1.8rem; font-weight:600; color:var(--text);" id="stats-photos-count">0</div>
          </div>
          <div class="specs-card" style="padding:1.25rem; text-align:center;">
            <div style="font-size:0.7rem; color:var(--text-3); text-transform:uppercase; font-family:'JetBrains Mono', monospace; margin-bottom:0.25rem;">Corrections</div>
            <div style="font-size:1.8rem; font-weight:600; color:var(--text);" id="stats-corrections-count">0</div>
          </div>
          <div class="specs-card" style="padding:1.25rem; text-align:center;">
            <div style="font-size:0.7rem; color:var(--text-3); text-transform:uppercase; font-family:'JetBrains Mono', monospace; margin-bottom:0.25rem;">Submissions</div>
            <div style="font-size:1.8rem; font-weight:600; color:var(--text);" id="stats-submissions-count">0</div>
          </div>
        </div>

        <div class="modal-tabs" style="margin-bottom:2rem;">
          <a href="#/profile?tab=reviews" class="modal-tab ${activeTab === 'reviews' ? 'active' : ''}" style="text-decoration:none; text-align:center; display:block; padding:0.75rem 0;">Reviews</a>
          <a href="#/profile?tab=contributions" class="modal-tab ${activeTab === 'contributions' ? 'active' : ''}" style="text-decoration:none; text-align:center; display:block; padding:0.75rem 0;">Photos & Corrections</a>
          <a href="#/profile?tab=submissions" class="modal-tab ${activeTab === 'submissions' ? 'active' : ''}" style="text-decoration:none; text-align:center; display:block; padding:0.75rem 0;">Missing Screens</a>
        </div>

        <div id="profile-tab-content">
          <p style="text-align:center; color:var(--text-3); padding:3rem 0; font-size:0.9rem;">Loading contributions...</p>
        </div>
      </div>
    `);

    document.getElementById("profile-signout")?.addEventListener("click", showSignOutModal);
    document.getElementById("profile-edit-btn")?.addEventListener("click", showEditProfileModal);

    fetchUserContributions(currentUser.id).then(data => {
      const reviewsCount = document.getElementById("stats-reviews-count");
      const photosCount = document.getElementById("stats-photos-count");
      const correctionsCount = document.getElementById("stats-corrections-count");
      const submissionsCount = document.getElementById("stats-submissions-count");

      if (reviewsCount) reviewsCount.textContent = data.reviews.length;
      if (photosCount) photosCount.textContent = data.photos.length;
      if (correctionsCount) correctionsCount.textContent = data.corrections.length;
      if (submissionsCount) submissionsCount.textContent = data.submissions.length;

      const contentEl = document.getElementById("profile-tab-content");
      if (!contentEl) return;

      if (activeTab === "reviews") {
        if (data.reviews.length === 0) {
          contentEl.innerHTML = `
            <div style="text-align:center; padding:3rem 1.5rem; color:var(--text-3); font-size:0.875rem;">
              You have not submitted any reviews yet.
            </div>`;
        } else {
          contentEl.innerHTML = `
            <div style="display:flex; flex-direction:column; gap:1.5rem;">
              ${data.reviews.map(r => {
                const stars = "★".repeat(r.rating) + "☆".repeat(5 - r.rating);
                return `
                  <div class="specs-card" style="padding:1.5rem;">
                    <div style="display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:0.5rem; margin-bottom:0.75rem;">
                      <div>
                        <a href="#/screen/${r.theatre_id}" style="font-size:1rem; font-weight:600; color:var(--text); text-decoration:none; transition:color var(--t) var(--ease);">${getTheatreName(r.theatre_id)}</a>
                        <div style="font-size:0.75rem; color:var(--cream); margin-top:2px;">${stars}</div>
                      </div>
                      <div style="display:flex; gap:0.5rem;">
                        <button class="btn btn-ghost btn-sm edit-review-action" data-review-id="${r.id}" data-theatre-id="${r.theatre_id}" data-rating="${r.rating}" data-review="${escapeHtml(r.review || '')}">Edit</button>
                        <button class="btn btn-ghost btn-sm delete-review-action" data-review-id="${r.id}" data-theatre-id="${r.theatre_id}" style="color:#FF7B72; border-color:rgba(255,123,114,0.15);">Delete</button>
                      </div>
                    </div>
                    <p style="font-size:0.85rem; color:var(--text-2); line-height:1.5;">${escapeHtml(r.review || "No written review text.")}</p>
                    <div style="font-size:0.65rem; color:var(--text-3); margin-top:0.75rem;">Reviewed on ${new Date(r.created_at).toLocaleDateString()}</div>
                  </div>`;
              }).join("")}
            </div>`;

          contentEl.querySelectorAll(".delete-review-action").forEach(btn => {
            btn.addEventListener("click", async () => {
              if (confirm("Are you sure you want to delete this review?")) {
                try {
                  await deleteReview(btn.dataset.reviewId, btn.dataset.theatreId);
                  showToast("Review deleted.");
                  renderProfileView();
                } catch (e) {
                  showToast("Failed to delete review: " + e.message);
                }
              }
            });
          });

          contentEl.querySelectorAll(".edit-review-action").forEach(btn => {
            btn.addEventListener("click", () => {
              const rId = btn.dataset.reviewId;
              const tId = btn.dataset.theatreId;
              const oldRating = parseInt(btn.dataset.rating);
              const oldReview = btn.dataset.review;
              showEditReviewModal(rId, tId, oldRating, oldReview);
            });
          });
        }
      } else if (activeTab === "contributions") {
        const photoSection = `
          <div class="specs-card" style="margin-bottom:2rem;">
            <div class="specs-card-header"><div class="specs-card-title">Submitted Photos</div></div>
            <div style="padding:1.5rem;">
              ${data.photos.length === 0 ? `
                <p style="font-size:0.85rem; color:var(--text-3); text-align:center;">No photos submitted yet.</p>
              ` : `
                <div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(180px, 1fr)); gap:1rem;">
                  ${data.photos.map(p => `
                    <div style="border-radius:var(--r-md); overflow:hidden; border:1px solid var(--border); background:#000; position:relative;">
                      <img src="${p.image_url}" style="width:100%; height:120px; object-fit:cover; display:block; cursor:pointer;" onclick="window.open('${p.image_url}', '_blank')">
                      <div style="padding:0.5rem; font-size:0.75rem; display:flex; justify-content:space-between; align-items:center; background:var(--surface);">
                        <a href="#/screen/${p.theatre_id}" style="color:var(--text-2); text-decoration:none; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:60%;">Screen Info</a>
                        <span style="font-size:0.65rem; padding:1px 6px; border-radius:3px; font-weight:500; text-transform:uppercase; ${p.approved ? 'color:#7EE787; background:rgba(126,231,135,0.1);' : 'color:#D2A8FF; background:rgba(210,168,255,0.1);'}">${p.approved ? 'Approved' : 'Pending'}</span>
                      </div>
                    </div>`).join("")}
                </div>
              `}
            </div>
          </div>`;

        const correctionSection = `
          <div class="specs-card">
            <div class="specs-card-header"><div class="specs-card-title">Submitted Corrections</div></div>
            <div style="padding:1.5rem;">
              ${data.corrections.length === 0 ? `
                <p style="font-size:0.85rem; color:var(--text-3); text-align:center;">No corrections submitted yet.</p>
              ` : `
                <div style="display:flex; flex-direction:column; gap:1rem;">
                  ${data.corrections.map(c => `
                    <div class="spec-row" style="display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:0.5rem; padding-bottom:1rem; border-bottom:1px solid var(--border); margin:0;">
                      <div style="text-align:left;">
                        <div style="font-size:0.85rem; font-weight:600;"><a href="#/screen/${c.theatre_id}" style="color:inherit; text-decoration:none;">${getTheatreName(c.theatre_id)}</a></div>
                        <div style="font-size:0.75rem; color:var(--text-2); margin-top:2px;">Field: <span style="color:var(--cream);">${c.field_name}</span> &middot; Proposed: "${c.proposed_value}"</div>
                        ${c.comment ? `<div style="font-size:0.75rem; color:var(--text-3); font-style:italic; margin-top:4px;">"${escapeHtml(c.comment)}"</div>` : ''}
                      </div>
                      <span style="font-size:0.65rem; padding:2px 8px; border-radius:3px; font-weight:500; text-transform:uppercase; ${c.status === 'Approved' ? 'color:#7EE787; background:rgba(126,231,135,0.1);' : c.status === 'Rejected' ? 'color:#FF7B72; background:rgba(255,123,114,0.1);' : 'color:#D2A8FF; background:rgba(210,168,255,0.1);'}">${c.status}</span>
                    </div>`).join("")}
                </div>
              `}
            </div>
          </div>`;

        contentEl.innerHTML = photoSection + correctionSection;
      } else if (activeTab === "submissions") {
        if (data.submissions.length === 0) {
          contentEl.innerHTML = `
            <div style="text-align:center; padding:3rem 1.5rem; color:var(--text-3); font-size:0.875rem;">
              You have not submitted any missing screens yet.
            </div>`;
        } else {
          contentEl.innerHTML = `
            <div class="specs-card">
              <div class="specs-card-header"><div class="specs-card-title">Missing Screen Submissions</div></div>
              <div style="padding:1.5rem;">
                <div style="display:flex; flex-direction:column; gap:1rem;">
                  ${data.submissions.map(s => `
                    <div class="spec-row" style="display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:0.5rem; padding-bottom:1rem; border-bottom:1px solid var(--border); margin:0;">
                      <div style="text-align:left;">
                        <div style="font-size:0.85rem; font-weight:600; color:var(--text);">${s.theatre_name}</div>
                        <div style="font-size:0.75rem; color:var(--text-2); margin-top:2px;">City: ${s.city} &middot; Format: ${s.format} &middot; Projection: ${s.projection || 'Unknown'}</div>
                        <div style="font-size:0.65rem; color:var(--text-3); margin-top:4px;">Submitted on ${new Date(s.created_at).toLocaleDateString()}</div>
                      </div>
                      <span style="font-size:0.65rem; padding:2px 8px; border-radius:3px; font-weight:500; text-transform:uppercase; ${s.status === 'Approved' ? 'color:#7EE787; background:rgba(126,231,135,0.1);' : s.status === 'Rejected' ? 'color:#FF7B72; background:rgba(255,123,114,0.1);' : 'color:#D2A8FF; background:rgba(210,168,255,0.1);'}">${s.status}</span>
                    </div>`).join("")}
                </div>
              </div>
            </div>`;
        }
      }
    });
  }

  // ── SETTINGS VIEW ─────────────────────────────────────
  function renderSettingsView() {
    renderLayout(`
      <div class="container" style="max-width:640px;padding:3rem var(--gutter);">
        <div class="page-header">
          <div class="section-label">Configuration</div>
          <h1 class="page-title" style="font-size:1.8rem;">Settings</h1>
        </div>

        ${currentUser ? `
          <div class="specs-card">
            <div class="specs-card-header"><div class="specs-card-title">Account</div></div>
            <div style="padding:1.5rem;">
              <div style="font-size:0.875rem;color:var(--text-2);margin-bottom:1.25rem;">Signed in as <strong style="color:var(--text);">${currentUser.email}</strong></div>
              <button class="btn btn-ghost btn-sm" id="settings-signout">Sign Out</button>
            </div>
          </div>` : `
          <div class="specs-card">
            <div class="specs-card-header"><div class="specs-card-title">Account</div></div>
            <div style="padding:1.5rem;">
              <p style="font-size:0.8rem;color:var(--text-2);margin-bottom:1.25rem;">Sign in to sync your preferences.</p>
              <button class="btn btn-primary btn-sm auth-trigger-btn">Login</button>
            </div>
          </div>`}
      </div>`);

    document.getElementById("settings-signout")?.addEventListener("click", showSignOutModal);
    document.querySelectorAll(".auth-trigger-btn").forEach(b => b.addEventListener("click", showAuthModal));
  }

  // ── ABOUT VIEW ────────────────────────────────────────
  function renderAboutView() {
    renderLayout(`
      <div class="container" style="max-width:680px;padding:5rem var(--gutter);">
        <div class="section-label" style="margin-bottom:1.5rem;">About</div>
        <h1 style="font-family:'Playfair Display',serif;font-size:clamp(2rem,4vw,3rem);font-style:italic;font-weight:600;color:var(--cream);line-height:1.15;margin-bottom:2rem;">
          Find the Best Screen<br>for Every Movie.
        </h1>
        <p style="font-size:0.95rem;color:var(--text-2);line-height:1.8;margin-bottom:1.5rem;">
          Filmetric is a cinema discovery platform built for movie enthusiasts who care about the theatrical experience.
        </p>
        <p style="font-size:0.95rem;color:var(--text-2);line-height:1.8;margin-bottom:1.5rem;">
          We catalog premium cinema screens across India and around the world, including IMAX, Dolby Cinema, PLF, EPIQ, ScreenX, Samsung Onyx, and other advanced exhibition formats.
        </p>
        <p style="font-size:0.95rem;color:var(--text-2);line-height:1.8;margin-bottom:1.5rem;">
          Our mission is to help moviegoers make informed decisions about where to watch a film by providing technical screen specifications, projection details, aspect ratios, rankings, and format comparisons.
        </p>
        <p style="font-size:0.95rem;color:var(--text-2);line-height:1.8;margin-bottom:2.5rem;">
          Filmetric combines technical cinema data with community-driven insights to create a reliable resource for discovering exceptional movie experiences.
        </p>
        <p style="font-size:0.8rem;color:var(--text-3);line-height:1.6;border-top:1px solid var(--border);padding-top:1.5rem;">
          Filmetric is an independent project and is not affiliated with IMAX Corporation, Dolby Laboratories, PVR INOX, Cinepolis, or any theatre chain unless explicitly stated.
        </p>
      </div>`);
  }

  // ── PRIVACY VIEW ──────────────────────────────────────
  function renderPrivacyView() {
    setMeta({
      title: "Privacy Policy | Filmetric",
      description: "Read the Privacy Policy for the Filmetric cinema discovery platform.",
      canonicalPath: "#/privacy"
    });
    renderLayout(`
      <div class="container" style="max-width:680px;padding:5rem var(--gutter);">
        <div class="section-label" style="margin-bottom:1.5rem;">Legal</div>
        <h1 class="page-title" style="margin-bottom:0.5rem;font-size:2.2rem;font-weight:600;color:var(--cream);">Privacy Policy</h1>
        <div style="font-size:0.75rem;font-family:'JetBrains Mono',monospace;text-transform:uppercase;color:var(--text-3);letter-spacing:0.05em;margin-bottom:3rem;">Last Updated: June 2026</div>

        <div style="display:flex;flex-direction:column;gap:2.5rem;">
          <div>
            <h2 style="font-size:1.1rem;font-weight:600;color:var(--text);margin-bottom:0.75rem;">Information We Collect</h2>
            <p style="font-size:0.875rem;color:var(--text-2);line-height:1.7;margin-bottom:0.75rem;">We may collect:</p>
            <ul style="font-size:0.875rem;color:var(--text-2);line-height:1.8;padding-left:1.25rem;list-style-type:disc;">
              <li>Email address</li>
              <li>Username</li>
              <li>Profile image (when provided through sign-in providers)</li>
              <li>Reviews, ratings, photos, and submissions made on the platform</li>
            </ul>
          </div>

          <div>
            <h2 style="font-size:1.1rem;font-weight:600;color:var(--text);margin-bottom:0.75rem;">Location Information</h2>
            <p style="font-size:0.875rem;color:var(--text-2);line-height:1.7;">
              If users choose to enable location access, Filmetric may use location data to help discover nearby cinema screens and improve location-based features. Location information is used only for platform functionality.
            </p>
          </div>

          <div>
            <h2 style="font-size:1.1rem;font-weight:600;color:var(--text);margin-bottom:0.75rem;">Cookies and Local Storage</h2>
            <p style="font-size:0.875rem;color:var(--text-2);line-height:1.7;margin-bottom:0.75rem;">Filmetric may use cookies, browser storage, and similar technologies to:</p>
            <ul style="font-size:0.875rem;color:var(--text-2);line-height:1.8;padding-left:1.25rem;list-style-type:disc;">
              <li>Maintain login sessions</li>
              <li>Save preferences</li>
              <li>Improve functionality</li>
            </ul>
          </div>

          <div>
            <h2 style="font-size:1.1rem;font-weight:600;color:var(--text);margin-bottom:0.75rem;">Data Sharing</h2>
            <p style="font-size:0.875rem;color:var(--text-2);line-height:1.7;margin-bottom:0.75rem;">
              Filmetric does not sell personal information. We do not share personal information with advertisers, marketers, or unrelated third parties. Personal information is not sold or shared with third parties for advertising or marketing purposes.
            </p>
            <p style="font-size:0.875rem;color:var(--text-2);line-height:1.7;">
              Personal information is only processed when necessary to operate the platform and provide requested features.
            </p>
          </div>

          <div>
            <h2 style="font-size:1.1rem;font-weight:600;color:var(--text);margin-bottom:0.75rem;">User Content</h2>
            <p style="font-size:0.875rem;color:var(--text-2);line-height:1.7;">
              Reviews, ratings, photos, and submissions may be publicly visible on Filmetric.
            </p>
          </div>

          <div>
            <h2 style="font-size:1.1rem;font-weight:600;color:var(--text);margin-bottom:0.75rem;">Account Deletion</h2>
            <p style="font-size:0.875rem;color:var(--text-2);line-height:1.7;">
              Users may request deletion of their account and associated personal information.
            </p>
          </div>

          <div>
            <h2 style="font-size:1.1rem;font-weight:600;color:var(--text);margin-bottom:0.75rem;">Contact</h2>
            <p style="font-size:0.875rem;color:var(--text-2);line-height:1.7;">
              For any privacy inquiries, contact us at: <a href="mailto:contact@filmetric.com" style="color:var(--cream);text-decoration:none;border-bottom:1px solid var(--border-hover);padding-bottom:1px;">contact@filmetric.com</a>.
            </p>
          </div>
        </div>
      </div>`);
  }

  // ── TERMS VIEW ────────────────────────────────────────
  function renderTermsView() {
    setMeta({
      title: "Terms of Service | Filmetric",
      description: "Read the Terms of Service for using the Filmetric cinema discovery platform.",
      canonicalPath: "#/terms"
    });
    renderLayout(`
      <div class="container" style="max-width:680px;padding:5rem var(--gutter);">
        <div class="section-label" style="margin-bottom:1.5rem;">Legal</div>
        <h1 class="page-title" style="margin-bottom:0.5rem;font-size:2.2rem;font-weight:600;color:var(--cream);">Terms of Service</h1>
        <div style="font-size:0.75rem;font-family:'JetBrains Mono',monospace;text-transform:uppercase;color:var(--text-3);letter-spacing:0.05em;margin-bottom:3rem;">Last Updated: June 2026</div>

        <div style="display:flex;flex-direction:column;gap:2.5rem;">
          <div>
            <h2 style="font-size:1.1rem;font-weight:600;color:var(--text);margin-bottom:0.75rem;">Using Filmetric</h2>
            <p style="font-size:0.875rem;color:var(--text-2);line-height:1.7;">
              Filmetric is provided to help users discover and compare cinema experiences.
            </p>
          </div>

          <div>
            <h2 style="font-size:1.1rem;font-weight:600;color:var(--text);margin-bottom:0.75rem;">User Accounts</h2>
            <p style="font-size:0.875rem;color:var(--text-2);line-height:1.7;">
              Users are responsible for maintaining the security of their accounts.
            </p>
          </div>

          <div>
            <h2 style="font-size:1.1rem;font-weight:600;color:var(--text);margin-bottom:0.75rem;">Community Contributions</h2>
            <p style="font-size:0.875rem;color:var(--text-2);line-height:1.7;margin-bottom:0.75rem;">Users may submit:</p>
            <ul style="font-size:0.875rem;color:var(--text-2);line-height:1.8;padding-left:1.25rem;list-style-type:disc;margin-bottom:0.75rem;">
              <li>Reviews</li>
              <li>Ratings</li>
              <li>Photos</li>
              <li>Corrections</li>
              <li>Missing screen information</li>
            </ul>
            <p style="font-size:0.875rem;color:var(--text-2);line-height:1.7;">
              Filmetric reserves the right to review, approve, reject, edit, or remove submissions.
            </p>
          </div>

          <div>
            <h2 style="font-size:1.1rem;font-weight:600;color:var(--text);margin-bottom:0.75rem;">User Content</h2>
            <p style="font-size:0.875rem;color:var(--text-2);line-height:1.7;">
              Users retain ownership of content they submit. By submitting content, users grant Filmetric permission to display and use that content within the platform.
            </p>
          </div>

          <div>
            <h2 style="font-size:1.1rem;font-weight:600;color:var(--text);margin-bottom:0.75rem;">Accuracy Disclaimer</h2>
            <p style="font-size:0.875rem;color:var(--text-2);line-height:1.7;">
              Cinema specifications and theatre information may change over time. While Filmetric strives for accuracy, information should be independently verified when necessary.
            </p>
          </div>

          <div>
            <h2 style="font-size:1.1rem;font-weight:600;color:var(--text);margin-bottom:0.75rem;">Prohibited Content</h2>
            <p style="font-size:0.875rem;color:var(--text-2);line-height:1.7;margin-bottom:0.75rem;">Users may not:</p>
            <ul style="font-size:0.875rem;color:var(--text-2);line-height:1.8;padding-left:1.25rem;list-style-type:disc;">
              <li>Submit false information</li>
              <li>Upload copyrighted content they do not own</li>
              <li>Upload harmful or abusive content</li>
              <li>Attempt to misuse the platform</li>
            </ul>
          </div>

          <div>
            <h2 style="font-size:1.1rem;font-weight:600;color:var(--text);margin-bottom:0.75rem;">Limitation of Liability</h2>
            <p style="font-size:0.875rem;color:var(--text-2);line-height:1.7;">
              Filmetric is provided on an "as is" basis without warranties of any kind.
            </p>
          </div>

          <div>
            <h2 style="font-size:1.1rem;font-weight:600;color:var(--text);margin-bottom:0.75rem;">Changes</h2>
            <p style="font-size:0.875rem;color:var(--text-2);line-height:1.7;">
              These terms may be updated periodically. Continued use of Filmetric constitutes acceptance of updated terms.
            </p>
          </div>
        </div>
      </div>`);
  }

  // ── AUTH MODAL ────────────────────────────────────────
  // ── AUTH MODAL ────────────────────────────────────────
  function showAuthModal() {
    const existing = document.getElementById("auth-modal-backdrop");
    if (existing) existing.remove();

    const el = document.createElement("div");
    el.id = "auth-modal-backdrop";
    el.className = "modal-backdrop";
    el.innerHTML = `
      <div class="modal" id="auth-modal" style="max-width: 400px;">
        <div class="modal-header">
          <div class="modal-title">Join Filmetric</div>
          <button class="icon-btn" id="modal-close" aria-label="Close modal">
            <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <path d="M18 6 6 18M6 6l12 12"/>
            </svg>
          </button>
        </div>
        
        <div style="padding: 1.5rem 1.5rem 0.5rem 1.5rem;">
          <button class="btn btn-full" id="google-signin-btn" style="display: flex; align-items: center; justify-content: center; gap: 0.5rem; background: #ffffff !important; color: #111111 !important; font-weight: 600; border: 1px solid #ffffff; transition: opacity var(--t) var(--ease);">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" fill="#FBBC05"/>
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
            </svg>
            Continue with Google
          </button>
          
          <div style="display: flex; align-items: center; text-align: center; margin: 1.25rem 0; color: var(--text-3); font-size: 0.75rem; font-family: 'JetBrains Mono', monospace; letter-spacing: 0.1em; text-transform: uppercase;">
            <span style="flex: 1; border-bottom: 1px solid var(--border);"></span>
            <span style="padding: 0 10px;">OR</span>
            <span style="flex: 1; border-bottom: 1px solid var(--border);"></span>
          </div>
        </div>

        <div class="modal-tabs">
          <button class="modal-tab active" data-tab="login">Login</button>
          <button class="modal-tab" data-tab="signup">Sign Up</button>
        </div>
        
        <div id="tab-login" style="padding: 1.5rem;">
          <div class="form-group">
            <label class="form-label" for="login-email">Email</label>
            <input type="email" id="login-email" class="form-input" placeholder="you@example.com" autocomplete="email">
          </div>
          <div class="form-group">
            <label class="form-label" for="login-password">Password</label>
            <input type="password" id="login-password" class="form-input" placeholder="Password" autocomplete="current-password">
          </div>
          <div id="login-error" class="form-error" style="color: #FF7B72; font-size: 0.75rem; margin-top: 0.5rem; min-height: 1rem;"></div>
          <button class="btn btn-primary btn-full mt-2" id="login-btn">
            <span class="btn-text">Login</span>
          </button>
        </div>
        
        <div id="tab-signup" class="hidden" style="padding: 1.5rem;">
          <div class="form-group">
            <label class="form-label" for="signup-username">Username</label>
            <input type="text" id="signup-username" class="form-input" placeholder="your_username">
          </div>
          <div class="form-group">
            <label class="form-label" for="signup-email">Email</label>
            <input type="email" id="signup-email" class="form-input" placeholder="you@example.com" autocomplete="email">
          </div>
          <div class="form-group">
            <label class="form-label" for="signup-password">Password</label>
            <input type="password" id="signup-password" class="form-input" placeholder="Min 8 characters" autocomplete="new-password">
          </div>
          <div id="signup-error" class="form-error" style="color: #FF7B72; font-size: 0.75rem; margin-top: 0.5rem; min-height: 1rem;"></div>
          <button class="btn btn-primary btn-full mt-2" id="signup-btn">
            <span class="btn-text">Create Account</span>
          </button>
        </div>
      </div>`;

    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add("open"));

    const close = () => { el.classList.remove("open"); setTimeout(() => el.remove(), 200); };
    el.addEventListener("click", e => { if (e.target === el) close(); });
    document.getElementById("modal-close")?.addEventListener("click", close);

    el.querySelectorAll(".modal-tab").forEach(tab => {
      tab.addEventListener("click", () => {
        el.querySelectorAll(".modal-tab").forEach(t => t.classList.remove("active"));
        tab.classList.add("active");
        const which = tab.dataset.tab;
        document.getElementById("tab-login").classList.toggle("hidden", which !== "login");
        document.getElementById("tab-signup").classList.toggle("hidden", which !== "signup");
      });
    });

    document.getElementById("google-signin-btn")?.addEventListener("click", async () => {
      const btn = document.getElementById("google-signin-btn");
      btn.disabled = true;
      btn.innerHTML = `<span style="color:#111111 !important;">Connecting...</span>`;
      try {
        await authSignInWithGoogle();
        if (!supabase) { close(); showToast("Logged in via Google (mock)!"); resolveRoute(); }
      } catch (e) {
        btn.disabled = false;
        btn.innerHTML = `
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" fill="#FBBC05"/>
            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
          </svg>
          Continue with Google`;
        const errEl = document.getElementById("login-error") || document.getElementById("signup-error");
        if (errEl) errEl.textContent = e.message || "Google login failed.";
      }
    });

    document.getElementById("login-btn")?.addEventListener("click", async () => {
      const email = document.getElementById("login-email").value.trim();
      const pass  = document.getElementById("login-password").value;
      const errEl = document.getElementById("login-error");
      const btn = document.getElementById("login-btn");
      errEl.textContent = "";
      btn.disabled = true;
      btn.textContent = "Logging in...";
      try {
        await authSignIn(email, pass);
        close();
        showToast("Welcome back!");
        resolveRoute();
      } catch (e) {
        btn.disabled = false;
        btn.textContent = "Login";
        errEl.textContent = e.message || "Login failed.";
      }
    });

    document.getElementById("signup-btn")?.addEventListener("click", async () => {
      const username = document.getElementById("signup-username").value.trim();
      const email    = document.getElementById("signup-email").value.trim();
      const pass     = document.getElementById("signup-password").value;
      const errEl    = document.getElementById("signup-error");
      const btn = document.getElementById("signup-btn");
      errEl.textContent = "";
      if (!username) { errEl.textContent = "Username is required."; return; }
      if (pass.length < 8) { errEl.textContent = "Password must be at least 8 characters."; return; }
      btn.disabled = true;
      btn.textContent = "Creating Account...";
      try {
        await authSignUp(email, pass, username);
        close();
        showToast("Account created. Welcome!");
        resolveRoute();
      } catch (e) {
        btn.disabled = false;
        btn.textContent = "Create Account";
        errEl.textContent = e.message || "Sign up failed.";
      }
    });
  }

  function showSignOutModal() {
    const el = document.createElement("div");
    el.className = "modal-backdrop";
    el.innerHTML = `
      <div class="modal" style="max-width:360px;">
        <div class="modal-header"><div class="modal-title">Sign Out</div></div>
        <p style="font-size:0.875rem;color:var(--text-2);margin-bottom:1.5rem;">Are you sure you want to sign out?</p>
        <div style="display:flex;gap:0.75rem;">
          <button class="btn btn-primary" id="confirm-signout">Sign Out</button>
          <button class="btn btn-ghost" id="cancel-signout">Cancel</button>
        </div>
      </div>`;

    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add("open"));
    const close = () => { el.classList.remove("open"); setTimeout(() => el.remove(), 200); };
    document.getElementById("cancel-signout")?.addEventListener("click", close);
    document.getElementById("confirm-signout")?.addEventListener("click", async () => {
      close(); await authSignOut(); showToast("Signed out."); navigate("#/");
    });
  }

  // ── Community Submission & Modification Modals ──────────
  function showCorrectionModal(theatreId) {
    if (!currentUser) { showAuthModal(); return; }
    const el = document.createElement("div");
    el.className = "modal-backdrop";
    el.innerHTML = `
      <div class="modal" style="max-width:380px;">
        <div class="modal-header">
          <div class="modal-title">Submit Correction</div>
          <button class="icon-btn" id="correction-close">
            <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <path d="M18 6 6 18M6 6l12 12"/>
            </svg>
          </button>
        </div>
        <div style="padding:1.5rem;">
          <div class="form-group">
            <label class="form-label">Field requiring correction</label>
            <select id="correction-field" class="form-input">
              <option value="Format">Format (IMAX, Dolby Cinema, PLF, etc)</option>
              <option value="Projection">Projection Type</option>
              <option value="Aspect Ratio">Aspect Ratio</option>
              <option value="Dimensions">Dimensions / Screen Size</option>
              <option value="Seating Capacity">Seating Capacity</option>
              <option value="GPS Coordinates">GPS Coordinates</option>
              <option value="Other">Other details</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Proposed Value</label>
            <input type="text" id="correction-value" class="form-input" placeholder="e.g. 1.43:1, 450 seats, etc.">
          </div>
          <div class="form-group">
            <label class="form-label">Explanation / Comment</label>
            <textarea id="correction-comment" class="form-input" style="height:64px; resize:none;" placeholder="Provide any source or reference notes..."></textarea>
          </div>
          <div id="correction-error" class="form-error" style="color:#FF7B72; font-size:0.75rem; margin-top:0.5rem; min-height:1rem;"></div>
          <button class="btn btn-primary btn-full mt-2" id="correction-submit-btn">Submit Correction</button>
        </div>
      </div>`;

    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add("open"));
    const close = () => { el.classList.remove("open"); setTimeout(() => el.remove(), 200); };
    document.getElementById("correction-close")?.addEventListener("click", close);

    document.getElementById("correction-submit-btn")?.addEventListener("click", async () => {
      const field = document.getElementById("correction-field").value;
      const val = document.getElementById("correction-value").value.trim();
      const comment = document.getElementById("correction-comment").value.trim();
      const errEl = document.getElementById("correction-error");
      if (!val) { errEl.textContent = "Proposed value is required."; return; }

      const correctionData = {
        id: crypto.randomUUID ? crypto.randomUUID() : `c-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        theatre_id: theatreId,
        user_id: currentUser.id,
        field_name: field,
        proposed_value: val,
        comment: comment,
        status: "Pending",
        created_at: new Date().toISOString()
      };

      try {
        if (supabase) {
          const { error } = await supabase
            .from('corrections')
            .insert(correctionData);
          if (error) throw error;
        } else {
          const all = JSON.parse(localStorage.getItem("filmetric_corrections") || "[]");
          all.push(correctionData);
          localStorage.setItem("filmetric_corrections", JSON.stringify(all));
        }
        showToast("Correction submitted successfully!");
        close();
        resolveRoute();
      } catch (e) {
        errEl.textContent = e.message || "Failed to submit correction.";
      }
    });
  }

  function showUploadPhotoModal(theatreId) {
    if (!currentUser) { showAuthModal(); return; }
    const el = document.createElement("div");
    el.className = "modal-backdrop";
    el.innerHTML = `
      <div class="modal" style="max-width:380px;">
        <div class="modal-header">
          <div class="modal-title">Upload Photo</div>
          <button class="icon-btn" id="upload-close">
            <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <path d="M18 6 6 18M6 6l12 12"/>
            </svg>
          </button>
        </div>
        <div style="padding:1.5rem;">
          <div class="form-group">
            <label class="form-label">Photo Image URL</label>
            <input type="text" id="upload-url" class="form-input" placeholder="https://example.com/theatre.jpg">
          </div>
          <div id="upload-error" class="form-error" style="color:#FF7B72; font-size:0.75rem; margin-top:0.5rem; min-height:1rem;"></div>
          <button class="btn btn-primary btn-full mt-2" id="upload-submit-btn">Submit Photo</button>
        </div>
      </div>`;

    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add("open"));
    const close = () => { el.classList.remove("open"); setTimeout(() => el.remove(), 200); };
    document.getElementById("upload-close")?.addEventListener("click", close);

    document.getElementById("upload-submit-btn")?.addEventListener("click", async () => {
      const imgUrl = document.getElementById("upload-url").value.trim();
      const errEl = document.getElementById("upload-error");
      if (!imgUrl) { errEl.textContent = "Image URL is required."; return; }
      if (!imgUrl.startsWith("http://") && !imgUrl.startsWith("https://")) { errEl.textContent = "Please enter a valid HTTP/HTTPS URL."; return; }

      const photoData = {
        id: crypto.randomUUID ? crypto.randomUUID() : `p-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        theatre_id: theatreId,
        user_id: currentUser.id,
        image_url: imgUrl,
        approved: true, // auto-approve for premium look
        created_at: new Date().toISOString()
      };

      try {
        if (supabase) {
          const { error } = await supabase
            .from('theatre_photos')
            .insert(photoData);
          if (error) throw error;
        } else {
          const all = JSON.parse(localStorage.getItem("filmetric_theatre_photos") || "[]");
          all.push(photoData);
          localStorage.setItem("filmetric_theatre_photos", JSON.stringify(all));
        }
        showToast("Photo uploaded successfully!");
        close();
        resolveRoute();
      } catch (e) {
        errEl.textContent = e.message || "Failed to upload photo.";
      }
    });
  }

  function showSubmitScreenModal() {
    if (!currentUser) { showAuthModal(); return; }
    const el = document.createElement("div");
    el.className = "modal-backdrop";
    el.innerHTML = `
      <div class="modal" style="max-width:380px;">
        <div class="modal-header">
          <div class="modal-title">Submit Missing Screen</div>
          <button class="icon-btn" id="submission-close">
            <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <path d="M18 6 6 18M6 6l12 12"/>
            </svg>
          </button>
        </div>
        <div style="padding:1.5rem;">
          <div class="form-group">
            <label class="form-label">Theatre Name</label>
            <input type="text" id="submission-name" class="form-input" placeholder="e.g. Broadway Megaplex">
          </div>
          <div class="form-group">
            <label class="form-label">City</label>
            <input type="text" id="submission-city" class="form-input" placeholder="e.g. Coimbatore">
          </div>
          <div class="form-group">
            <label class="form-label">Format</label>
            <select id="submission-format" class="form-input">
              <option value="IMAX">IMAX</option>
              <option value="Dolby Cinema">Dolby Cinema</option>
              <option value="PLF">PLF</option>
              <option value="EPIQ">EPIQ</option>
              <option value="Samsung Onyx">Samsung Onyx</option>
              <option value="ScreenX">ScreenX</option>
              <option value="Other">Other Premium Screen</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Projection details (if known)</label>
            <input type="text" id="submission-projection" class="form-input" placeholder="e.g. Dual 4K Laser">
          </div>
          <div id="submission-error" class="form-error" style="color:#FF7B72; font-size:0.75rem; margin-top:0.5rem; min-height:1rem;"></div>
          <button class="btn btn-primary btn-full mt-2" id="submission-submit-btn">Submit Screen</button>
        </div>
      </div>`;

    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add("open"));
    const close = () => { el.classList.remove("open"); setTimeout(() => el.remove(), 200); };
    document.getElementById("submission-close")?.addEventListener("click", close);

    document.getElementById("submission-submit-btn")?.addEventListener("click", async () => {
      const name = document.getElementById("submission-name").value.trim();
      const city = document.getElementById("submission-city").value.trim();
      const format = document.getElementById("submission-format").value;
      const projection = document.getElementById("submission-projection").value.trim();
      const errEl = document.getElementById("submission-error");
      
      if (!name || !city) { errEl.textContent = "Theatre name and city are required."; return; }

      const submissionData = {
        id: crypto.randomUUID ? crypto.randomUUID() : `s-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        user_id: currentUser.id,
        theatre_name: name,
        city: city,
        format: format,
        projection: projection,
        status: "Pending",
        created_at: new Date().toISOString()
      };

      try {
        if (supabase) {
          const { error } = await supabase
            .from('screen_submissions')
            .insert(submissionData);
          if (error) throw error;
        } else {
          const all = JSON.parse(localStorage.getItem("filmetric_screen_submissions") || "[]");
          all.push(submissionData);
          localStorage.setItem("filmetric_screen_submissions", JSON.stringify(all));
        }
        showToast("Screen submitted for verification!");
        close();
        resolveRoute();
      } catch (e) {
        errEl.textContent = e.message || "Failed to submit screen.";
      }
    });
  }

  function showEditProfileModal() {
    if (!currentUser) return;
    const el = document.createElement("div");
    el.className = "modal-backdrop";
    el.innerHTML = `
      <div class="modal" style="max-width:380px;">
        <div class="modal-header">
          <div class="modal-title">Edit Profile</div>
          <button class="icon-btn" id="edit-close">
            <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <path d="M18 6 6 18M6 6l12 12"/>
            </svg>
          </button>
        </div>
        <div style="padding:1.5rem;">
          <div class="form-group">
            <label class="form-label">Username</label>
            <input type="text" id="edit-username" class="form-input" value="${currentUser.username || ""}">
          </div>
          <div class="form-group">
            <label class="form-label">Avatar Image URL</label>
            <input type="text" id="edit-avatar" class="form-input" value="${currentUser.avatarUrl || ""}" placeholder="https://example.com/avatar.jpg">
          </div>
          <div id="edit-error" class="form-error" style="color:#FF7B72; font-size:0.75rem; margin-top:0.5rem; min-height:1rem;"></div>
          <button class="btn btn-primary btn-full mt-2" id="edit-save-btn">Save Changes</button>
        </div>
      </div>`;

    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add("open"));
    const close = () => { el.classList.remove("open"); setTimeout(() => el.remove(), 200); };
    document.getElementById("edit-close")?.addEventListener("click", close);
    
    document.getElementById("edit-save-btn")?.addEventListener("click", async () => {
      const username = document.getElementById("edit-username").value.trim();
      const avatarUrl = document.getElementById("edit-avatar").value.trim();
      const errEl = document.getElementById("edit-error");
      if (!username) { errEl.textContent = "Username is required."; return; }
      
      try {
        if (supabase) {
          const { error } = await supabase
            .from('profiles')
            .update({ username, avatar_url: avatarUrl })
            .eq('id', currentUser.id);
          if (error) throw error;
        } else {
          // Local storage mock updates
          const profiles = JSON.parse(localStorage.getItem("filmetric_profiles") || "{}");
          profiles[currentUser.email] = {
            ...profiles[currentUser.email],
            username,
            avatarUrl
          };
          localStorage.setItem("filmetric_profiles", JSON.stringify(profiles));
          
          // Sync window profiles
          const mockProfiles = JSON.parse(localStorage.getItem("filmetric_mock_profiles") || "{}");
          mockProfiles[currentUser.id] = { username, avatar_url: avatarUrl };
          localStorage.setItem("filmetric_mock_profiles", JSON.stringify(mockProfiles));
        }
        
        showToast("Profile updated successfully!");
        close();
        
        // Refresh session
        if (supabase) {
          const { data: { session } } = await supabase.auth.getSession();
          await handleAuthSession(session);
        } else {
          const saved = localStorage.getItem("filmetric_session");
          await handleAuthSession(saved ? JSON.parse(saved) : null);
        }
        resolveRoute();
      } catch (e) {
        errEl.textContent = e.message || "Failed to update profile.";
      }
    });
  }

  // ── Boot ──────────────────────────────────────────────
  loadAllData().finally(() => {
    initAuth();
    initRouter();
  });

});
