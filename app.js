/*
 * Interface de la simulation : commandes, schéma animé, résultats et courbes.
 * La physique est dans physics.js (objet Physique).
 */
(() => {
  "use strict";
  const P = Physique;
  const $ = (id) => document.getElementById(id);
  const DEG = Math.PI / 180;

  // ====================================================================
  // État de l'application
  // ====================================================================
  const DEFAUTS = { T: 300, f: 12, theta: 30, pol: "TE", ne0: 1e12 };
  const etat = { ...DEFAUTS, lecture: true, balayage: false };
  let res = null;          // résultats physiques du réglage courant
  let phase = 0;           // phase de l'animation (rad)
  let temps = 0;           // temps de l'animation (s), pour l'agitation des particules

  const SCENARIOS = {
    froid:   { T: 300,  f: 6,  theta: 20, pol: "TE", ne0: 1e12 },
    chaud:   { T: 1500, f: 6,  theta: 20, pol: "TE", ne0: 1e12 },
    angle20: { T: 300,  f: 11, theta: 20, pol: "TE", ne0: 1e12 },
    angle50: { T: 300,  f: 11, theta: 50, pol: "TE", ne0: 1e12 },
    dense:   { T: 600,  f: 40, theta: 30, pol: "TM", ne0: 1e13 },
  };

  // ====================================================================
  // Mise en forme des nombres
  // ====================================================================
  const SUP = { "-": "⁻", 0: "⁰", 1: "¹", 2: "²", 3: "³", 4: "⁴", 5: "⁵", 6: "⁶", 7: "⁷", 8: "⁸", 9: "⁹" };
  function sci(x, d = 2) {
    if (x === 0) return "0";
    const e = Math.floor(Math.log10(Math.abs(x)));
    const m = x / 10 ** e;
    if (e === 0) return x.toFixed(d);
    return `${m.toFixed(d)} × 10${String(e).split("").map((c) => SUP[c]).join("")}`;
  }
  function longueur(m) {
    if (m == null) return "∞";
    return m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${m.toFixed(1)} m`;
  }
  const pct = (x) => `${(x * 100).toFixed(2)} %`;
  const cplx = (z) => `${z.re.toFixed(3)} ${z.im < 0 ? "−" : "+"} ${Math.abs(z.im).toFixed(3)} i`;
  const fmtEps = (e) => (Math.abs(e) < 1000 ? e.toFixed(4) : sci(e));

  // Curseur logarithmique de Ne0 : position 0..100 <-> 1e11..1e13 m^-3
  const neDepuisPos = (p) => 10 ** (11 + (2 * p) / 100);
  const posDepuisNe = (ne) => Math.round((Math.log10(ne) - 11) * 50);

  // ====================================================================
  // Calcul physique du réglage courant
  // ====================================================================
  function calculer() {
    const theta = etat.theta * DEG;
    const w = 2 * Math.PI * etat.f * 1e6;
    const ne = P.densite(etat.T, etat.ne0);
    const wp = P.pulsationPlasma(ne);
    const fp = wp / (2 * Math.PI) / 1e6;
    const eps = P.permittivite(wp, w);
    const fr = P.fresnel(eps, theta, etat.pol);
    const lambda0 = P.C0 / (etat.f * 1e6);
    res = {
      ...fr, theta, w, ne, wp, fp, eps, lambda0,
      seuil: fp / Math.cos(theta),
      thetaB: P.angleBrewster(eps),
      thetaT: P.angleTransmis(eps, theta),
      thetaLim: P.angleLimite(eps),
      delta: P.profondeur(fr.kz2, lambda0),
    };
  }

  // ====================================================================
  // Schéma dynamique
  // ====================================================================
  const scene = $("scene");
  const sctx = scene.getContext("2d");
  const L = 2;                      // demi-largeur de la fenêtre, en longueurs d'onde λ0
  let SW = 0, SH = 0, LX = 1.25;    // taille du canvas (px CSS) et demi-hauteur (en λ0)
  const NZ = 240;                   // résolution horizontale du champ
  let NX = 150;
  let champRe = null, champIm = null, champMax = 1;
  const hors = document.createElement("canvas");
  const hctx = hors.getContext("2d");
  let image = null;
  let particules = [];

  // Palette : bleu (négatif), fond sombre (zéro), orange (positif)
  const PALETTE = (() => {
    const n = 512, lut = new Uint8ClampedArray(n * 3);
    const neg = [[5, 9, 19], [20, 70, 160], [58, 160, 255], [190, 230, 255]];
    const pos = [[5, 9, 19], [150, 50, 20], [255, 138, 61], [255, 225, 170]];
    const interp = (stops, t) => {
      const x = t * (stops.length - 1), i = Math.min(Math.floor(x), stops.length - 2), u = x - i;
      return stops[i].map((v, k) => v + (stops[i + 1][k] - v) * u);
    };
    for (let i = 0; i < n; i++) {
      const v = (i / (n - 1)) * 2 - 1;
      const c = v < 0 ? interp(neg, -v) : interp(pos, v);
      lut.set(c.map(Math.round), i * 3);
    }
    return lut;
  })();

  /** Pré-calcule le champ complexe U(x, z) sur la grille (une seule fois par réglage). */
  function precalculerChamp() {
    NX = Math.max(60, Math.round((NZ * SH) / Math.max(SW, 1)));
    champRe = new Float32Array(NX * NZ);
    champIm = new Float32Array(NX * NZ);
    const k0 = 2 * Math.PI, kx = Math.sin(res.theta), kz1 = res.kz1;
    const a = res.kz2.re, b = res.kz2.im;
    let max = 0;
    for (let j = 0; j < NX; j++) {
      const x = LX - ((j + 0.5) / NX) * 2 * LX;
      const px = k0 * kx * x;
      for (let i = 0; i < NZ; i++) {
        const z = -L + ((i + 0.5) / NZ) * 2 * L;
        let ur, ui;
        if (z < 0) {
          // Vide : onde incidente + onde réfléchie
          const p1 = px + k0 * kz1 * z, p2 = px - k0 * kz1 * z;
          ur = Math.cos(p1) + res.r.re * Math.cos(p2) - res.r.im * Math.sin(p2);
          ui = Math.sin(p1) + res.r.re * Math.sin(p2) + res.r.im * Math.cos(p2);
        } else {
          // Plasma : onde transmise (propagative) ou champ évanescent
          const amp = Math.exp(-k0 * b * z), p = px + k0 * a * z;
          const cr = amp * Math.cos(p), ci = amp * Math.sin(p);
          ur = res.t.re * cr - res.t.im * ci;
          ui = res.t.re * ci + res.t.im * cr;
        }
        const k = j * NZ + i;
        champRe[k] = ur;
        champIm[k] = ui;
        const m = ur * ur + ui * ui;
        if (m > max) max = m;
      }
    }
    champMax = Math.sqrt(max) || 1;
    hors.width = NZ;
    hors.height = NX;
    image = hctx.createImageData(NZ, NX);
  }

  /** Particules illustratives : espacement moyen proportionnel à Ne^(-1/3). */
  function construireParticules() {
    const d = Math.min(1.4, Math.max(0.16, 0.32 * Math.cbrt(1e12 / res.ne)));
    particules = [];
    let graine = 7;
    const alea = () => ((graine = (graine * 16807) % 2147483647) / 2147483647);
    for (let z = d / 2; z < L; z += d) {
      for (let x = -LX + d / 2; x < LX; x += d) {
        particules.push({ z, x, ion: true, ph: alea() * 6.28, ph2: alea() * 6.28, w: 2 + alea() * 2 });
        if (z + d / 2 < L && x + d / 2 < LX)
          particules.push({ z: z + d / 2, x: x + d / 2, ion: false, ph: alea() * 6.28, ph2: alea() * 6.28, w: 4 + alea() * 4 });
      }
    }
    particules.d = d;
  }

  function redimensionnerScene() {
    const dpr = window.devicePixelRatio || 1;
    SW = scene.clientWidth;
    SH = scene.clientHeight;
    scene.width = Math.round(SW * dpr);
    scene.height = Math.round(SH * dpr);
    sctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    LX = (L * SH) / SW;
  }

  function fleche(ctx, x0, y0, x1, y1, couleur, epaisseur = 3) {
    const ang = Math.atan2(y1 - y0, x1 - x0), tete = 12;
    ctx.save();
    ctx.strokeStyle = couleur;
    ctx.fillStyle = couleur;
    ctx.lineWidth = epaisseur;
    ctx.lineCap = "round";
    ctx.shadowColor = "rgba(0,0,0,0.8)";
    ctx.shadowBlur = 6;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1 - Math.cos(ang) * tete * 0.6, y1 - Math.sin(ang) * tete * 0.6);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x1 - tete * Math.cos(ang - 0.4), y1 - tete * Math.sin(ang - 0.4));
    ctx.lineTo(x1 - tete * Math.cos(ang + 0.4), y1 - tete * Math.sin(ang + 0.4));
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function etiquette(ctx, texte, x, y, couleur = "#e7edff", align = "center") {
    ctx.save();
    ctx.font = "600 13px Inter, Segoe UI, system-ui, sans-serif";
    ctx.textAlign = align;
    ctx.textBaseline = "middle";
    const w = ctx.measureText(texte).width;
    const x0 = align === "center" ? x - w / 2 : align === "right" ? x - w : x;
    ctx.fillStyle = "rgba(6,10,20,0.78)";
    ctx.beginPath();
    ctx.roundRect(x0 - 6, y - 11, w + 12, 22, 6);
    ctx.fill();
    ctx.fillStyle = couleur;
    ctx.fillText(texte, x, y);
    ctx.restore();
  }

  function arc(ctx, cx, cy, r, a0, a1, couleur) {
    ctx.save();
    ctx.strokeStyle = couleur;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, r, a0, a1);
    ctx.stroke();
    ctx.restore();
  }

  function dessinerScene() {
    if (!champRe || SW === 0) return;
    const ctx = sctx;

    // 1. Champ réel : Re(U e^{-i phase}) = Ur cos(phase) + Ui sin(phase)
    const c = Math.cos(phase), s = Math.sin(phase), data = image.data, inv = 1 / champMax;
    for (let k = 0; k < champRe.length; k++) {
      const v = (champRe[k] * c + champIm[k] * s) * inv;
      const idx = Math.max(0, Math.min(511, Math.round((v + 1) * 255.5))) * 3;
      const o = k * 4;
      data[o] = PALETTE[idx];
      data[o + 1] = PALETTE[idx + 1];
      data[o + 2] = PALETTE[idx + 2];
      data[o + 3] = 255;
    }
    hctx.putImageData(image, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(hors, 0, 0, SW, SH);

    const ox = SW / 2, oy = SH / 2;
    const ech = SW / (2 * L); // pixels par λ0
    const versX = (z) => ox + z * ech;
    const versY = (x) => oy - x * ech;

    // Léger voile sur le plasma
    ctx.fillStyle = "rgba(120, 90, 255, 0.06)";
    ctx.fillRect(ox, 0, SW / 2, SH);

    // 2. Particules (agitation thermique proportionnelle à √T)
    const agit = 0.07 * particules.d * Math.sqrt(etat.T / P.T0) * ech;
    for (const p of particules) {
      const a = p.ion ? agit * 0.35 : agit;
      const px = versX(p.z) + a * Math.sin(p.w * temps + p.ph);
      const py = versY(p.x) + a * Math.cos(p.w * 1.13 * temps + p.ph2);
      if (px < ox + 2) continue;
      ctx.beginPath();
      if (p.ion) {
        ctx.arc(px, py, 3.6, 0, 6.283);
        ctx.fillStyle = "rgba(243,246,255,0.92)";
        ctx.fill();
        ctx.lineWidth = 1;
        ctx.strokeStyle = "rgba(0,0,0,0.7)";
        ctx.stroke();
      } else {
        ctx.arc(px, py, 2.1, 0, 6.283);
        ctx.fillStyle = "#070b16";
        ctx.fill();
        ctx.lineWidth = 0.8;
        ctx.strokeStyle = "rgba(255,255,255,0.85)";
        ctx.stroke();
      }
    }

    // 3. Interface et normale
    ctx.save();
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(ox, 0);
    ctx.lineTo(ox, SH);
    ctx.stroke();
    ctx.setLineDash([8, 7]);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = "rgba(255,255,255,0.75)";
    ctx.beginPath();
    ctx.moveTo(0, oy);
    ctx.lineTo(SW, oy);
    ctx.stroke();
    ctx.restore();

    // 4. Rayons : longueur des flèches réfléchie et transmise selon √R et √T
    const lg = Math.min(SW, SH) * 0.42;
    const th = res.theta;
    fleche(ctx, ox - lg * Math.cos(th), oy + lg * Math.sin(th), ox, oy, "#ffffff");
    if (res.R > 0.01) {
      const lr = lg * Math.sqrt(res.R);
      fleche(ctx, ox, oy, ox - lr * Math.cos(th), oy - lr * Math.sin(th), "#ffd166");
    }
    if (res.propagative && res.T > 0.01) {
      const lt = lg * Math.sqrt(res.T), tt = res.thetaT;
      fleche(ctx, ox, oy, ox + lt * Math.cos(tt), oy - lt * Math.sin(tt), "#3ddc97");
    }

    // 5. Angles
    const ra = Math.min(70, lg * 0.45);
    if (etat.theta > 0.5) {
      arc(ctx, ox, oy, ra, Math.PI - th, Math.PI, "#ffffff");
      etiquette(ctx, `θ = ${etat.theta.toFixed(1)}°`, ox - (ra + 42) * Math.cos(th / 2), oy + (ra + 16) * Math.sin(th / 2) + 8);
      if (res.R > 0.01) {
        arc(ctx, ox, oy, ra * 0.8, Math.PI, Math.PI + th, "#ffd166");
        etiquette(ctx, `θr = ${etat.theta.toFixed(1)}°`, ox - (ra + 42) * Math.cos(th / 2), oy - (ra + 16) * Math.sin(th / 2) - 8, "#ffd166");
      }
      if (res.propagative && res.T > 0.01) {
        const tt = res.thetaT;
        arc(ctx, ox, oy, ra, -tt, 0, "#3ddc97");
        etiquette(ctx, `θt = ${(tt / DEG).toFixed(1)}°`, ox + (ra + 44) * Math.cos(tt / 2), oy - (ra + 14) * Math.sin(tt / 2) - 6, "#3ddc97");
      }
    }

    // 6. Textes
    etiquette(ctx, "VIDE", 14, 22, "#e7edff", "left");
    etiquette(ctx, `PLASMA  ·  Ne = ${sci(res.ne, 1)} m⁻³`, SW - 14, 22, "#e7edff", "right");
    if (!res.propagative) {
      etiquette(ctx, `champ évanescent : δ = ${(res.delta / res.lambda0).toFixed(2)} λ0`, SW - 14, SH - 22, "#ff8a9a", "right");
      // Repère de la profondeur de pénétration
      const xd = ox + (res.delta / res.lambda0) * ech;
      if (xd < SW - 10) {
        ctx.save();
        ctx.setLineDash([4, 4]);
        ctx.strokeStyle = "#ff8a9a";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(xd, 40);
        ctx.lineTo(xd, SH - 44);
        ctx.stroke();
        ctx.restore();
        etiquette(ctx, "δ", xd, 52, "#ff8a9a");
      }
    }
    // Échelle : une longueur d'onde dans le vide
    ctx.save();
    ctx.strokeStyle = "#e7edff";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(16, SH - 18);
    ctx.lineTo(16 + ech, SH - 18);
    ctx.moveTo(16, SH - 23);
    ctx.lineTo(16, SH - 13);
    ctx.moveTo(16 + ech, SH - 23);
    ctx.lineTo(16 + ech, SH - 13);
    ctx.stroke();
    ctx.restore();
    etiquette(ctx, `λ0 = ${longueur(res.lambda0)}`, 16 + ech / 2, SH - 38);
    etiquette(ctx, "incidente", 14, 54, "#ffffff", "left");
    if (res.R > 0.01) etiquette(ctx, "réfléchie", 14, 84, "#ffd166", "left");
    if (res.propagative && res.T > 0.01) etiquette(ctx, "transmise", SW - 14, 54, "#3ddc97", "right");
  }

  // ====================================================================
  // Graphiques (canvas, sans bibliothèque)
  // ====================================================================
  function graduations(min, max, n = 6) {
    const pas0 = (max - min) / n;
    const mag = 10 ** Math.floor(Math.log10(pas0));
    const norm = pas0 / mag;
    const pas = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
    const t = [];
    for (let v = Math.ceil(min / pas) * pas; v <= max + 1e-9; v += pas) t.push(+v.toFixed(10));
    return t;
  }

  /**
   * cfg = { x, series: [{ y, couleur }], xmin, xmax, ymin, ymax, xlabel, ylabel,
   *         zones: [{ x0, x1, texte }], reperes: [{ x, texte, pointille }],
   *         curseur: { x, points: [{ y, couleur }] }, unite, infobulle(i) }
   */
  function tracer(cv, cfg) {
    const dpr = window.devicePixelRatio || 1;
    const W = cv.clientWidth, H = cv.clientHeight;
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) {
      cv.width = Math.round(W * dpr);
      cv.height = Math.round(H * dpr);
    }
    const ctx = cv.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const pad = { l: 46, r: 12, t: 14, b: 38 };
    const X = (v) => pad.l + ((v - cfg.xmin) / (cfg.xmax - cfg.xmin)) * (W - pad.l - pad.r);
    const Y = (v) => H - pad.b - ((v - cfg.ymin) / (cfg.ymax - cfg.ymin)) * (H - pad.t - pad.b);
    cv._cfg = cfg;
    cv._pad = pad;
    ctx.font = "11px Inter, Segoe UI, system-ui, sans-serif";

    // Zones grisées
    for (const z of cfg.zones || []) {
      const a = X(Math.max(z.x0, cfg.xmin)), b = X(Math.min(z.x1, cfg.xmax));
      if (b <= a) continue;
      ctx.fillStyle = "rgba(139,152,186,0.10)";
      ctx.fillRect(a, pad.t, b - a, H - pad.t - pad.b);
      ctx.fillStyle = "#8b98ba";
      ctx.textAlign = "left";
      ctx.fillText(z.texte, a + 6, pad.t + 13);
    }

    // Grille et graduations
    ctx.strokeStyle = "rgba(139,152,186,0.13)";
    ctx.fillStyle = "#8b98ba";
    ctx.lineWidth = 1;
    ctx.textAlign = "center";
    for (const v of graduations(cfg.xmin, cfg.xmax)) {
      ctx.beginPath();
      ctx.moveTo(X(v), pad.t);
      ctx.lineTo(X(v), H - pad.b);
      ctx.stroke();
      ctx.fillText(String(v), X(v), H - pad.b + 15);
    }
    ctx.textAlign = "right";
    for (const v of graduations(cfg.ymin, cfg.ymax, 5)) {
      ctx.beginPath();
      ctx.moveTo(pad.l, Y(v));
      ctx.lineTo(W - pad.r, Y(v));
      ctx.stroke();
      ctx.fillText(String(v), pad.l - 6, Y(v) + 4);
    }
    ctx.textAlign = "center";
    ctx.fillText(cfg.xlabel, pad.l + (W - pad.l - pad.r) / 2, H - 6);
    ctx.save();
    ctx.translate(12, pad.t + (H - pad.t - pad.b) / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText(cfg.ylabel, 0, 0);
    ctx.restore();

    // Repères verticaux
    let decal = 0;
    for (const r of cfg.reperes || []) {
      if (r.x < cfg.xmin || r.x > cfg.xmax) continue;
      ctx.save();
      ctx.strokeStyle = "rgba(231,237,255,0.55)";
      ctx.setLineDash(r.pointille ? [3, 4] : [7, 5]);
      ctx.beginPath();
      ctx.moveTo(X(r.x), pad.t);
      ctx.lineTo(X(r.x), H - pad.b);
      ctx.stroke();
      ctx.restore();
      const droite = X(r.x) > W - 150;
      const tw = ctx.measureText(r.texte).width;
      const tx = droite ? X(r.x) - 6 - tw : X(r.x) + 6;
      const ty = pad.t + 30 + decal;
      ctx.fillStyle = "rgba(10,17,34,0.85)";
      ctx.beginPath();
      ctx.roundRect(tx - 4, ty - 11, tw + 8, 16, 4);
      ctx.fill();
      ctx.fillStyle = "#c9d3ee";
      ctx.textAlign = "left";
      ctx.fillText(r.texte, tx, ty);
      decal += 14;
    }

    // Courbes
    for (const s of cfg.series) {
      ctx.save();
      ctx.strokeStyle = s.couleur;
      ctx.lineWidth = 2.5;
      ctx.lineJoin = "round";
      ctx.beginPath();
      cfg.x.forEach((xv, i) => (i ? ctx.lineTo(X(xv), Y(s.y[i])) : ctx.moveTo(X(xv), Y(s.y[i]))));
      ctx.stroke();
      if (s.remplir) {
        ctx.lineTo(X(cfg.x[cfg.x.length - 1]), Y(0));
        ctx.lineTo(X(cfg.x[0]), Y(0));
        ctx.closePath();
        ctx.globalAlpha = 0.15;
        ctx.fillStyle = s.couleur;
        ctx.fill();
      }
      ctx.restore();
    }

    // Réglage actuel
    if (cfg.curseur) {
      const cx = X(cfg.curseur.x);
      ctx.strokeStyle = "#ffd166";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(cx, pad.t);
      ctx.lineTo(cx, H - pad.b);
      ctx.stroke();
      for (const p of cfg.curseur.points) {
        ctx.beginPath();
        ctx.arc(cx, Y(p.y), 5.5, 0, 6.283);
        ctx.fillStyle = p.couleur;
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = "#ffffff";
        ctx.stroke();
      }
    }

    // Info-bulle au survol
    if (cv._survol != null && cfg.infobulle) {
      const xv = cv._survol;
      let i = 0;
      for (let k = 1; k < cfg.x.length; k++) if (Math.abs(cfg.x[k] - xv) < Math.abs(cfg.x[i] - xv)) i = k;
      const hx = X(cfg.x[i]);
      ctx.save();
      ctx.strokeStyle = "rgba(231,237,255,0.35)";
      ctx.beginPath();
      ctx.moveTo(hx, pad.t);
      ctx.lineTo(hx, H - pad.b);
      ctx.stroke();
      const lignes = cfg.infobulle(i);
      ctx.font = "12px Inter, Segoe UI, system-ui, sans-serif";
      const lw = Math.max(...lignes.map((l) => ctx.measureText(l).width)) + 16;
      const bx = hx + 10 + lw > W - pad.r ? hx - 10 - lw : hx + 10;
      ctx.fillStyle = "rgba(10,17,34,0.95)";
      ctx.strokeStyle = "#2a3a62";
      ctx.beginPath();
      ctx.roundRect(bx, pad.t + 6, lw, lignes.length * 17 + 10, 8);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#e7edff";
      ctx.textAlign = "left";
      lignes.forEach((l, k) => ctx.fillText(l, bx + 8, pad.t + 23 + k * 17));
      ctx.restore();
    }
  }

  /** Survol (info-bulle) et clic / glissé pour choisir la valeur directement sur la courbe. */
  function rendreInteractif(cv, choisir) {
    const versX = (ev) => {
      const r = cv.getBoundingClientRect(), cfg = cv._cfg, pad = cv._pad;
      const u = (ev.clientX - r.left - pad.l) / (r.width - pad.l - pad.r);
      return cfg.xmin + Math.max(0, Math.min(1, u)) * (cfg.xmax - cfg.xmin);
    };
    let appui = false;
    cv.addEventListener("pointerdown", (ev) => {
      if (!choisir) return;
      appui = true;
      cv.setPointerCapture(ev.pointerId);
      choisir(versX(ev));
    });
    cv.addEventListener("pointermove", (ev) => {
      if (!cv._cfg) return;
      cv._survol = versX(ev);
      if (appui && choisir) choisir(cv._survol);
      else tracer(cv, cv._cfg);
    });
    cv.addEventListener("pointerup", () => (appui = false));
    cv.addEventListener("pointerleave", () => {
      cv._survol = null;
      if (cv._cfg) tracer(cv, cv._cfg);
    });
  }

  let donneesF = null, donneesA = null;

  function dessinerGraphiques() {
    // R et T en fonction de la fréquence
    const fs = [], Rf = [], Tf = [];
    for (let k = 0; k <= 600; k++) {
      const f = 0.5 + (59.5 * k) / 600;
      const e = P.permittivite(res.wp, 2 * Math.PI * f * 1e6);
      const r = P.fresnel(e, res.theta, etat.pol);
      fs.push(f);
      Rf.push(r.R * 100);
      Tf.push(r.T * 100);
    }
    donneesF = { fs, Rf, Tf };
    const reperesF = [{ x: res.fp, texte: `fp = ${res.fp.toFixed(2)} MHz`, pointille: true }];
    if (etat.theta > 0.5) reperesF.push({ x: res.seuil, texte: `fp / cos θ = ${res.seuil.toFixed(2)} MHz` });
    tracer($("chF"), {
      x: fs, xmin: 0.5, xmax: 60, ymin: 0, ymax: 100,
      xlabel: "Fréquence f (MHz)", ylabel: "Puissance (%)",
      series: [{ y: Rf, couleur: "#ff6b6b" }, { y: Tf, couleur: "#3ddc97" }],
      zones: [{ x0: 0.5, x1: res.seuil, texte: "évanescente" }],
      reperes: reperesF,
      curseur: { x: etat.f, points: [{ y: res.R * 100, couleur: "#ff6b6b" }, { y: res.T * 100, couleur: "#3ddc97" }] },
      infobulle: (i) => [`f = ${fs[i].toFixed(2)} MHz`, `R = ${Rf[i].toFixed(2)} %`, `T = ${Tf[i].toFixed(2)} %`],
    });
    $("capF").textContent = `θ = ${etat.theta.toFixed(1)}°, ${etat.pol}, T = ${etat.T} K. Zone grisée : f cos θ < fp. Cliquer ou glisser sur la courbe pour changer la fréquence.`;

    // R et T en fonction de l'angle
    const ths = [], Ra = [], Ta = [];
    for (let k = 0; k <= 600; k++) {
      const td = (89.5 * k) / 600;
      const r = P.fresnel(res.eps, td * DEG, etat.pol);
      ths.push(td);
      Ra.push(r.R * 100);
      Ta.push(r.T * 100);
    }
    donneesA = { ths, Ra, Ta };
    const reperesA = [];
    if (res.thetaB != null && etat.pol === "TM") reperesA.push({ x: res.thetaB / DEG, texte: `θB = ${(res.thetaB / DEG).toFixed(1)}°`, pointille: true });
    const zonesA = res.thetaLim != null ? [{ x0: res.thetaLim / DEG, x1: 89.5, texte: "évanescente" }] : [];
    tracer($("chA"), {
      x: ths, xmin: 0, xmax: 89.5, ymin: 0, ymax: 100,
      xlabel: "Angle d'incidence θ (°)", ylabel: "Puissance (%)",
      series: [{ y: Ra, couleur: "#ff6b6b" }, { y: Ta, couleur: "#3ddc97" }],
      zones: zonesA, reperes: reperesA,
      curseur: { x: etat.theta, points: [{ y: res.R * 100, couleur: "#ff6b6b" }, { y: res.T * 100, couleur: "#3ddc97" }] },
      infobulle: (i) => [`θ = ${ths[i].toFixed(1)}°`, `R = ${Ra[i].toFixed(2)} %`, `T = ${Ta[i].toFixed(2)} %`],
    });
    $("capA").textContent = `f = ${etat.f.toFixed(1)} MHz, εr = ${fmtEps(res.eps)}. Basculer TE / TM pour comparer : seule la polarisation TM a un angle de Brewster.`;

    // Amplitude du champ dans le plasma
    const dl = res.delta != null ? res.delta / res.lambda0 : null;
    const zmax = Math.min(20, dl == null ? 3 : Math.max(3, 4 * dl));
    const zs = [], amp = [];
    const at = P.abs(res.t);
    for (let k = 0; k <= 300; k++) {
      const z = (zmax * k) / 300;
      zs.push(z);
      amp.push(at * Math.exp(-2 * Math.PI * res.kz2.im * z));
    }
    const ymax = Math.max(1, at) * 1.15;
    tracer($("chZ"), {
      x: zs, xmin: 0, xmax: zmax, ymin: 0, ymax: +ymax.toFixed(2),
      xlabel: "Profondeur dans le plasma z / λ0", ylabel: `|${etat.pol === "TE" ? "E" : "H"}| (normalisé)`,
      series: [{ y: amp, couleur: "#3ddc97", remplir: true }],
      reperes: dl != null ? [{ x: dl, texte: `δ = ${dl.toFixed(2)} λ0 = ${longueur(res.delta)}` }] : [],
      infobulle: (i) => [`z = ${zs[i].toFixed(2)} λ0`, `|champ| = ${amp[i].toFixed(3)}`],
    });
    $("capZ").textContent = res.propagative
      ? `Onde propagative : amplitude constante |t| = ${at.toFixed(3)} (pas de pertes), puissance transmise T = ${pct(res.T)}.`
      : `Onde évanescente : l'amplitude décroît en exp(−z/δ). Le champ existe près de l'interface, mais le flux moyen de Poynting vers la profondeur est nul (T = 0 %).`;
  }

  // ====================================================================
  // Mise à jour de l'affichage
  // ====================================================================
  function remplirCurseur(el) {
    const p = ((el.value - el.min) / (el.max - el.min)) * 100;
    el.style.setProperty("--p", `${p}%`);
  }

  function majAffichage() {
    // Commandes
    $("rngT").value = etat.T;
    $("rngF").value = etat.f;
    $("rngTh").value = etat.theta;
    $("rngNe").value = posDepuisNe(etat.ne0);
    ["rngT", "rngF", "rngTh", "rngNe"].forEach((id) => remplirCurseur($(id)));
    $("valT").textContent = `${etat.T} K`;
    $("valF").textContent = `${etat.f.toFixed(1)} MHz`;
    $("valTh").textContent = `${etat.theta.toFixed(1)}°`;
    $("valNe").textContent = `${sci(etat.ne0, 1)} m⁻³`;
    $("chipNe0").textContent = sci(etat.ne0, 1);
    $("polTE").classList.toggle("on", etat.pol === "TE");
    $("polTM").classList.toggle("on", etat.pol === "TM");
    $("btnPlay").textContent = etat.lecture ? "⏸ Pause" : "▶ Lecture";
    $("btnSweep").classList.toggle("active", etat.balayage);
    $("btnSweep").textContent = etat.balayage ? "■ Arrêter le balayage" : "Balayage automatique en fréquence";
    const b = $("btnBrewster");
    b.disabled = res.thetaB == null;
    b.textContent = res.thetaB == null ? "Pas d'angle de Brewster (εr ≤ 0)" : `Aller à l'angle de Brewster (${(res.thetaB / DEG).toFixed(1)}°, TM)`;

    // Indicateurs
    $("mNe").textContent = sci(res.ne);
    $("mNeSub").textContent = `${res.ne >= etat.ne0 ? "+" : ""}${((res.ne / etat.ne0 - 1) * 100).toFixed(0)} % par rapport à Ne0`;
    $("mFp").textContent = `${res.fp.toFixed(3)} MHz`;
    $("mFpSub").textContent = `ωp = ${sci(res.wp)} rad/s`;
    $("mEps").textContent = fmtEps(res.eps);
    $("mEpsSub").textContent = `sin²θ = ${(Math.sin(res.theta) ** 2).toFixed(4)}`;
    const etatEl = $("mEtat");
    etatEl.textContent = res.propagative ? "Propagative" : "Évanescente";
    etatEl.className = res.propagative ? "ok" : "err";
    $("mEtatSub").textContent = res.propagative ? "εr > sin²θ" : "εr < sin²θ";
    $("mSeuil").textContent = `${res.seuil.toFixed(3)} MHz`;
    $("mSeuilSub").textContent = `f cos θ = ${(etat.f * Math.cos(res.theta)).toFixed(3)} MHz`;
    if (res.propagative) {
      $("mXLab").textContent = "Angle de réfraction θt";
      $("mX").textContent = `${(res.thetaT / DEG).toFixed(2)}°`;
      $("mXSub").textContent = "sin θt = sin θ / √εr";
    } else {
      $("mXLab").textContent = "Profondeur de pénétration δ";
      $("mX").textContent = longueur(res.delta);
      $("mXSub").textContent = `soit ${(res.delta / res.lambda0).toFixed(3)} λ0`;
    }

    // Bilan de puissance
    $("barR").style.width = `${res.R * 100}%`;
    $("barT").style.width = `${res.T * 100}%`;
    $("barRt").textContent = res.R > 0.12 ? `R ${(res.R * 100).toFixed(1)} %` : "";
    $("barTt").textContent = res.T > 0.12 ? `T ${(res.T * 100).toFixed(1)} %` : "";
    $("mR").textContent = pct(res.R);
    $("mT").textContent = pct(res.T);
    $("mSum").textContent = pct(res.R + res.T);

    // Coefficients et angles
    $("coeffs").innerHTML = [
      ["r", cplx(res.r)], ["|r|", P.abs(res.r).toFixed(4)],
      ["t", cplx(res.t)], ["|t|", P.abs(res.t).toFixed(4)],
      ["kz2 / k0", cplx(res.kz2)], ["λ0 (vide)", longueur(res.lambda0)],
    ].map(([k, v]) => `<li><span>${k}</span><b>${v}</b></li>`).join("");
    const lim = res.thetaLim == null ? "aucun, propagation à tout angle"
      : res.thetaLim === 0 ? "0°, évanescente à tout angle" : `${(res.thetaLim / DEG).toFixed(2)}°`;
    $("angles").innerHTML = [
      ["Brewster θB (TM)", res.thetaB == null ? "aucun (εr ≤ 0)" : `${(res.thetaB / DEG).toFixed(2)}°`],
      ["Angle limite θlim", lim],
      ["En TE", "R ne s'annule jamais"],
    ].map(([k, v]) => `<li><span>${k}</span><b>${v}</b></li>`).join("");

    // Message d'état
    const st = $("status");
    const fc = (etat.f * Math.cos(res.theta)).toFixed(2), fp = res.fp.toFixed(2);
    const s2 = (Math.sin(res.theta) ** 2).toFixed(4), e = fmtEps(res.eps);
    if (res.propagative) {
      st.className = "status ok";
      st.innerHTML = `<b>Onde propagative.</b> f cos θ = ${fc} MHz &gt; fp = ${fp} MHz, donc εr = ${e} &gt; sin²θ = ${s2}. ${pct(res.T)} de la puissance entre dans le plasma, ${pct(res.R)} est réfléchie.`;
    } else if (etat.f > res.fp) {
      st.className = "status warn";
      st.innerHTML = `<b>Onde évanescente alors que f &gt; fp.</b> f = ${etat.f.toFixed(2)} MHz dépasse fp = ${fp} MHz, mais f cos θ = ${fc} MHz &lt; fp : c'est l'angle qui empêche la propagation (εr = ${e} &lt; sin²θ = ${s2}). Réflexion totale, le champ décroît sur δ = ${longueur(res.delta)} sans transporter de puissance moyenne.`;
    } else {
      st.className = "status err";
      st.innerHTML = `<b>Onde évanescente.</b> f = ${etat.f.toFixed(2)} MHz &lt; fp = ${fp} MHz, donc εr = ${e} &lt; 0. Réflexion totale. Un champ existe dans le plasma sur δ = ${longueur(res.delta)}, mais il ne transporte aucune puissance moyenne vers la profondeur.`;
    }
    $("sceneNote").textContent =
      "Trait plein : interface. Pointillés : normale. Longueur des flèches réfléchie et transmise proportionnelle à √R et √T. " +
      "Particules illustratives : leur espacement moyen varie comme Ne^(−1/3), il augmente quand on chauffe, et leur agitation croît avec √T.";
  }

  // ====================================================================
  // Rafraîchissement complet après un changement de réglage
  // ====================================================================
  function rafraichir() {
    calculer();
    precalculerChamp();
    construireParticules();
    majAffichage();
    dessinerGraphiques();
    dessinerScene();
    history.replaceState(null, "", `#T=${etat.T}&f=${etat.f}&th=${etat.theta}&pol=${etat.pol}&ne=${etat.ne0.toExponential(2).replace("+", "")}`);
  }

  function regler(p) {
    Object.assign(etat, p);
    etat.f = Math.round(etat.f * 10) / 10;
    etat.theta = Math.round(etat.theta * 10) / 10;
    rafraichir();
  }

  // ====================================================================
  // Commandes
  // ====================================================================
  $("rngT").addEventListener("input", (e) => regler({ T: +e.target.value }));
  $("rngF").addEventListener("input", (e) => regler({ f: +e.target.value, balayage: false }));
  $("rngTh").addEventListener("input", (e) => regler({ theta: +e.target.value }));
  $("rngNe").addEventListener("input", (e) => regler({ ne0: +neDepuisPos(+e.target.value).toPrecision(3) }));
  $("polTE").addEventListener("click", () => regler({ pol: "TE" }));
  $("polTM").addEventListener("click", () => regler({ pol: "TM" }));
  $("btnPlay").addEventListener("click", () => { etat.lecture = !etat.lecture; majAffichage(); });
  $("btnReset").addEventListener("click", () => regler({ ...DEFAUTS, balayage: false, lecture: true }));
  $("btnBrewster").addEventListener("click", () => {
    if (res.thetaB != null) regler({ pol: "TM", theta: res.thetaB / DEG });
  });
  $("btnSweep").addEventListener("click", () => {
    etat.balayage = !etat.balayage;
    if (etat.balayage && etat.f > 58) etat.f = 1;
    majAffichage();
  });
  $("btnShare").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(location.href);
      notifier("Lien copié : il ouvre la simulation avec ce réglage.");
    } catch {
      notifier("Copie impossible : copier l'adresse de la page.");
    }
  });
  $("btnPng").addEventListener("click", () => {
    const a = document.createElement("a");
    a.download = `plasma_${etat.pol}_${etat.T}K_${etat.f}MHz_${etat.theta}deg.png`;
    a.href = scene.toDataURL("image/png");
    a.click();
  });

  function telecharger(nom, lignes) {
    const blob = new Blob([lignes.join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = nom;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  $("csvF").addEventListener("click", () => {
    const l = ["f_MHz;R_pourcent;T_pourcent"];
    donneesF.fs.forEach((f, i) => l.push(`${f.toFixed(3)};${donneesF.Rf[i].toFixed(4)};${donneesF.Tf[i].toFixed(4)}`));
    telecharger("R_T_frequence.csv", l);
  });
  $("csvA").addEventListener("click", () => {
    const l = ["theta_deg;R_pourcent;T_pourcent"];
    donneesA.ths.forEach((t, i) => l.push(`${t.toFixed(3)};${donneesA.Ra[i].toFixed(4)};${donneesA.Ta[i].toFixed(4)}`));
    telecharger("R_T_angle.csv", l);
  });

  // Scénarios des explorations
  document.querySelectorAll("[data-scn]").forEach((btn) =>
    btn.addEventListener("click", () => {
      const n = btn.dataset.scn;
      if (n === "balayage") {
        regler({ T: 300, f: 1, theta: 30, pol: "TE", ne0: 1e12, balayage: true, lecture: true });
      } else if (n === "brewTM" || n === "brewTE") {
        const wp = P.pulsationPlasma(P.densite(300, 1e12));
        const e = P.permittivite(wp, 2 * Math.PI * 20e6);
        regler({ T: 300, f: 20, ne0: 1e12, pol: n === "brewTM" ? "TM" : "TE", theta: P.angleBrewster(e) / DEG, balayage: false });
      } else {
        regler({ ...SCENARIOS[n], balayage: false });
      }
      document.querySelector(".scene-card").scrollIntoView({ behavior: "smooth", block: "center" });
    })
  );

  // Courbes interactives : choisir f ou θ directement sur le graphique
  rendreInteractif($("chF"), (x) => regler({ f: Math.max(1, Math.min(60, x)), balayage: false }));
  rendreInteractif($("chA"), (x) => regler({ theta: Math.max(0, Math.min(89, x)) }));
  rendreInteractif($("chZ"), null);

  // Raccourcis clavier
  document.addEventListener("keydown", (e) => {
    if (e.target.tagName === "INPUT" || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.code === "Space") {
      e.preventDefault();
      etat.lecture = !etat.lecture;
      majAffichage();
    } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      const pas = e.shiftKey ? 5 : 0.5;
      regler({ theta: Math.max(0, Math.min(89, etat.theta + (e.key === "ArrowRight" ? pas : -pas))) });
    } else if (e.key === "p" || e.key === "P") {
      regler({ pol: etat.pol === "TE" ? "TM" : "TE" });
    } else if (e.key === "r" || e.key === "R") {
      regler({ ...DEFAUTS, balayage: false, lecture: true });
    }
  });

  let minuteur = null;
  function notifier(texte) {
    const t = $("toast");
    t.textContent = texte;
    t.classList.add("show");
    clearTimeout(minuteur);
    minuteur = setTimeout(() => t.classList.remove("show"), 2200);
  }

  // Lecture du réglage depuis l'adresse (lien partagé)
  function lireAdresse() {
    const q = new URLSearchParams(location.hash.slice(1));
    const num = (k, min, max) => {
      const v = parseFloat(q.get(k));
      return Number.isFinite(v) ? Math.max(min, Math.min(max, v)) : null;
    };
    const p = {};
    const T = num("T", 150, 3000), f = num("f", 1, 60), th = num("th", 0, 89), ne = num("ne", 1e11, 1e13);
    if (T != null) p.T = Math.round(T / 10) * 10;
    if (f != null) p.f = f;
    if (th != null) p.theta = th;
    if (ne != null) p.ne0 = ne;
    if (q.get("pol") === "TE" || q.get("pol") === "TM") p.pol = q.get("pol");
    Object.assign(etat, p);
  }

  // ====================================================================
  // Boucle d'animation
  // ====================================================================
  let avant = performance.now();
  function boucle(maintenant) {
    const dt = Math.min(0.05, (maintenant - avant) / 1000);
    avant = maintenant;
    if (etat.balayage) {
      const f = Math.round((etat.f + 0.1) * 10) / 10;
      if (f > 60) {
        etat.balayage = false;
        majAffichage();
      } else {
        regler({ f });
      }
    }
    if (etat.lecture) {
      phase = (phase + dt * 2 * Math.PI * 0.55) % (2 * Math.PI);
      temps += dt;
      dessinerScene();
    }
    requestAnimationFrame(boucle);
  }

  window.addEventListener("hashchange", () => {
    lireAdresse();
    rafraichir();
  });

  // Démarrage
  lireAdresse();
  redimensionnerScene();
  rafraichir();
  new ResizeObserver(() => {
    redimensionnerScene();
    precalculerChamp();
    construireParticules();
    dessinerScene();
    dessinerGraphiques();
  }).observe(scene);
  requestAnimationFrame(boucle);
})();
