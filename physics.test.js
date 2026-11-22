// Vérifications du modèle physique. Lancer avec : node physics.test.js
const assert = require("assert");
const P = require("./physics.js");

const rad = (d) => (d * Math.PI) / 180;
function eps(T, fMHz, ne0 = 1e12) {
  const wp = P.pulsationPlasma(P.densite(T, ne0));
  return P.permittivite(wp, 2 * Math.PI * fMHz * 1e6);
}
const proche = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg} : ${a} au lieu de ${b}`);

let n = 0;
function test(nom, fn) {
  fn();
  n++;
  console.log("ok  " + nom);
}

test("densité après dilatation", () => {
  proche(P.densite(600, 1e12), 0.5e12, 1, "Ne(600 K)");
});

test("fréquence plasma ~ 8.98 MHz pour Ne = 1e12 m^-3", () => {
  proche(P.pulsationPlasma(1e12) / (2 * Math.PI), 8.98e6, 1e4, "fp");
});

test("R + T = 1 sur 240 réglages (TE et TM)", () => {
  for (const pol of ["TE", "TM"])
    for (const T of [150, 300, 800, 3000])
      for (const f of [1, 5, 9, 12, 30, 60])
        for (const th of [0, 20, 45, 70, 89]) {
          const r = P.fresnel(eps(T, f), rad(th), pol);
          proche(r.R + r.T, 1, 1e-9, `R + T (${pol}, ${T} K, ${f} MHz, ${th}°)`);
        }
});

test("évanescent : réflexion totale et champ décroissant", () => {
  for (const pol of ["TE", "TM"]) {
    const r = P.fresnel(eps(300, 5), rad(20), pol);
    assert.strictEqual(r.propagative, false);
    proche(r.R, 1, 1e-12, "R");
    assert.strictEqual(r.T, 0);
    assert.ok(r.kz2.im > 0);
  }
});

test("le seuil dépend de l'angle (f > fp mais évanescente à 50°)", () => {
  assert.strictEqual(P.fresnel(eps(300, 11), rad(0), "TE").propagative, true);
  assert.strictEqual(P.fresnel(eps(300, 11), rad(50), "TE").propagative, false);
});

test("angle de Brewster : R = 0 en TM, pas en TE", () => {
  const e = eps(300, 20);
  const tb = P.angleBrewster(e);
  proche(P.fresnel(e, tb, "TM").R, 0, 1e-12, "R_TM");
  assert.ok(P.fresnel(e, tb, "TE").R > 0.01);
});

test("le chauffage rend le plasma transparent", () => {
  assert.strictEqual(P.fresnel(eps(300, 6), rad(20), "TE").propagative, false);
  assert.strictEqual(P.fresnel(eps(1500, 6), rad(20), "TE").propagative, true);
});

console.log(`\n${n} tests réussis`);
