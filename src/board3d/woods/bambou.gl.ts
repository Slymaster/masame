// Laminated bamboo: flat strips edge-glued along the fibres (z), a few crossed by a faint node; the sides show the stacked
// layers, the ends their cross-sections dotted with fibre bundles. The scan is ignored: `diffuse` (the material colour,
// the wood's tint, high contrast included) is the strips' mean colour.
export default { glsl: /* glsl */`
  #define BB_PITCH 17.5  // strip width (mm), each joint moved by up to a fifth of it: 14 to 21 mm
  #define BB_LAYER 5.6   // strip thickness (mm): the layers seen on the sides and ends
  float bbH(float n) { return fract(sin(n * 91.345 + 47.853) * 43758.5453); }
  float bbN(vec2 q) {
    vec2 i = floor(q), f = fract(q), u = f * f * (3.0 - 2.0 * f);
    float a = bbH(i.x + i.y * 57.0), b = bbH(i.x + 1.0 + i.y * 57.0), c = bbH(i.x + (i.y + 1.0) * 57.0), d = bbH(i.x + 1.0 + (i.y + 1.0) * 57.0);
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }
  float bbJ(float k, float l) { return (bbH(k * 1.37 + l * 11.1) - 0.5) * 0.4; }
  // the strip under s (across, mm) in layer l: its id, the position across it (0..1) and its width (mm)
  vec3 bbStrip(float s, float l) {
    float u = s / BB_PITCH + bbH(l + 0.5) * step(0.5, l), k = floor(u);
    if (u < k + bbJ(k, l)) k -= 1.0; else if (u >= k + 1.0 + bbJ(k + 1.0, l)) k += 1.0;
    float a = k + bbJ(k, l), b = k + 1.0 + bbJ(k + 1.0, l);
    return vec3(k + l * 131.0, (u - a) / (b - a), (b - a) * BB_PITCH);
  }
  // a strip's tone, fibres and node; m.x: the strip's own shade, m.y: a seam or node (for the roughness)
  vec2 bbM;
  vec3 bbFace(vec3 c0, float id, float t, float w, float along, float across, float aaS) {
    float h = bbH(id), tone = 0.91 + 0.17 * h;
    vec3 c = c0 * tone * mix(vec3(1.0), vec3(1.04, 0.98, 0.9), bbH(id + 3.1) * 0.7);
    float fib = bbN(vec2(across * 2.2, along * 0.035 + id * 7.0)) * 0.6 + bbN(vec2(across * 6.0, along * 0.11 + id)) * 0.4;
    c *= 0.92 + 0.14 * fib;
    float fleck = smoothstep(0.78, 0.9, bbN(vec2(across * 4.5, along * 0.4 + id * 3.0)));
    c *= 1.0 - 0.07 * fleck;
    // a node every 30 to 45 cm on some strips, bowed a little across the strip
    float node = 0.0;
    if (bbH(id + 5.7) < 0.45) {
      float L = 300.0 + 150.0 * bbH(id + 9.2), z = along + L * bbH(id + 2.4) + 1.6 * sin(t * 3.14159);
      float d = abs(z - L * floor(z / L + 0.5));
      node = exp(-d * d / 1.4) * 0.8 + exp(-d * d / 30.0) * 0.2;
      c *= 1.0 - 0.13 * node;
    }
    // glue line at each joint
    float dj = min(t, 1.0 - t) * w, seam = 1.0 - smoothstep(0.12, 0.12 + aaS, dj);
    c *= 1.0 - 0.16 * seam;
    bbM = vec2(seam, node);
    return c;
  }
  vec3 woodColor(vec3 c, vec3 p, vec3 n) {
    vec3 c0 = diffuse, an = abs(n);
    float aa = max(fwidth(p.x) + fwidth(p.z) + fwidth(p.y), 1e-3);
    if (an.y > 0.6) { vec3 s = bbStrip(p.x, 0.0); return bbFace(c0, s.x, s.y, s.z, p.z, p.x, aa); }
    float ly = (2000.0 - p.y) / BB_LAYER, l = floor(ly), ty = fract(ly); // layers counted down from the top
    float dl = min(ty, 1.0 - ty) * BB_LAYER, glue = 1.0 - smoothstep(0.1, 0.1 + aa, dl);
    if (an.z > 0.6) {
      // end grain: each strip's cross-section, fibre bundles crowded towards the strip's outer skin
      vec3 s = bbStrip(p.x, l);
      vec3 e = c0 * (0.88 + 0.1 * bbH(s.x)) * vec3(1.0, 0.97, 0.92);
      float dots = smoothstep(0.5, 0.8, bbN(p.xy * vec2(2.4, 3.0) + s.x * 5.0)) * mix(0.25, 0.8, ty);
      e *= (1.0 - 0.28 * dots) * (1.0 - 0.1 * smoothstep(0.7, 1.0, ty)); // the strip's outer skin, at the bottom of its layer
      float dj = min(s.y, 1.0 - s.y) * s.z, seam = 1.0 - smoothstep(0.1, 0.1 + aa, dj);
      bbM = vec2(max(seam, glue), 0.0);
      return e * (1.0 - 0.14 * max(seam, glue));
    }
    // long sides (and legs): the edge of each layer's outer strip, fibres along z
    float along = an.x > 0.6 ? p.z : p.x + p.z;
    vec3 f = bbFace(c0, l * 131.0 + sign(p.x) * 17.0, ty, BB_LAYER, along, p.y, aa);
    bbM.x = max(bbM.x, glue);
    return f * (1.0 - 0.14 * glue);
  }
  float woodRough(float r, vec3 p, vec3 n) { return mix(0.42 + 0.25 * r, 0.8, max(bbM.x, 0.5 * bbM.y)); }
` }
