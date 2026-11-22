/*
 * Modèle physique : réflexion d'une onde EM sur un plasma soumis à une dilatation.
 *
 * Plasma idéal, non magnétisé, sans collisions, homogène et semi-infini.
 * Dilatation à pression constante, degré d'ionisation constant :
 *     Ne(T) = Ne0 * T0 / T
 *
 * Mêmes formules que la version Python (physics.py).
 */
const Physique = (() => {
  "use strict";

  // Constantes physiques (SI)
  const E_CHARGE = 1.602176634e-19; // C
  const M_E = 9.1093837015e-31;     // kg
  const EPS0 = 8.8541878128e-12;    // F/m
  const C0 = 299792458;             // m/s
  const T0 = 300;                   // K, température de référence

  // Nombres complexes : objets { re, im }
  const cx = (re, im = 0) => ({ re, im });
  const add = (a, b) => cx(a.re + b.re, a.im + b.im);
  const sub = (a, b) => cx(a.re - b.re, a.im - b.im);
  const div = (a, b) => {
    const d = b.re * b.re + b.im * b.im;
    return cx((a.re * b.re + a.im * b.im) / d, (a.im * b.re - a.re * b.im) / d);
  };
  const abs2 = (a) => a.re * a.re + a.im * a.im;
  const abs = (a) => Math.sqrt(abs2(a));

  // Racine d'un réel : réelle si x >= 0, imaginaire pure (Im > 0) si x < 0
  const racine = (x) => (x >= 0 ? cx(Math.sqrt(x), 0) : cx(0, Math.sqrt(-x)));

  /** Densité électronique après dilatation à pression constante. */
  function densite(T, ne0, t0 = T0) {
    return (ne0 * t0) / T;
  }

  /** Pulsation plasma wp = sqrt(Ne e² / (eps0 me)), en rad/s. */
  function pulsationPlasma(ne) {
    return Math.sqrt((ne * E_CHARGE * E_CHARGE) / (EPS0 * M_E));
  }

  /** Permittivité relative eps_r = 1 - wp² / w² (réelle, peut être négative). */
  function permittivite(wp, w) {
    return 1 - (wp * wp) / (w * w);
  }

  /**
   * Coefficients de Fresnel vide -> plasma.
   * theta en radians, pol = "TE" ou "TM" (en TM, r et t sont écrits pour H).
   * Nombres d'onde normalisés par k0 :
   *   kz1 = cos(theta)                  dans le vide
   *   kz2 = sqrt(eps_r - sin²(theta))   dans le plasma
   * Si eps_r < sin²(theta), kz2 est imaginaire pur avec Im(kz2) > 0 :
   * le champ décroît dans le plasma, l'onde est évanescente.
   */
  function fresnel(eps, theta, pol) {
    const s = Math.sin(theta);
    const kz1 = Math.cos(theta);
    const d = eps - s * s;
    const kz2 = racine(d);
    const propagative = d > 0;

    let num, den;
    if (pol === "TE") {
      num = sub(cx(kz1), kz2);
      den = add(cx(kz1), kz2);
    } else {
      num = sub(cx(eps * kz1), kz2);
      den = add(cx(eps * kz1), kz2);
    }
    // Cas limite exact (kz2 = 0 et eps = 0) : réflexion totale
    const r = abs(den) < 1e-12 ? cx(pol === "TM" ? -1 : 1) : div(num, den);
    const t = add(cx(1), r); // continuité de la composante tangentielle

    const R = abs2(r);
    let T = 0;
    if (propagative) {
      // Conversion amplitudes -> puissances : rapport des flux de Poynting
      // selon la normale (et pas seulement |t|²)
      T = pol === "TE" ? (kz2.re / kz1) * abs2(t) : (kz2.re / eps / kz1) * abs2(t);
    }
    // Cas évanescent : |r| = 1, aucune puissance moyenne transmise (T = 0)
    return { r, t, R, T, kz1, kz2, propagative };
  }

  /** Angle de Brewster en TM (radians), ou null s'il n'existe pas. */
  function angleBrewster(eps) {
    return eps > 0 ? Math.atan(Math.sqrt(eps)) : null;
  }

  /** Angle au-delà duquel l'onde devient évanescente (radians), ou null s'il n'existe pas. */
  function angleLimite(eps) {
    if (eps <= 0) return 0;
    if (eps >= 1) return null;
    return Math.asin(Math.sqrt(eps));
  }

  /** Angle de réfraction dans le plasma (radians), si l'onde se propage. */
  function angleTransmis(eps, theta) {
    const s = Math.sin(theta);
    return eps - s * s > 0 ? Math.asin(s / Math.sqrt(eps)) : null;
  }

  /** Distance sur laquelle l'amplitude est divisée par e (en m), ou null si propagative. */
  function profondeur(kz2, lambda0) {
    return kz2.im > 0 ? lambda0 / (2 * Math.PI * kz2.im) : null;
  }

  return {
    E_CHARGE, M_E, EPS0, C0, T0,
    abs, abs2,
    densite, pulsationPlasma, permittivite, fresnel,
    angleBrewster, angleLimite, angleTransmis, profondeur,
  };
})();

if (typeof module !== "undefined") module.exports = Physique;
