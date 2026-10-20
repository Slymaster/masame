// Katsura boards are mostly flat-sawn: the growth rings of a log lying a little under the top and slightly tilted along the
// fibres (z) cut the surface in nested arches. A solid pattern, so the sides and ends show the same rings, laid over the
// scan graded down to a quiet, even ground.
export default { glsl: /* glsl */`
  float ksH(vec2 q) { return fract(sin(dot(q, vec2(127.1, 311.7))) * 43758.5453); }
  float ksN(vec2 q) {
    vec2 i = floor(q), f = fract(q), u = f * f * (3.0 - 2.0 * f);
    return mix(mix(ksH(i), ksH(i + vec2(1, 0)), u.x), mix(ksH(i + vec2(0, 1)), ksH(i + vec2(1, 1)), u.x), u.y);
  }
  float ksR;
  vec3 woodColor(vec3 c, vec3 p, vec3 n) {
    // the log's axis: across at x = 40 mm, 150 mm under the top at z = 0, rising 0.06 mm per mm towards the far end
    float warp = 16.0 * (ksN(p.zx * vec2(0.005, 0.004)) - 0.5) + 2.0 * (ksN(p.zy * vec2(0.03, 0.05) + 7.0) - 0.5);
    float dx = p.x - 40.0 + warp, dy = p.y + 150.0 - 0.06 * p.z;
    float r = sqrt(dx * dx + dy * dy) / 3.4, f = fract(r);
    float aa = clamp(fwidth(r) * 1.5, 0.0, 1.0);
    // late wood: a thin darker band at the end of each ring, softened where the rings crowd beyond the pixel
    float late = smoothstep(0.62, 0.86, f) * (1.0 - smoothstep(0.9, 1.0, f));
    late = mix(late, 0.25, aa);
    ksR = late;
    return c * (1.0 - 0.2 * late) * mix(vec3(1.0), vec3(0.97, 0.95, 0.96), late);
  }
  float woodRough(float r, vec3 p, vec3 n) { return r * (1.0 + 0.08 * ksR); }
` }
