/*
 * Quantum Hall effect: linked simulation of
 *   (1) the Landau-level density of states and the Fermi level,
 *   (2) a disordered 2DEG Hall bar showing localized, extended and edge states,
 *   (3) the Hall and longitudinal resistance as a function of magnetic field.
 *
 * Plain JavaScript, no dependencies. All three panels are driven by one model:
 *   - GaAs 2DEG, m* = 0.067 m_e, fixed density n = 1.0e11 cm^-2, spin-polarised levels
 *   - Landau levels E_n = (n + 1/2) ħω_c, each broadened by a smooth random potential of rms Γ
 *   - Fermi level fixed by the density (sum of filled states = n)
 *   - States at energy E in level n follow the equipotentials V(r) = E - E_n (guiding-centre drift)
 *   - The window of extended (percolating) energies is measured on the simulated sample, and that
 *     same window sets where σ_xy steps; each step follows the semicircle law
 *     σ_xx² + (σ_xy - N - 1/2)² = 1/4, so beyond the last plateau the sample becomes a Hall
 *     insulator (ρ_xx → ∞ with ρ_xy staying quantized)
 *   - Interactions (optional): electrons in the partly filled level become composite fermions (two
 *     attached flux quanta) in B* = B(1 - 2f). They fill Λ levels with a Coulomb gap, run through
 *     the same machinery, and ρ = ρ_CF + 2h/e² (Hall) gives the plateaus ν = p/(2p ± 1).
 */
(() => {
  'use strict';

  const root = document.getElementById('qhe-sim');
  if (!root) return;

  /* ---------------- constants and sample parameters ---------------- */
  const HBAR = 1.054571817e-34, QE = 1.602176634e-19, HP = 6.62607015e-34, ME = 9.1093837015e-31;
  const MSTAR = 0.067 * ME;                  // GaAs effective mass
  const DENSITY = 1.0e15;                    // electrons per m^2 (1.0 x 10^11 cm^-2)
  const RK = HP / (QE * QE);                 // von Klitzing constant h/e^2 (ohm)
  const HW_PER_T = (HBAR / MSTAR) * 1e3;     // ħω_c per tesla, in meV (about 1.728)
  const NU_B = DENSITY * HP / QE;            // ν·B in tesla (about 4.14)
  const R_CLASSICAL_PER_T = 1 / (DENSITY * QE); // classical Hall slope, ohm per tesla
  const EC_PER_SQRT_T = 1439.96 / (12.9 * 25.6563); // e²/(4πε ℓ_B) in meV per √T (GaAs, ε = 12.9)
  const C_GAP = 0.33;                        // composite-fermion gap Δ = C e²/εℓ_B |1 - 2f|
  const CF_DISORDER = 0.25;                  // disorder felt by composite fermions, in units of Γ
  const KAPPA = 7.5;                         // sets where levels stop overlapping (ħω/Γ ≈ 3)
  const STEEP = 2;                           // keeps each step inside the measured extended window
  const B_MIN = 0.5, CURVE_B0 = 0.3;
  const bMax = () => (state.interactions ? 24 : 14);

  /* ---------------- small math helpers ---------------- */
  function erfc(x) { // Numerical Recipes erfcc, fractional error < 1.2e-7 everywhere
    const z = Math.abs(x), t = 1 / (1 + 0.5 * z);
    const r = t * Math.exp(-z * z - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 +
      t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))));
    return x >= 0 ? r : 2 - r;
  }
  const Phi = (x) => 0.5 * erfc(-x / Math.SQRT2);
  const gauss = (x) => Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const gcd = (a, b) => (b ? gcd(b, a % b) : a);
  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  // 2x2 transport tensors are stored as [xx, xy]; ρ = σ⁻¹ gives ρ_xx = σ_xx/|σ|², ρ_xy = σ_xy/|σ|²
  function invT(t) { const d = t[0] * t[0] + t[1] * t[1]; return d < 1e-300 ? [1e150, 0] : [t[0] / d, t[1] / d]; }
  function cdiv(a, b) { const d = b[0] * b[0] + b[1] * b[1]; return [(a[0] * b[0] + a[1] * b[1]) / d, (a[1] * b[0] - a[0] * b[1]) / d]; }

  /* ---------------- state ---------------- */
  const state = { B: 2.35, gamma: 0.5, seed: 1656, sweeping: false, sweepDir: 1, interactions: false };
  let extWin = { lo: -0.3, hi: 0.3, m: 0, w: 0.3 };  // in units of the level broadening, measured below
  let curve = null;   // precomputed R(B)
  let snap = null;    // current derived quantities

  /* ---------------- a ladder of broadened levels ----------------
     Used twice: for electrons in Landau levels (spacing ħω_c, width Γ) and for composite fermions
     in Λ levels (spacing Δ, width Γ_CF). */
  function ladderFilling(EF, hw, G) {
    let s = 0;
    for (let n = 0; n < 5000; n++) {
      const x = (EF - (n + 0.5) * hw) / G;
      if (x < -8) break;
      s += x > 8 ? 1 : Phi(x);
    }
    return s;
  }
  function ladderFermi(nu, hw, G) {
    let lo = -8 * G, hi = (nu + 2) * hw + 8 * G;
    for (let k = 0; k < 56; k++) {
      const mid = 0.5 * (lo + hi);
      if (ladderFilling(mid, hw, G) < nu) lo = mid; else hi = mid;
    }
    return 0.5 * (lo + hi);
  }
  // Separated levels: σ_xy steps by 1 inside the extended window, σ_xx on the semicircle (units e²/h)
  function ladderSigma(EF, hw, G) {
    let sxx = 0, sxy = 0;
    for (let n = 0; n < 5000; n++) {
      const u = STEEP * ((EF - (n + 0.5) * hw) / G - extWin.m) / extWin.w;
      if (u < -26) break;
      if (u > 26) { sxy += 1; continue; }
      const s = 0.5 * erfc(-u), sb = 0.5 * erfc(u);
      sxy += s; sxx += Math.sqrt(s * sb);
    }
    return [sxx, sxy];
  }
  // Overlapping levels (ħω ≲ 3Γ): Drude resistivity with Shubnikov–de Haas modulation.
  // Returns the resistivity with Hall sign `sgn`; rxyD may be passed to keep it smooth through B* = 0.
  function ladderRho(nu, hw, G, EF, sgn, rxyD) {
    const sL = ladderSigma(EF, hw, G);
    const r = hw / G, s = Math.exp(-r * r / KAPPA);
    const rhoL = invT([sL[0], sgn * sL[1]]);
    if (s < 1e-9) return { rho: rhoL, overlap: s, sig: [sL[0], sgn * sL[1]] };
    const wct = hw / (2 * G), dingle = Math.exp(-Math.PI / wct);
    const rxxD = Math.max(0, (1 / (nu * wct)) * (1 - 2 * dingle * Math.cos(2 * Math.PI * nu)));
    const ryD = rxyD != null ? rxyD : sgn / nu;
    const rho = [(1 - s) * rhoL[0] + s * rxxD, (1 - s) * rhoL[1] + s * ryD];
    return { rho, overlap: s, sig: invT(rho) };
  }

  /* ---------------- composite fermions ---------------- */
  function cfParams(B) {
    const nu = NU_B / B, N = Math.floor(nu), f = nu - N;
    const oneM = 1 - 2 * f, sgn = oneM >= 0 ? 1 : -1, a = Math.max(0.02, Math.abs(oneM));
    const nuS = Math.max(1e-6, f / a);                               // |ν*|
    const gN = 1 / (1 + N * N);                                      // weaker in higher levels
    const gap = C_GAP * EC_PER_SQRT_T * Math.sqrt(B) * a * gN;       // Λ-level spacing Δ (meV)
    return { N, f, sgn, nuS, gap, Gcf: CF_DISORDER * state.gamma, Bstar: B * oneM, rxyD: f > 0 ? oneM / f : 0 };
  }

  function transportAt(B, EF) {
    const G = state.gamma, hw = HW_PER_T * B, nu = NU_B / B;
    const el = ladderRho(nu, hw, G, EF, 1, null);
    const out = { rxx: RK * el.rho[0], rxy: RK * el.rho[1], overlap: el.overlap, cf: null };
    // lowest-level position relative to its extended window (used to mark the insulator)
    out.x0 = (EF - 0.5 * hw) / G;
    if (!state.interactions) return out;

    const cf = cfParams(B);
    cf.EF = ladderFermi(cf.nuS, cf.gap, cf.Gcf);
    const r = ladderRho(cf.nuS, cf.gap, cf.Gcf, cf.EF, cf.sgn, cf.rxyD);
    cf.overlap = r.overlap;
    cf.x0 = (cf.EF - 0.5 * cf.gap) / cf.Gcf;
    // attach two flux quanta: ρ = ρ_CF + 2h/e² (Hall), i.e. σ_level = σ_CF / (1 - 2iσ_CF)
    const ss = r.sig;
    const sp = cdiv(ss, [1 + 2 * ss[1], -2 * ss[0]]);
    const rhoF = invT([sp[0], cf.N + sp[1]]);
    // interactions only matter once the Landau levels themselves are resolved
    const w = el.overlap;
    out.rxx = RK * ((1 - w) * rhoF[0] + w * el.rho[0]);
    out.rxy = RK * ((1 - w) * rhoF[1] + w * el.rho[1]);
    out.cf = cf;
    return out;
  }

  // is this field on the insulating side of the last transition?
  function isInsulator(B, tr) {
    const nu = NU_B / B;
    if (tr.cf && tr.overlap < 0.5) return tr.cf.N === 0 && tr.cf.f < 0.5 && tr.cf.x0 < extWin.m;
    return nu < 1 && tr.x0 < extWin.m;
  }

  function buildCurve() {
    const n = state.interactions ? 1800 : 900, B1 = bMax();
    const Bs = new Float32Array(n), rxy = new Float32Array(n), rxx = new Float32Array(n), ins = new Uint8Array(n);
    for (let k = 0; k < n; k++) {
      const B = CURVE_B0 + (B1 - CURVE_B0) * k / (n - 1);
      const EF = ladderFermi(NU_B / B, HW_PER_T * B, state.gamma);
      const t = transportAt(B, EF);
      Bs[k] = B; rxy[k] = t.rxy; rxx[k] = Math.min(t.rxx, 1e12); ins[k] = isInsulator(B, t) ? 1 : 0;
    }
    // insulator: the final stretch where every point is insulating
    let kIns = n;
    while (kIns > 0 && ins[kIns - 1]) kIns--;
    // scale R_xx by its peaks (the insulator diverges and is allowed to leave the plot)
    let peak = rxx[0];
    for (let k = 1; k < Math.min(kIns, n - 1); k++) if (rxx[k] >= rxx[k - 1] && rxx[k] >= rxx[k + 1] && rxx[k] > peak) peak = rxx[k];
    curve = { Bs, rxy, rxx, n, B0: CURVE_B0, B1, insB: kIns < n ? Bs[kIns] : null, rxxScale: peak };
  }

  /* ---------------- the disordered Hall bar ---------------- */
  const NX = 161, NY = 101, LX = 1.6, LY = 1.0, DX = LX / (NX - 1);
  const LAMBDA = 0.15;   // width of the confining edge region (fraction of the bar width)
  const V0 = 48;         // height of the confining potential at the physical edge (meV)
  const vdis = new Float32Array(NX * NY);  // unit-variance smooth random potential
  const vedge = new Float32Array(NX * NY);
  const vtot = new Float32Array(NX * NY);
  let vMin = 0;

  (function buildEdge() {
    for (let j = 0; j < NY; j++) {
      const y = j / (NY - 1), d = Math.min(y, 1 - y);
      const e = d < LAMBDA ? V0 * Math.pow((LAMBDA - d) / LAMBDA, 2) : 0;
      for (let i = 0; i < NX; i++) vedge[j * NX + i] = e;
    }
  })();

  function buildDisorder(seed) {
    const rnd = mulberry32(seed * 9973 + 17);
    const NW = 72, K0 = 2 * Math.PI / 0.34;
    const kx = [], ky = [], ph = [];
    for (let k = 0; k < NW; k++) {
      const th = 2 * Math.PI * rnd(), kk = K0 * (0.55 + 0.9 * rnd());
      kx.push(kk * Math.cos(th)); ky.push(kk * Math.sin(th)); ph.push(2 * Math.PI * rnd());
    }
    let sum = 0, sum2 = 0;
    for (let j = 0; j < NY; j++) {
      const y = j * DX;
      for (let i = 0; i < NX; i++) {
        const x = i * DX;
        let v = 0;
        for (let k = 0; k < NW; k++) v += Math.cos(kx[k] * x + ky[k] * y + ph[k]);
        vdis[j * NX + i] = v; sum += v; sum2 += v * v;
      }
    }
    const N = NX * NY, mean = sum / N, sd = Math.sqrt(sum2 / N - mean * mean);
    for (let q = 0; q < N; q++) vdis[q] = (vdis[q] - mean) / sd;
  }

  function buildTotal() {
    vMin = Infinity;
    for (let q = 0; q < NX * NY; q++) {
      const v = state.gamma * vdis[q] + vedge[q];
      vtot[q] = v;
      if (v < vMin) vMin = v;
    }
  }

  /* ---------------- marching squares with path assembly ---------------- */
  const NH = (NX - 1) * NY, NV = NX * (NY - 1), NEDGE = NH + NV;
  const ex = new Float32Array(NEDGE), ey = new Float32Array(NEDGE);
  const adj = new Int32Array(2 * NEDGE);
  let segA = new Int32Array(16384), segB = new Int32Array(16384);
  // cell sides: 0 bottom, 1 right, 2 top, 3 left; corners a(i,j) b(i+1,j) c(i+1,j+1) d(i,j+1)
  const TABLE = [[], [3, 0], [0, 1], [3, 1], [1, 2], null, [0, 2], [3, 2],
                 [2, 3], [0, 2], null, [1, 2], [3, 1], [0, 1], [3, 0], []];

  function contour(level) {
    adj.fill(-1);
    let ns = 0;
    const f = vtot;

    function sideEdge(i, j, side) {
      let e, i0, j0, i1, j1;
      if (side === 0) { e = j * (NX - 1) + i; i0 = i; j0 = j; i1 = i + 1; j1 = j; }
      else if (side === 2) { e = (j + 1) * (NX - 1) + i; i0 = i; j0 = j + 1; i1 = i + 1; j1 = j + 1; }
      else if (side === 3) { e = NH + j * NX + i; i0 = i; j0 = j; i1 = i; j1 = j + 1; }
      else { e = NH + j * NX + i + 1; i0 = i + 1; j0 = j; i1 = i + 1; j1 = j + 1; }
      const f0 = f[j0 * NX + i0] - level, f1 = f[j1 * NX + i1] - level;
      const t = f0 / (f0 - f1);
      ex[e] = (i0 + (i1 - i0) * t) * DX;
      ey[e] = (j0 + (j1 - j0) * t) * DX;
      return e;
    }
    function addSeg(e1, e2) {
      if (ns >= segA.length) {
        const a = new Int32Array(segA.length * 2), b = new Int32Array(segB.length * 2);
        a.set(segA); b.set(segB); segA = a; segB = b;
      }
      segA[ns] = e1; segB[ns] = e2;
      if (adj[2 * e1] < 0) adj[2 * e1] = ns; else adj[2 * e1 + 1] = ns;
      if (adj[2 * e2] < 0) adj[2 * e2] = ns; else adj[2 * e2 + 1] = ns;
      ns++;
    }

    for (let j = 0; j < NY - 1; j++) {
      for (let i = 0; i < NX - 1; i++) {
        const fa = f[j * NX + i] - level, fb = f[j * NX + i + 1] - level;
        const fc = f[(j + 1) * NX + i + 1] - level, fd = f[(j + 1) * NX + i] - level;
        const idx = (fa >= 0 ? 1 : 0) | (fb >= 0 ? 2 : 0) | (fc >= 0 ? 4 : 0) | (fd >= 0 ? 8 : 0);
        if (idx === 0 || idx === 15) continue;
        if (idx === 5 || idx === 10) {
          const centre = 0.25 * (fa + fb + fc + fd) >= 0;
          const isolateBD = (idx === 5) === centre;
          if (isolateBD) { addSeg(sideEdge(i, j, 0), sideEdge(i, j, 1)); addSeg(sideEdge(i, j, 2), sideEdge(i, j, 3)); }
          else { addSeg(sideEdge(i, j, 3), sideEdge(i, j, 0)); addSeg(sideEdge(i, j, 1), sideEdge(i, j, 2)); }
          continue;
        }
        const t = TABLE[idx];
        addSeg(sideEdge(i, j, t[0]), sideEdge(i, j, t[1]));
      }
    }

    // chain segments into paths
    const vis = new Uint8Array(ns);
    const paths = [];
    const other = (s, e) => (segA[s] === e ? segB[s] : segA[s]);
    const nextSeg = (e, s) => { const a = adj[2 * e]; return a === s ? adj[2 * e + 1] : a; };
    function walk(s0, e0) {
      const pts = [ex[e0], ey[e0]];
      let s = s0, e = e0, closed = false;
      while (s >= 0) {
        vis[s] = 1;
        e = other(s, e);
        pts.push(ex[e], ey[e]);
        const n = nextSeg(e, s);
        if (n < 0) break;
        if (vis[n]) { closed = true; break; }
        s = n;
      }
      return { pts, closed };
    }
    for (let s = 0; s < ns; s++) {
      if (vis[s]) continue;
      const a = segA[s], b = segB[s];
      if (adj[2 * a + 1] < 0) paths.push(walk(s, a));
      else if (adj[2 * b + 1] < 0) paths.push(walk(s, b));
    }
    for (let s = 0; s < ns; s++) if (!vis[s]) paths.push(walk(s, segA[s]));
    return paths;
  }

  /* A state is "extended" if its equipotential links the two edges of the bar (backscattering),
     crosses the bar from contact to contact through the bulk, or is larger than the
     phase-coherence length (in units of the bar width), which gives the extended band a finite
     width at finite temperature. Open paths along one edge are edge channels. */
  const LPHI = 0.7;
  function classifyRaw(p) {
    const pts = p.pts;
    let minx = Infinity, maxx = -Infinity, miny = Infinity, maxy = -Infinity, top = false, bot = false;
    for (let k = 0; k < pts.length; k += 2) {
      const x = pts[k], y = pts[k + 1];
      if (x < minx) minx = x; if (x > maxx) maxx = x;
      if (y < miny) miny = y; if (y > maxy) maxy = y;
      if (y > LY - LAMBDA) top = true;
      if (y < LAMBDA) bot = true;
    }
    if (top && bot) return 'conn';
    if (!p.closed && maxx - minx > 0.9 * LX) return (top || bot) ? 'edge' : 'conn';
    return Math.hypot(maxx - minx, maxy - miny) > LPHI ? 'big' : 'loc';
  }
  function classify(p, inWindow) {
    const r = classifyRaw(p);
    if (r === 'conn') return 'ext';
    if (r === 'big') return inWindow ? 'ext' : 'loc';
    return r;
  }

  // orient each path along the drift (E x B, or E x B* for composite fermions) so dots move the right way
  function orient(p, sign) {
    const pts = p.pts, n = pts.length / 2 - 1;
    if (n < 1) return;
    const step = Math.max(1, Math.floor(n / 40));
    let acc = 0;
    for (let k = 0; k < n; k += step) {
      const x0 = pts[2 * k], y0 = pts[2 * k + 1], x1 = pts[2 * k + 2], y1 = pts[2 * k + 3];
      const i = clamp(Math.round(0.5 * (x0 + x1) / DX), 1, NX - 2);
      const j = clamp(Math.round(0.5 * (y0 + y1) / DX), 1, NY - 2);
      const gx = vtot[j * NX + i + 1] - vtot[j * NX + i - 1];
      const gy = vtot[(j + 1) * NX + i] - vtot[(j - 1) * NX + i];
      acc += (x1 - x0) * gy - (y1 - y0) * gx;   // t · (∂yV, -∂xV)
    }
    if (acc * sign < 0) {
      const r = new Array(pts.length);
      for (let k = 0; k < pts.length; k += 2) { r[pts.length - 2 - k] = pts[k]; r[pts.length - 1 - k] = pts[k + 1]; }
      p.pts = r;
    }
  }

  // window of energies (units of the broadening, relative to a level centre) with extended states,
  // grown outward from the percolation point so isolated large puddles far in the tails don't count
  function measureExtendedWindow() {
    const cs = [], conn = [], ext = [];
    for (let k = 0; k <= 100; k++) {
      const c = -2 + 0.04 * k;
      let hasConn = false, hasBig = false;
      for (const p of contour(c * state.gamma)) {
        const r = classifyRaw(p);
        if (r === 'conn') hasConn = true; else if (r === 'big') hasBig = true;
      }
      cs.push(c); conn.push(hasConn); ext.push(hasConn || hasBig);
    }
    let seed = -1;
    for (let k = 0; k < cs.length; k++) if (conn[k] && (seed < 0 || Math.abs(cs[k]) < Math.abs(cs[seed]))) seed = k;
    if (seed < 0) for (let k = 0; k < cs.length; k++) if (ext[k] && (seed < 0 || Math.abs(cs[k]) < Math.abs(cs[seed]))) seed = k;
    let lo, hi;
    if (seed < 0) { lo = -0.12; hi = 0.12; }
    else {
      let a = seed, b = seed;
      while (a > 0 && ext[a - 1]) a--;
      while (b < cs.length - 1 && ext[b + 1]) b++;
      lo = cs[a] - 0.02; hi = cs[b] + 0.02;
    }
    const m = 0.5 * (lo + hi), w = Math.max(0.08, 0.5 * (hi - lo));
    extWin = { lo, hi, m, w };
  }

  /* ---------------- derived snapshot for the current field ---------------- */
  function computeSnapshot() {
    const B = state.B, G = state.gamma, hw = HW_PER_T * B, nu = NU_B / B;
    const EF = ladderFermi(nu, hw, G);
    const tr = transportAt(B, EF);
    const cf = tr.cf;
    const fqh = !!cf && tr.overlap < 0.5;          // composite fermions are well defined
    const cfSea = fqh && cf.overlap > 0.45;        // Λ levels merged: composite-fermion Fermi sea
    const levels = [], cfLevels = [];
    let hasExt = false;
    for (let n = 0; n < 400; n++) {
      if (fqh && n >= cf.N) break;                 // level N is described by composite fermions
      const c = EF - (n + 0.5) * hw;
      if (c <= vMin) break;
      if (c > V0 - 4 * G) continue;
      const paths = contour(c);
      const inWindow = c / G >= extWin.lo && c / G <= extWin.hi;
      for (const p of paths) {
        p.kind = classify(p, inWindow);
        if (p.kind === 'ext') hasExt = true;
        orient(p, 1);
      }
      levels.push({ n, c, paths });
    }
    let pCF = 0, kCF = 0, xCF = 0, cfExt = false;
    if (fqh) {
      // composite fermions feel a scaled copy of the same landscape: V_CF = (Γ_CF/Γ) V
      const scale = G / cf.Gcf;
      if (!cfSea) {
        for (let k = 0; k < 60; k++) {
          const cs = cf.EF - (k + 0.5) * cf.gap;
          const c = cs * scale;
          if (c <= vMin) break;
          if (c > V0 - 4 * G) continue;
          const paths = contour(c);
          const inWindow = cs / cf.Gcf >= extWin.lo && cs / cf.Gcf <= extWin.hi;
          for (const p of paths) {
            p.kind = classify(p, inWindow);
            p.cf = true;
            if (p.kind === 'ext') cfExt = true;
            orient(p, cf.sgn);
          }
          cfLevels.push({ k, c, paths });
        }
      }
      for (let k = 0; k < 5000; k++) {
        if ((cf.EF - (k + 0.5) * cf.gap) / cf.Gcf <= extWin.m) break;
        pCF++;
      }
      kCF = Math.max(0, Math.round(cf.EF / cf.gap - 0.5));
      xCF = (cf.EF - (kCF + 0.5) * cf.gap) / cf.Gcf;
    }
    const N = Math.max(0, Math.round(EF / hw - 0.5));
    const xN = (EF - (N + 0.5) * hw) / G;
    let K = 0;
    for (let n = 0; n < 5000; n++) {
      if ((EF - (n + 0.5) * hw) / G <= extWin.m) break;
      K++;
    }
    snap = {
      B, G, hw, nu, EF, tr, levels, cfLevels, hasExt: hasExt || cfExt, cfExt, N, xN, fillN: Phi(xN), K,
      fqh, cfSea, cf, pCF, kCF, xCF, fillCF: fqh ? Phi(xCF) : 0, insulator: isInsulator(B, tr),
    };
  }

  /* ---------------- DOM ---------------- */
  const $ = (id) => document.getElementById(id);
  const inB = $('qhe-b'), inG = $('qhe-g'), outB = $('qhe-b-out'), outG = $('qhe-g-out');
  const btnSweep = $('qhe-sweep'), btnSeed = $('qhe-reseed'), swInt = $('qhe-int');
  const cvDos = $('qhe-dos'), cvGas = $('qhe-2deg'), cvRB = $('qhe-rb');
  const statusEl = $('qhe-status');
  const legendCF = $('qhe-legend-cf'), dosNote = $('qhe-dos-note');
  const ro = { nu: $('ro-nu'), hw: $('ro-hw'), ef: $('ro-ef'), rxy: $('ro-rxy'), rxx: $('ro-rxx') };
  const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  let C = {};
  function readColors() {
    const cs = getComputedStyle(root);
    const g = (n) => cs.getPropertyValue(n).trim();
    C = {
      ink: g('--q-ink'), muted: g('--q-muted'), grid: g('--q-grid'), bg: g('--q-bg'),
      edge: g('--q-edge'), ext: g('--q-ext'), loc: g('--q-loc'),
      occ: g('--q-occ'), empty: g('--q-empty'), fill0: g('--q-fill0'), fill1: g('--q-fill1'),
      contact: g('--q-contact'), curve: g('--q-curve'), band: g('--q-band') || g('--q-grid'),
      mono: g('--q-mono') || 'ui-monospace, monospace',
    };
  }
  function hexToRgb(h) {
    h = h.replace('#', '');
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    const v = parseInt(h, 16);
    return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
  }

  function setupCanvas(cv) {
    const r = cv.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(10, r.width), h = Math.max(10, r.height);
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
      cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    }
    const ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, w, h, dpr };
  }
  const font = (px, weight) => `${weight || 400} ${px}px ${C.mono}`;

  // canvas text with subscripts: parts = [[text], [subscript, 1], ...]
  function richText(ctx, parts, x, y, align, size, weight, measureOnly) {
    const main = font(size, weight), sub = font(Math.round(size * 0.78), weight);
    const widths = parts.map(([t, s]) => { ctx.font = s ? sub : main; return ctx.measureText(t).width; });
    const total = widths.reduce((a, b) => a + b, 0);
    if (measureOnly) return total;
    let cx = align === 'right' ? x - total : align === 'center' ? x - total / 2 : x;
    const saved = ctx.textAlign;
    ctx.textAlign = 'left';
    parts.forEach(([t, s], i) => { ctx.font = s ? sub : main; ctx.fillText(t, cx, s ? y + size * 0.32 : y); cx += widths[i]; });
    ctx.textAlign = saved;
    return total;
  }

  /* ---------------- panel 1: density of states ---------------- */
  // draws one ladder of Gaussian levels (unit weight each) into box; x is energy / level spacing
  function drawLadder(ctx, box, o) {
    const { L, T, pw, ph } = box;
    const { xF, sig } = o;
    const xmax = Math.max(4.6, xF + 1.9);
    const X = (x) => L + (x / xmax) * pw;
    const nmax = Math.ceil(xmax + 1);
    const dos = (x) => {
      let g = 0;
      const n0 = Math.max(0, Math.floor(x - 0.5 - 8 * sig)), n1 = Math.min(nmax, Math.ceil(x - 0.5 + 8 * sig));
      for (let n = n0; n <= n1; n++) g += gauss((x - (n + 0.5)) / sig) / sig;
      return g;
    };
    const NS = Math.max(200, Math.round(pw * 1.5));
    const xs = new Float32Array(NS + 1), gs = new Float32Array(NS + 1);
    let gmax = 0;
    for (let k = 0; k <= NS; k++) { const x = xmax * k / NS; xs[k] = x; gs[k] = dos(x); if (gs[k] > gmax) gmax = gs[k]; }
    const ymax = Math.max(1.2, gmax * 1.08);
    const Y = (g) => T + ph - (g / ymax) * ph;

    const area = new Path2D();
    area.moveTo(X(0), Y(0));
    for (let k = 0; k <= NS; k++) area.lineTo(X(xs[k]), Y(gs[k]));
    area.lineTo(X(xmax), Y(0)); area.closePath();

    ctx.fillStyle = C.empty; ctx.fill(area);
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, X(xF), T + ph + 1); ctx.clip();
    ctx.fillStyle = C.occ; ctx.fill(area); ctx.restore();

    for (let n = 0; n <= nmax; n++) {                 // extended-state windows
      const a = X(n + 0.5 + extWin.lo * sig), b = X(n + 0.5 + extWin.hi * sig);
      if (a > L + pw) break;
      const bw = Math.max(1.5, b - a);
      ctx.save(); ctx.beginPath(); ctx.rect(a, 0, bw, T + ph + 1); ctx.clip();
      ctx.globalAlpha = 0.32; ctx.fillStyle = C.ext; ctx.fill(area);
      ctx.beginPath(); ctx.rect(0, 0, X(xF), T + ph + 1); ctx.clip();
      ctx.globalAlpha = 0.95; ctx.fill(area);
      ctx.restore();
    }

    ctx.beginPath();
    for (let k = 0; k <= NS; k++) { const px = X(xs[k]), py = Y(gs[k]); if (k) ctx.lineTo(px, py); else ctx.moveTo(px, py); }
    ctx.strokeStyle = C.ink; ctx.globalAlpha = 0.7; ctx.lineWidth = 1.1; ctx.stroke(); ctx.globalAlpha = 1;

    ctx.strokeStyle = C.muted; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(L, T + ph + 0.5); ctx.lineTo(L + pw, T + ph + 0.5); ctx.stroke();
    ctx.fillStyle = C.muted; ctx.font = font(11); ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    const tickStep = xmax > 18 ? 5 : xmax > 9 ? 2 : 1;
    for (let t = 0; t <= xmax; t += tickStep) {
      const px = X(t);
      ctx.beginPath(); ctx.moveTo(px + 0.5, T + ph); ctx.lineTo(px + 0.5, T + ph + 4); ctx.stroke();
      ctx.fillText(String(t), px, T + ph + 6);
    }
    ctx.textBaseline = 'alphabetic';
    richText(ctx, o.axis, L + pw, T + ph + 30, 'right', 11, 400);

    if (xmax <= 8.5) {                               // level labels
      ctx.textAlign = 'center'; ctx.textBaseline = 'bottom'; ctx.font = font(10);
      for (let n = 0; n + 0.5 < xmax; n++) {
        const px = X(n + 0.5), py = Y(dos(n + 0.5));
        if (Math.abs(px - X(xF)) < 26 && py < T + 18) continue;
        ctx.fillStyle = C.muted;
        ctx.fillText(o.prefix + n, px, Math.max(T + 12, py - 4));
      }
    }

    const px = Math.round(X(xF)) + 0.5;                // Fermi level bar
    ctx.strokeStyle = C.ink; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(px, T - 6); ctx.lineTo(px, T + ph); ctx.stroke();
    ctx.fillStyle = C.ink; ctx.textBaseline = 'alphabetic';
    const tw = richText(ctx, o.label, 0, 0, 'left', 11, 600, true);
    const onRight = px + 6 + tw < L + pw;
    richText(ctx, o.label, onRight ? px + 6 : px - 6, T - 10, onRight ? 'left' : 'right', 11, 600);
    return { X, xmax };
  }

  function drawDOS() {
    const { ctx, w, h } = setupCanvas(cvDos);
    const { hw, G, EF, N, fillN, fqh, cf } = snap;
    ctx.clearRect(0, 0, w, h);
    const L = 14, R = 12;
    const pw = w - L - R;
    const elLabel = [['E'], ['F', 1], [` · LL${N} ${Math.round(fillN * 100)}% full`]];
    if (!fqh) {
      drawLadder(ctx, { L, T: 30, pw, ph: h - 30 - 44 }, { xF: EF / hw, sig: G / hw, prefix: 'LL', label: elLabel, axis: [['E / ħω'], ['c', 1]] });
      return;
    }
    // interacting: electron levels on top, and a zoom into level N showing composite-fermion Λ levels
    const T1 = 28, gapMid = 70, bottomPad = 44;
    const ph1 = Math.round((h - T1 - gapMid - bottomPad) * 0.52), ph2 = h - T1 - gapMid - bottomPad - ph1;
    const T2 = T1 + ph1 + gapMid;
    const lvl = [['E'], ['F', 1], [` · LL${cf.N} ${Math.round(cf.f * 100)}% full`]];
    const top = drawLadder(ctx, { L, T: T1, pw, ph: ph1 }, { xF: EF / hw, sig: G / hw, prefix: 'LL', label: lvl, axis: [['E / ħω'], ['c', 1]] });
    // highlight level N and draw zoom lines
    const sigE = G / hw;
    const za = clamp(top.X(cf.N + 0.5 - 3 * sigE), L, L + pw), zb = clamp(top.X(cf.N + 0.5 + 3 * sigE), L, L + pw);
    ctx.save();
    ctx.fillStyle = C.ink; ctx.globalAlpha = 0.06; ctx.fillRect(za, T1 - 4, Math.max(3, zb - za), ph1 + 4);
    ctx.globalAlpha = 0.45; ctx.strokeStyle = C.muted; ctx.setLineDash([3, 3]); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(za, T1 + ph1); ctx.lineTo(L, T2 - 30); ctx.moveTo(zb, T1 + ph1); ctx.lineTo(L + pw, T2 - 30); ctx.stroke();
    ctx.restore();
    ctx.fillStyle = C.muted; ctx.textBaseline = 'alphabetic';
    const bs = cf.Bstar;
    richText(ctx, [[`LL${cf.N} as composite fermions · B* = ${bs >= 0 ? '+' : '−'}${Math.abs(bs).toFixed(1)} T`]], L + pw / 2, T2 - 30, 'center', 10.5, 500);
    const cfLabel = snap.cfSea
      ? [['E*'], ['F', 1], [' · composite-fermion Fermi sea']]
      : [['E*'], ['F', 1], [` · Λ${snap.kCF} ${Math.round(snap.fillCF * 100)}% full`]];
    drawLadder(ctx, { L, T: T2, pw, ph: ph2 }, { xF: cf.EF / cf.gap, sig: cf.Gcf / cf.gap, prefix: 'Λ', label: cfLabel, axis: [['E* / Δ'], ['CF', 1]] });
  }

  /* ---------------- panel 2: the 2DEG ---------------- */
  const bgCanvas = document.createElement('canvas');
  bgCanvas.width = NX; bgCanvas.height = NY;
  const staticLayer = document.createElement('canvas');
  let dotPaths = [];

  function drawGasStatic() {
    const r = cvGas.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(10, r.width), h = Math.max(10, r.height);
    staticLayer.width = Math.round(w * dpr); staticLayer.height = Math.round(h * dpr);
    const ctx = staticLayer.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const cw = Math.max(16, Math.round(w * 0.055));
    const sx0 = cw, sx1 = w - cw, sy0 = 6, sy1 = h - 6;
    const X = (x) => sx0 + (x / LX) * (sx1 - sx0);
    const Y = (y) => sy1 - (y / LY) * (sy1 - sy0);
    const { hw, EF, nu, levels, cfLevels, fqh, cf, G } = snap;

    // local filling factor: occupied Landau levels, plus the local fractional state when interacting
    const bctx = bgCanvas.getContext('2d');
    const img = bctx.createImageData(NX, NY);
    const c0 = hexToRgb(C.fill0), c1 = hexToRgb(C.fill1);
    const nTop = fqh ? Math.max(1.25, nu + 1) : Math.max(2, Math.ceil(nu) + 1);
    for (let j = 0; j < NY; j++) {
      for (let i = 0; i < NX; i++) {
        const v = vtot[j * NX + i];
        let cnt = Math.max(0, Math.ceil((EF - v) / hw - 0.5));
        if (fqh) {
          cnt = Math.min(cnt, cf.N);
          if (cnt === cf.N) {
            const k = Math.max(0, Math.ceil((cf.EF - v * cf.Gcf / G) / cf.gap - 0.5));
            cnt += cf.sgn > 0 ? k / (2 * k + 1) : (k >= 1 ? k / (2 * k - 1) : 0);
          }
        }
        const t = Math.min(1, cnt / nTop);
        const o = 4 * ((NY - 1 - j) * NX + i);
        img.data[o] = c0[0] + (c1[0] - c0[0]) * t;
        img.data[o + 1] = c0[1] + (c1[1] - c0[1]) * t;
        img.data[o + 2] = c0[2] + (c1[2] - c0[2]) * t;
        img.data[o + 3] = 255;
      }
    }
    bctx.putImageData(img, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(bgCanvas, sx0, sy0, sx1 - sx0, sy1 - sy0);

    // contacts
    ctx.fillStyle = C.contact;
    ctx.fillRect(0, sy0 - 6, cw - 2, sy1 - sy0 + 12);
    ctx.fillRect(w - cw + 2, sy0 - 6, cw - 2, sy1 - sy0 + 12);
    ctx.fillStyle = C.ink; ctx.globalAlpha = 0.65; ctx.font = font(11, 600);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('S', (cw - 2) / 2, (sy0 + sy1) / 2);
    ctx.fillText('D', w - (cw - 2) / 2, (sy0 + sy1) / 2);
    ctx.globalAlpha = 1;

    // sample edges
    ctx.strokeStyle = C.muted; ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(sx0, sy0 + 0.5); ctx.lineTo(sx1, sy0 + 0.5);
    ctx.moveTo(sx0, sy1 - 0.5); ctx.lineTo(sx1, sy1 - 0.5);
    ctx.stroke();

    // equipotentials at the Fermi energy: electron levels solid, composite-fermion Λ levels dashed
    dotPaths = [];
    const order = { loc: 0, edge: 1, ext: 2 };
    const all = [];
    for (const lv of levels) for (const p of lv.paths) all.push(p);
    for (const lv of cfLevels) for (const p of lv.paths) all.push(p);
    all.sort((a, b) => order[a.kind] - order[b.kind]);
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    for (const p of all) {
      const pts = p.pts, n = pts.length / 2;
      if (n < 2) continue;
      const xs = new Float32Array(n), ys = new Float32Array(n), cum = new Float32Array(n);
      for (let k = 0; k < n; k++) {
        xs[k] = X(pts[2 * k]); ys[k] = Y(pts[2 * k + 1]);
        if (k) cum[k] = cum[k - 1] + Math.hypot(xs[k] - xs[k - 1], ys[k] - ys[k - 1]);
      }
      const len = cum[n - 1];
      if (len < 3) continue;
      ctx.beginPath(); ctx.moveTo(xs[0], ys[0]);
      for (let k = 1; k < n; k++) ctx.lineTo(xs[k], ys[k]);
      if (p.closed) ctx.closePath();
      ctx.strokeStyle = p.kind === 'ext' ? C.ext : p.kind === 'edge' ? C.edge : C.loc;
      ctx.lineWidth = p.kind === 'ext' ? 2.2 : p.kind === 'edge' ? 1.7 : 1.4;
      ctx.setLineDash(p.cf ? [5, 3.5] : []);
      ctx.stroke();
      dotPaths.push({ xs, ys, cum, len, kind: p.kind, cf: !!p.cf });
    }
    ctx.setLineDash([]);
  }

  function pointAt(p, s) {
    const cum = p.cum;
    let lo = 0, hi = cum.length - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (cum[mid] <= s) lo = mid; else hi = mid; }
    const seg = cum[hi] - cum[lo] || 1, t = (s - cum[lo]) / seg;
    return [p.xs[lo] + (p.xs[hi] - p.xs[lo]) * t, p.ys[lo] + (p.ys[hi] - p.ys[lo]) * t];
  }

  function drawGasFrame(time) {
    const { ctx, w, h } = setupCanvas(cvGas);
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(staticLayer, 0, 0, w, h);
    const spacing = 24;
    const t = reduceMotion ? 0 : time / 1000;
    for (const p of dotPaths) {
      const speed = p.cf ? 16 : 26;
      const nd = Math.max(1, Math.floor(p.len / spacing));
      ctx.fillStyle = p.kind === 'ext' ? C.ext : p.kind === 'edge' ? C.edge : C.loc;
      ctx.strokeStyle = C.bg;
      ctx.lineWidth = 1;
      const rad = p.cf ? 1.9 : 2.3;
      for (let k = 0; k < nd; k++) {
        let s = (k * p.len / nd + t * speed) % p.len;
        if (s < 0) s += p.len;
        const [x, y] = pointAt(p, s);
        ctx.beginPath(); ctx.arc(x, y, rad, 0, 2 * Math.PI); ctx.fill(); ctx.stroke();
      }
    }
  }

  /* ---------------- panel 3: R vs B ---------------- */
  const GUIDES_IQHE = [[1, 1], [2, 1], [3, 1], [4, 1], [5, 1], [6, 1]];
  const GUIDES_FQHE = [[1, 3], [2, 5], [3, 7], [2, 3], [3, 5], [4, 7], [1, 1], [4, 3], [7, 5], [5, 3], [8, 5], [2, 1], [3, 1], [4, 1]];
  let rbGeom = null;
  function drawRB() {
    const { ctx, w, h } = setupCanvas(cvRB);
    ctx.clearRect(0, 0, w, h);
    const L = 48, R = 46, T = 12, gap = 22, Bm = 36;
    const pw = w - L - R;
    const avail = h - T - gap - Bm;
    const h1 = Math.round(avail * 0.6), h2 = avail - h1;
    const top1 = T, top2 = T + h1 + gap;
    const BM = curve.B1;
    const X = (B) => L + (B / BM) * pw;
    const ymax1 = state.interactions ? 85e3 : 30e3;
    const ymax2 = Math.max(1000, niceCeil(curve.rxxScale * 1.2));
    const Y1 = (r) => top1 + h1 - (r / ymax1) * h1;
    const Y2 = (r) => top2 + h2 - (r / ymax2) * h2;
    rbGeom = { L, pw };

    // insulating region
    if (curve.insB != null) {
      const xi = X(curve.insB);
      ctx.fillStyle = C.band; ctx.fillRect(xi, top1, L + pw - xi, top2 + h2 - top1);
    }

    ctx.font = font(11); ctx.lineWidth = 1;
    ctx.strokeStyle = C.grid; ctx.fillStyle = C.muted;
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    const step1 = state.interactions ? 20e3 : 5e3;
    for (let r = 0; r <= ymax1 + 1; r += step1) {
      const y = Math.round(Y1(r)) + 0.5;
      ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(L + pw, y); ctx.stroke();
      ctx.fillText(String(r / 1e3), L - 8, y);
    }
    const step2 = niceStep(ymax2 / 3);
    for (let r = 0; r <= ymax2 + 1; r += step2) {
      const y = Math.round(Y2(r)) + 0.5;
      ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(L + pw, y); ctx.stroke();
      ctx.fillText(fmtK(r), L - 8, y);
    }
    // x ticks
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.strokeStyle = C.muted;
    const labelEvery = [1, 2, 5, 10].find((s) => (pw / BM) * s >= 26) || 10;
    for (let B = 0; B <= BM; B += 1) {
      const x = Math.round(X(B)) + 0.5;
      ctx.beginPath(); ctx.moveTo(x, top2 + h2); ctx.lineTo(x, top2 + h2 + (B % 5 === 0 ? 5 : 3)); ctx.stroke();
      if (B % labelEvery === 0) ctx.fillText(String(B), x, top2 + h2 + 7);
    }
    ctx.beginPath(); ctx.moveTo(L, top1 + h1 + 0.5); ctx.lineTo(L + pw, top1 + h1 + 0.5); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(L, top2 + h2 + 0.5); ctx.lineTo(L + pw, top2 + h2 + 0.5); ctx.stroke();
    ctx.textAlign = 'right';
    ctx.fillText('B (T)', L + pw, top2 + h2 + 21);

    ctx.fillStyle = C.edge; ctx.textBaseline = 'top';
    richText(ctx, [['R'], ['xy', 1], [' (kΩ)']], L + 8, top1 + 4, 'left', 11, 500);
    ctx.fillStyle = C.ext;
    richText(ctx, [['R'], ['xx', 1], [' (kΩ)']], L + 8, top2 + 2, 'left', 11, 500);

    // plateau guides h/νe²
    ctx.save(); ctx.setLineDash([3, 4]); ctx.strokeStyle = C.muted; ctx.globalAlpha = 0.55;
    ctx.fillStyle = C.muted; ctx.font = font(10); ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    let lastLabelY = -Infinity;
    for (const [p, q] of state.interactions ? GUIDES_FQHE : GUIDES_IQHE) {
      const y = Math.round(Y1(RK * q / p)) + 0.5;
      if (y < top1) continue;
      ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(L + pw, y); ctx.stroke();
      if (y - lastLabelY >= 12) {
        ctx.globalAlpha = 0.9; ctx.fillText(q === 1 ? `ν=${p}` : `ν=${p}/${q}`, L + pw + 6, y); ctx.globalAlpha = 0.55;
        lastLabelY = y;
      }
    }
    // classical Hall line
    ctx.setLineDash([1, 3]);
    ctx.beginPath(); ctx.rect(L, top1, pw, h1); ctx.clip();
    ctx.beginPath(); ctx.moveTo(X(0), Y1(0)); ctx.lineTo(X(BM), Y1(R_CLASSICAL_PER_T * BM)); ctx.stroke();
    ctx.restore();

    // full curves (faint) and the traced part up to the current field, clipped to each plot
    const { Bs, rxy, rxx } = curve;
    const trace = (arr, Y, ymax, upto) => {
      ctx.beginPath();
      let started = false;
      for (let k = 0; k < Bs.length; k++) {
        if (upto != null && Bs[k] > upto) break;
        const x = X(Bs[k]), y = Y(Math.min(arr[k], ymax * 3));
        if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
      }
      if (upto != null && started) ctx.lineTo(X(upto), Y(Math.min(interp(arr, upto), ymax * 3)));
    };
    ctx.lineJoin = 'round';
    for (const [arr, Y, ymax, tp, col] of [[rxy, Y1, ymax1, top1, C.edge], [rxx, Y2, ymax2, top2, C.ext]]) {
      const hh = Y === Y1 ? h1 : h2;
      ctx.save(); ctx.beginPath(); ctx.rect(L, tp - 1, pw, hh + 2); ctx.clip();
      ctx.strokeStyle = C.curve; ctx.lineWidth = 1.4; trace(arr, Y, ymax, null); ctx.stroke();
      ctx.strokeStyle = col; ctx.lineWidth = 2.2; trace(arr, Y, ymax, state.B); ctx.stroke();
      ctx.restore();
    }

    // insulator labels, on a patch of the band colour so guide lines don't run through them
    if (curve.insB != null) {
      const xc = 0.5 * (X(curve.insB) + L + pw);
      const bandW = L + pw - X(curve.insB);
      const label = (parts, y) => {
        let tw = richText(ctx, parts, 0, 0, 'left', 10.5, 500, true);
        if (tw + 10 > bandW && parts[0][0] === 'Hall insulator') { parts = [['insulator']]; tw = richText(ctx, parts, 0, 0, 'left', 10.5, 500, true); }
        if (tw + 10 > bandW) return;
        ctx.fillStyle = C.band; ctx.fillRect(xc - tw / 2 - 5, y - 11, tw + 10, 16);
        ctx.fillStyle = C.muted; ctx.textBaseline = 'alphabetic';
        richText(ctx, parts, xc, y, 'center', 10.5, 500);
      };
      label([['Hall insulator']], top1 + h1 * 0.55);
      label([['R'], ['xx', 1], [' → ∞']], top2 + h2 * 0.5);
    }

    // cursor and markers
    const xB = Math.round(X(state.B)) + 0.5;
    ctx.save(); ctx.strokeStyle = C.ink; ctx.globalAlpha = 0.35; ctx.setLineDash([2, 3]);
    ctx.beginPath(); ctx.moveTo(xB, top1); ctx.lineTo(xB, top2 + h2); ctx.stroke(); ctx.restore();
    const mark = (y, col, off) => {
      ctx.beginPath();
      if (off) { ctx.moveTo(xB, y - 6); ctx.lineTo(xB - 5, y + 3); ctx.lineTo(xB + 5, y + 3); ctx.closePath(); }
      else ctx.arc(xB, y, 5, 0, 2 * Math.PI);
      ctx.fillStyle = col; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = C.bg; ctx.stroke();
    };
    mark(Y1(Math.min(snap.tr.rxy, ymax1)), C.edge, snap.tr.rxy > ymax1);
    mark(Y2(Math.min(snap.tr.rxx, ymax2)), C.ext, snap.tr.rxx > ymax2);
  }
  function interp(arr, B) {
    const f = (B - curve.B0) / (curve.B1 - curve.B0) * (curve.n - 1);
    const k = clamp(Math.floor(f), 0, curve.n - 2), t = f - k;
    return arr[k] * (1 - t) + arr[k + 1] * t;
  }
  function niceStep(x) {
    const p = Math.pow(10, Math.floor(Math.log10(x))), m = x / p;
    return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p;
  }
  function niceCeil(x) { const s = niceStep(x / 3); return Math.ceil(x / s) * s; }
  function fmtK(r) { const k = r / 1e3; return k >= 10 || Number.isInteger(k) ? String(Math.round(k * 10) / 10) : k.toFixed(1); }

  /* ---------------- text readouts ---------------- */
  function fmtR(r) {
    if (r >= 1e7) return '> 10 MΩ';
    if (r >= 1e6) return (r / 1e6).toFixed(2) + ' MΩ';
    return r >= 1e3 ? (r / 1e3).toFixed(2) + ' kΩ' : Math.round(r) + ' Ω';
  }
  // plateau reached with N filled electron levels and p filled Λ levels
  function plateau(N, p, sgn) {
    let num = N, den = 1;
    if (p > 0) { den = sgn > 0 ? 2 * p + 1 : 2 * p - 1; num = N * den + p; }
    const g = gcd(num, den);
    return [num / g, den / g];
  }
  const nuStr = ([a, b]) => (b === 1 ? String(a) : `${a}/${b}`);
  const hStr = ([a, b]) => (b === 1 ? (a === 1 ? 'h/e²' : `h/${a}e²`) : a === 1 ? `${b}h/e²` : `${b}h/${a}e²`);

  function updateText() {
    const { B, nu, hw, EF, tr, hasExt, N, xN, fillN, K, G, fqh, cf } = snap;
    outB.textContent = B.toFixed(2) + ' T';
    outG.textContent = G.toFixed(2) + ' meV';
    ro.nu.textContent = nu.toFixed(3);
    ro.hw.textContent = hw.toFixed(1) + ' meV';
    ro.ef.textContent = EF.toFixed(1) + ' meV';
    ro.rxy.textContent = fmtR(tr.rxy);
    ro.rxy.title = `h/(${(RK / tr.rxy).toFixed(3)} e²)`;
    ro.rxx.textContent = tr.rxx < 1 ? '≈ 0 Ω' : fmtR(tr.rxx);
    const pct = Math.round(fillN * 100);
    const ch = (k) => (k === 1 ? '1 edge channel carries' : `${k} edge channels carry`);
    const hk = (k) => hStr([k, 1]);
    const rxxNote = tr.rxx < 60 ? 'R_xx ≈ 0'
      : tr.overlap > 0.05 ? 'R_xx stays small but finite because neighbouring levels start to overlap'
      : 'R_xx is small';
    let msg;
    if (tr.overlap > 0.3) {
      msg = `Landau levels overlap here (ħω_c ≈ ${(hw / G).toFixed(1)} Γ), so there is no gap to hide the Fermi level in. R_xy follows the classical line B/ne and R_xx shows only weak Shubnikov–de Haas oscillations.`;
    } else if (fqh) {
      const f = cf.f.toFixed(2), bs = `${cf.Bstar <= -0.05 ? '−' : ''}${Math.abs(cf.Bstar).toFixed(1)} T`;
      const intro = `Electrons in Landau level ${cf.N} (f = ${f} full) each bind two flux quanta and become composite fermions in an effective field B* = B(1 − 2f) = ${bs}.`;
      const pl = plateau(cf.N, snap.pCF, cf.sgn);
      if (snap.cfSea) {
        msg = `${intro} So close to half filling they barely feel a field and form a Fermi sea instead of filling Λ levels: no plateau, R_xx is finite and R_xy follows the classical line.`;
      } else if (snap.cfExt && cf.N === 0 && cf.sgn > 0 && snap.kCF === 0) {
        msg = `${intro} Their lowest Λ level sits at the composite-fermion Fermi energy and its orbits reach across the bar (red, dashed): this is the transition from the ν = 1/3 liquid to the Hall insulator. R_xy stays at 3h/e² throughout, while R_xx climbs steeply.`;
      } else if (snap.cfExt) {
        msg = `${intro} Their Λ level ${snap.kCF} sits at the composite-fermion Fermi energy and its orbits reach across the bar (red, dashed), so R_xx is finite and R_xy moves between fractional plateaus.`;
      } else if (snap.insulator) {
        msg = `${intro} All of them sit in localized orbits of the lowest Λ level and no edge channel is left, so the ν = 1/3 liquid has given way to a Hall insulator: R_xx diverges while R_xy stays near 3h/e².`;
      } else if (snap.pCF === 0) {
        msg = `${intro} All of them are localized in the lowest Λ level, so only the ${cf.N === 1 ? 'electron edge channel carries' : `${cf.N} electron edge channels carry`} current: R_xy = ${hk(cf.N)} and ${rxxNote}.`;
      } else {
        const lam = snap.pCF === 1 ? 'one Λ level' : `${snap.pCF} Λ levels`;
        const rev = cf.sgn < 0 ? ' B* points against B, so the composite-fermion channels (dashed) run backwards.' : '';
        msg = `${intro} They fill ${lam}, which is the ν = ${nuStr(pl)} state. Only edge channels carry current, so R_xy = ${hStr(pl)} and ${rxxNote}.${rev}`;
      }
    } else if (snap.insulator && !hasExt) {
      msg = `E_F has dropped below the extended states of the lowest Landau level (${pct}% full), so every state is localized and no edge channel survives: this is the Hall insulator. R_xx diverges, but R_xy stays near h/e², as the semicircle law σ_xx² + (σ_xy − ½)² = ¼ requires.`;
    } else if (hasExt && N === 0 && nu < 1) {
      msg = `E_F is inside the band of extended states of the lowest Landau level (${pct}% full), whose orbits reach across the bar (red): the sample is crossing from the ν = 1 plateau to the Hall insulator. On this semicircle transition R_xy stays at h/e², while R_xx climbs through h/e² at the critical point and then diverges.`;
    } else if (hasExt) {
      const below = N === 0 ? 'the insulating state' : `the ${hk(N)} plateau`;
      msg = `E_F is in the band of extended states near the centre of Landau level ${N}. Its orbits reach across the bar (red), so electrons can hop from one edge to the other and backscatter: R_xx is finite and R_xy sits between ${below} and the ${hk(N + 1)} plateau.`;
    } else if (xN < extWin.lo) {
      msg = `E_F is in the lower tail of Landau level ${N} (${pct}% full). Those electrons sit in isolated puddles in the potential valleys (amber) and carry no current. ${ch(K)} the current, so R_xy = ${hk(K)} and ${rxxNote}.`;
    } else {
      msg = `E_F is in the upper tail of Landau level ${N} (${pct}% full). The empty states are isolated orbits around potential hills (amber) and carry no current. ${ch(K)} the current, so R_xy = ${hk(K)} and ${rxxNote}.`;
    }
    // msg is built only from numbers computed here, so it is safe to set as HTML
    statusEl.innerHTML = msg
      .replace(/E_F/g, '<i>E</i><sub>F</sub>')
      .replace(/R_xy/g, '<i>R</i><sub>xy</sub>')
      .replace(/R_xx/g, '<i>R</i><sub>xx</sub>')
      .replace(/σ_xx/g, 'σ<sub>xx</sub>')
      .replace(/σ_xy/g, 'σ<sub>xy</sub>')
      .replace(/ħω_c/g, 'ħω<sub>c</sub>')
      .replace(/B\/ne/g, '<i>B</i>/<i>ne</i>')
      .replace(/B\* = B\(1 − 2f\)/g, '<i>B</i>* = <i>B</i>(1 − 2<i>f</i>)')
      .replace(/ν = /g, '<i>ν</i> = ')
      .replace(/B\* points against B/g, '<i>B</i>* points against <i>B</i>');
  }

  /* ---------------- orchestration ---------------- */
  function refreshAll() {
    computeSnapshot();
    drawDOS();
    drawGasStatic();
    drawGasFrame(performance.now());
    drawRB();
    updateText();
  }
  function rebuildModel() {
    buildTotal();
    measureExtendedWindow();
    buildCurve();
    refreshAll();
  }

  let pending = false;
  function setB(B, fromSlider) {
    state.B = clamp(B, B_MIN, bMax());
    if (!fromSlider) inB.value = state.B.toFixed(2);
    pending = true;
  }

  inB.addEventListener('input', () => { stopSweep(); setB(parseFloat(inB.value), true); });
  let gTimer = 0;
  inG.addEventListener('input', () => {
    state.gamma = parseFloat(inG.value);
    outG.textContent = state.gamma.toFixed(2) + ' meV';
    clearTimeout(gTimer);
    gTimer = setTimeout(rebuildModel, 40);
  });
  btnSeed.addEventListener('click', () => {
    state.seed = (state.seed * 7 + 11) % 100000;
    buildDisorder(state.seed);
    rebuildModel();
  });
  function applyMode() {
    swInt.setAttribute('aria-checked', String(state.interactions));
    root.classList.toggle('is-fqh', state.interactions);
    if (legendCF) legendCF.hidden = !state.interactions;
    if (dosNote) dosNote.textContent = state.interactions ? 'zoom: composite fermions in the partly filled level' : 'each level holds eB/h states per area';
    inB.max = String(bMax());
    state.B = clamp(state.B, B_MIN, bMax());
    inB.value = state.B.toFixed(2);
  }
  swInt.addEventListener('click', () => {
    state.interactions = !state.interactions;
    applyMode();
    buildCurve();
    refreshAll();
  });
  function stopSweep() {
    if (!state.sweeping) return;
    state.sweeping = false;
    btnSweep.setAttribute('aria-pressed', 'false');
    btnSweep.textContent = 'Sweep B';
  }
  btnSweep.addEventListener('click', () => {
    state.sweeping = !state.sweeping;
    btnSweep.setAttribute('aria-pressed', String(state.sweeping));
    btnSweep.textContent = state.sweeping ? 'Pause' : 'Sweep B';
    if (state.sweeping && state.B >= bMax() - 0.01) state.sweepDir = -1;
    if (state.sweeping && state.B <= B_MIN + 0.01) state.sweepDir = 1;
  });

  // drag on the R(B) chart to set the field
  let dragging = false;
  function bFromEvent(e) {
    const r = cvRB.getBoundingClientRect();
    return ((e.clientX - r.left - rbGeom.L) / rbGeom.pw) * curve.B1;
  }
  cvRB.addEventListener('pointerdown', (e) => {
    if (!rbGeom) return;
    dragging = true; stopSweep();
    cvRB.setPointerCapture(e.pointerId);
    setB(bFromEvent(e));
  });
  cvRB.addEventListener('pointermove', (e) => { if (dragging) setB(bFromEvent(e)); });
  const endDrag = () => { dragging = false; };
  cvRB.addEventListener('pointerup', endDrag);
  cvRB.addEventListener('pointercancel', endDrag);

  // animation loop (paused while the simulation is off screen)
  let visible = true, last = performance.now();
  if ('IntersectionObserver' in window) {
    new IntersectionObserver((ents) => { visible = ents[0].isIntersecting; }, { rootMargin: '100px' }).observe(root);
  }
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    if (visible) {
      if (state.sweeping) {
        let B = state.B + state.sweepDir * dt * bMax() / 16;
        if (B >= bMax()) { B = bMax(); state.sweepDir = -1; }
        if (B <= B_MIN) { B = B_MIN; state.sweepDir = 1; }
        setB(B);
      }
      if (pending) { pending = false; refreshAll(); }
      else if (!reduceMotion) drawGasFrame(now);
    }
    requestAnimationFrame(frame);
  }

  // theme and resize
  function onTheme() { readColors(); refreshAll(); }
  if (window.matchMedia) {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    if (mq.addEventListener) mq.addEventListener('change', onTheme);
  }
  new MutationObserver(onTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  let rsz = 0;
  if ('ResizeObserver' in window) {
    new ResizeObserver(() => { cancelAnimationFrame(rsz); rsz = requestAnimationFrame(refreshAll); }).observe(root);
  } else {
    window.addEventListener('resize', refreshAll);
  }

  // start
  readColors();
  state.B = parseFloat(inB.value) || state.B;
  state.gamma = parseFloat(inG.value) || state.gamma;
  applyMode();
  buildDisorder(state.seed);
  rebuildModel();
  requestAnimationFrame(frame);

  // read-only handle for checking the model from the console
  window.__qhe = {
    state, get snap() { return snap; }, get curve() { return curve; }, get extWin() { return extWin; },
    at(B) { const EF = ladderFermi(NU_B / B, HW_PER_T * B, state.gamma); const t = transportAt(B, EF); return { B, nu: NU_B / B, rxy: t.rxy, rxx: t.rxx, ins: isInsulator(B, t) }; },
    RK, NU_B,
  };
})();
