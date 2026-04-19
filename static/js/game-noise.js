'use strict';

// ═══════════════════════════════════════════════════════
//  BIOME NOISE HELPERS
//  Pure value noise — no external dependencies.
//  Used by buildVillageTiles() for organic biome shape
//  generation.  All functions are pure (no side effects).
// ═══════════════════════════════════════════════════════

// Integer hash → float in [0,1)
function _vhash(xi, yi, s) {
    let n = (xi * 374761393 ^ yi * 668265263 ^ s * 1013904223) | 0;
    n = Math.imul(n ^ (n >>> 13), 1664525);
    n = n ^ (n >>> 17);
    n = Math.imul(n, 1013904223);
    return (n >>> 0) / 4294967296;
}
// Bilinear value noise — single octave
function _vnoise(x, y, seed) {
    const ix = Math.floor(x), iy = Math.floor(y);
    const fx = x - ix, fy = y - iy;
    const ux = fx * fx * (3 - 2 * fx);   // smoothstep
    const uy = fy * fy * (3 - 2 * fy);
    return _vhash(ix,   iy,   seed) * (1-ux) * (1-uy)
         + _vhash(ix+1, iy,   seed) *    ux  * (1-uy)
         + _vhash(ix,   iy+1, seed) * (1-ux) *    uy
         + _vhash(ix+1, iy+1, seed) *    ux  *    uy;
}
// Fractional Brownian motion — multi-octave noise
function _vfbm(x, y, seed, oct) {
    let v = 0, a = 0.5, f = 1, m = 0;
    for (let i = 0; i < oct; i++) {
        v += _vnoise(x * f, y * f, seed + i * 97) * a;
        m += a;  a *= 0.5;  f *= 2.1;
    }
    return v / m;
}
