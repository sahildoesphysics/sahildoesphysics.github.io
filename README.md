# Sahil Shah — personal website

A small academic site: About, Research, Demos & visualizations, Gallery and Notes, with a Hall-staircase menu button next to the name. Plain HTML, CSS and JavaScript: no build step and no frameworks. Fonts and flags are self-hosted; the only outside request is to your own visitor-counter worker, once you set it up.

## Publish on GitHub Pages

1. Create a public repository named **`<your-username>.github.io`** on GitHub.
2. Upload everything in this folder to the root of that repository (drag and drop on github.com works, or use git):
   ```bash
   git init
   git add .
   git commit -m "Personal website"
   git branch -M main
   git remote add origin https://github.com/<your-username>/<your-username>.github.io.git
   git push -u origin main
   ```
3. In the repository, open **Settings → Pages**, set **Source** to *Deploy from a branch*, choose `main` and `/ (root)`, and save.
4. The site goes live at `https://<your-username>.github.io` within a minute or two.

Use the `<your-username>.github.io` name: the "page not found" page (`404.html`) links to `/`, which only works at the root of a domain. Everything else uses relative links.

## Files

```
index.html               About (home page)
research.html            Research interests and projects
demos.html               Demos and visualizations (the quantum Hall simulation)
gallery.html             Postcards from the cleanroom
notes.html               Notes (under construction)
404.html                 shown by GitHub Pages for missing addresses
assets/css/style.css     layout, colours (light and dark), menu, typography
assets/css/qhe.css       styles for the simulation
assets/css/fonts.css     @font-face rules for the self-hosted fonts
assets/fonts/            Newsreader, IBM Plex Sans, IBM Plex Mono (SIL Open Font License)
assets/js/site.js        the staircase menu, light/dark switch
assets/js/qhe.js         the quantum Hall simulation
assets/js/gallery.js     photo loupe and lightbox (gallery and research pages)
assets/js/visits.js      visitor counter in the footer
assets/gallery/          device photos (WebP)
assets/flags/            country flag SVGs (flag-icons, MIT licence)
counter-worker/          the visitor-counter backend (Cloudflare Worker + D1)
favicon.svg              site icon (a Hall plateau staircase)
.nojekyll                tells GitHub Pages to serve files as-is
```

## Common edits

- **Text**: each page's content sits between `<main id="main">` and `</main>`. The masthead, menu and footer above and below it are the same on every page.
- **Add a page**: copy `notes.html`, change its title and content, then add a line for it to the menu (`<ul class="menu-list">`) and the footer links (`<nav class="footer-nav">`) **in every page**. Give the new menu item the next `--i` number so it lands on the next step of the staircase, and move `class="is-current"` / `aria-current="page"` to the right item in the new file.
- **Open the notes section**: replace the construction illustration in `notes.html` with a list of notes, and remove `<span class="badge">under construction</span>` from the menu in every page. For equations, add KaTeX or MathJax to the pages that need it.
- **News on the home page**: add an `<li>` at the top of `<ul class="news">` in `index.html`.
- **Contact details**: the address on the About page is written as `name.lastname.physik@gmail.com` on purpose, so that spam bots can't collect it. There is no CV file on the site; visitors are asked to email for it.
- **Add your GitHub link**: uncomment the GitHub line under "Get in touch" in `index.html`.
- **Add a postcard to the gallery**: export the photo cropped to 7:5 as WebP (an 800 px wide copy for the card and a large one for the loupe), put both in `assets/gallery/`, and copy one `<figure class="postcard">…</figure>` block in `gallery.html`. Give its postmark `<path id>` (and the matching `href="#…"`) a new unique id.
- **Change the accent colour**: edit `--accent` (and the dark-mode values) at the top of `style.css`.

## Visitor counter

The footer shows total visits and a flag for each country visitors came from. GitHub Pages can only serve static files, so the counts live in a small **Cloudflare Worker** with a **D1** database (both on Cloudflare's free plan). It stores only a two-letter country code and a running count: no IP addresses, cookies or user agents. Each browser session counts once however many pages it opens, bots are skipped, and only your own site can add visits.

Until it is set up, the Visitors row stays hidden, so the site works fine without it.

### Set it up (about 5 minutes, needs Node.js)

1. Make a free account at [dash.cloudflare.com](https://dash.cloudflare.com/sign-up).
2. In a terminal, from this folder:
   ```bash
   cd counter-worker
   npx wrangler login
   npx wrangler d1 create site-visit-counter
   ```
   Wrangler prints a `database_id`. Paste it into `counter-worker/wrangler.toml` (or let Wrangler add it when it offers).
3. In `wrangler.toml`, set `ALLOWED_ORIGINS` to your site's address, for example `"https://sahildoesphysics.github.io"` (no trailing slash; separate several with commas).
4. Deploy:
   ```bash
   npx wrangler deploy
   ```
   It prints a URL like `https://site-visit-counter.<your-subdomain>.workers.dev`.
5. Paste that URL into `ENDPOINT` at the top of `assets/js/visits.js`, then commit and push. That one line covers every page.

The table is created automatically on the first request. To check it, open `https://…workers.dev/stats` in a browser.

**No terminal?** In the Cloudflare dashboard: *Storage & Databases → D1 → Create* a database; *Workers & Pages → Create → Worker*, paste `counter-worker/src/index.js` as the code and deploy; then in the worker's *Settings → Bindings* add the D1 database with variable name `DB`, and under *Variables* add `ALLOWED_ORIGINS`.

**Reset the counts:** `npx wrangler d1 execute site-visit-counter --remote --command "DELETE FROM visits"`

## The simulation

`qhe.js` drives three linked panels from one model, with a switch for electron interactions.

- **Sample.** GaAs 2DEG, m* = 0.067 mₑ, n = 1.0 × 10¹¹ cm⁻² (ν = 1 at 4.1 T, ν = 1/3 at 12.4 T), spin-resolved Landau levels E<sub>n</sub> = (n + ½)ħω<sub>c</sub> broadened by a smooth random potential with rms Γ. The Fermi level is fixed by the density.
- **Density of states.** The Fermi-level bar moves through the broadened levels as B changes; red bands mark extended states. With interactions on, the panel zooms into the partly filled level and shows the composite-fermion Λ levels and their Fermi level.
- **Disordered Hall bar.** A random potential on a 161 × 101 grid with confining walls. States at the Fermi energy lie on equipotentials, traced with marching squares; dots move with the drift. Blue: edge channels. Amber: localized orbits. Red: extended states (spanning the bar or larger than a phase-coherence length). Dashed: composite fermions, which drift backwards when B* < 0. Shading shows the local filling factor.
- **Magnetotransport.** The extended window is measured on the simulated sample and sets where σ<sub>xy</sub> steps. Each step follows the semicircle law σ<sub>xx</sub>² + (σ<sub>xy</sub> − N − ½)² = ¼. Beyond the last plateau the sample becomes a Hall insulator: ρ<sub>xx</sub> diverges while ρ<sub>xy</sub> stays at h/e². When levels overlap (ħω<sub>c</sub> ≲ 3Γ) transport crosses over to Drude with Shubnikov–de Haas oscillations.
- **Interactions (composite fermions).** Electrons in the partly filled level (filling f) attach two flux quanta and feel B* = B(1 − 2f). They fill |ν*| = f/|1 − 2f| Λ levels spaced by Δ = 0.33 e²/εℓ<sub>B</sub> |1 − 2f| (weaker in higher levels), with a quarter of the electron disorder, and go through the same percolation and semicircle machinery. The electron resistivity is ρ = ρ<sub>CF</sub> + 2h/e² (Hall), which gives ν = p/(2p ± 1): 1/3, 2/5, 3/7, 2/3, 3/5, 4/3, 5/3, …, a composite-fermion Fermi sea at ν = 1/2 and 3/2, and past 1/3 a Hall insulator with ρ<sub>xy</sub> ≈ 3h/e².

Checked numerically: every plateau lands on h/νe² within 0.4%, R<sub>xy</sub> matches B/ne at low field and at ν = 1/2, and ρ<sub>xy</sub> stays at h/e² (or 3h/e²) across the insulator while ρ<sub>xx</sub> grows to megaohms.

Controls: field, disorder strength Γ, the interaction switch, a field sweep, a new disorder realization, and dragging on the resistance plot. Animation pauses off screen and respects the reduced-motion setting.
