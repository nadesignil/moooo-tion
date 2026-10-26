// Background shaders for the «Оживление скриншота» template.
// Our own GLSL, minimal and modern, after the effect families of github.com/shader-effects-inc/shaders
// (MIT, WebGPU) — written for WebGL2 so they render in the studio Player and in headless Remotion alike.
// Time comes from the frame (frame / fps · speed), never from a clock: every frame is reproducible.

export type ShaderPreset = {
  title: string;
  /** default palette: c1 — base, c2 — main, c3 — accent, c4 — halo (only the shaders that use it) */
  colors: string[];
  /** what the colors do, for the picker */
  hint: string;
  body: string;
  /** the picture has a pattern size the user can change (u_zoom) */
  zoom?: boolean;
};

const HEADER = `#version 300 es
precision highp float;
uniform vec2 u_res;
uniform float u_time;
uniform float u_seed;
uniform vec3 u_c1;
uniform vec3 u_c2;
uniform vec3 u_c3;
uniform vec3 u_c4;
/** pattern size: 1 = default, 2 = twice as large */
uniform float u_zoom;
out vec4 outColor;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3. - 2. * f);
  return mix(mix(hash(i), hash(i + vec2(1., 0.)), u.x), mix(hash(i + vec2(0., 1.)), hash(i + vec2(1., 1.)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0., a = .5;
  mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
  for (int i = 0; i < 5; i++) {
    v += a * noise(p);
    p = m * p;
    a *= .5;
  }
  return v;
}
vec3 ramp(float t) {
  t = clamp(t, 0., 1.);
  return t < .5 ? mix(u_c1, u_c2, t * 2.) : mix(u_c2, u_c3, t * 2. - 1.);
}
float band(float x, float w) {
  return 1. - smoothstep(0., w, abs(x));
}
`;

const FOOTER = `
void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  vec2 p = (gl_FragCoord.xy - .5 * u_res) / u_res.y;
  vec3 col = shade(uv, p, u_time + u_seed * 17.31);
  // a whisper of noise against banding in 8-bit video
  col += (hash(gl_FragCoord.xy + fract(u_time) * 91.7) - .5) / 255.;
  outColor = vec4(clamp(col, 0., 1.), 1.);
}
`;

export const SHADERS: Record<string, ShaderPreset> = {
  mesh: {
    title: 'Меш-градиент',
    colors: ['#f6d5c1', '#8b7cff', '#ff7a59'],
    hint: 'четыре пятна цвета гуляют по кадру и перетекают',
    body: `
vec3 shade(vec2 uv, vec2 p, float t) {
  t *= .45;
  // the field itself swirls, and the four spots travel wide orbits across the frame
  vec2 q = p + .16 * vec2(noise(p * 1.6 + vec2(t, -t * .7)) - .5, noise(p * 1.6 - vec2(t * .8, -t) + 4.) - .5) * 2.;
  vec2 a = vec2(-.35 + .32 * sin(t * 1.1), .15 + .22 * cos(t * 1.4));
  vec2 b = vec2(.4 + .3 * cos(t * .9 + 1.), .1 + .25 * sin(t * 1.2));
  vec2 c = vec2(-.1 + .4 * cos(t * .7 + 2.), -.25 + .2 * sin(t * 1.3));
  vec2 d = vec2(.3 + .3 * sin(t * .8 + 3.), -.2 + .25 * cos(t * 1.1));
  float wa = 1. / (dot(q - a, q - a) + .04), wb = 1. / (dot(q - b, q - b) + .04);
  float wc = 1. / (dot(q - c, q - c) + .04), wd = 1. / (dot(q - d, q - d) + .04);
  wa *= wa; wb *= wb; wc *= wc; wd *= wd;
  return (u_c1 * wa + u_c2 * wb + u_c3 * wc + mix(u_c1, u_c3, .5) * wd) / (wa + wb + wc + wd);
}`,
  },
  flow: {
    title: 'Течение',
    colors: ['#0e0f1a', '#3a4bff', '#ff9a6b'],
    hint: 'градиент, закрученный медленным потоком',
    body: `
vec3 shade(vec2 uv, vec2 p, float t) {
  t *= .12;
  vec2 q = vec2(fbm(p * 1.4 + t), fbm(p * 1.4 - t + 5.2));
  float f = fbm(p * 1.2 + 1.2 * q + vec2(t * .7, -t * .4));
  return ramp(smoothstep(.18, .68, f));
}`,
  },
  aurora: {
    title: 'Сияние',
    colors: ['#05070d', '#3ef0b5', '#7c5cff'],
    hint: 'мягкое свечение двух цветов на тёмном фоне',
    body: `
vec3 shade(vec2 uv, vec2 p, float t) {
  t *= .25;
  vec3 col = mix(u_c1 * .7, u_c1, uv.y);
  vec2 a = vec2(.32 * sin(t * .7), -.08 + .14 * cos(t * .9));
  vec2 b = vec2(-.3 * cos(t * .6 + 1.), .06 + .12 * sin(t * 1.1));
  float ga = exp(-dot(p - a, p - a) * 3.2) * (.85 + .15 * sin(t * 1.3));
  float gb = exp(-dot(p - b, p - b) * 4.2) * (.85 + .15 * cos(t * 1.1));
  return col + u_c2 * ga * .75 + u_c3 * gb * .55;
}`,
  },
  grain: {
    title: 'Зерно',
    colors: ['#ffb38a', '#ff6f91', '#6a5cff'],
    hint: 'линейный градиент с плёночным зерном',
    body: `
vec3 shade(vec2 uv, vec2 p, float t) {
  float a = .8 + .15 * sin(t * .2);
  float g = dot(p, vec2(cos(a), sin(a))) * .9 + .5 + .08 * sin(t * .3 + p.y * 2.);
  vec3 col = ramp(smoothstep(0., 1., g));
  return col + (hash(gl_FragCoord.xy + floor(t * 24.) * 13.1) - .5) * .09;
}`,
  },
  conic: {
    title: 'Конус',
    colors: ['#ffd6a5', '#bdb2ff', '#9bf6ff'],
    hint: 'три цвета медленно обходят центр',
    body: `
vec3 shade(vec2 uv, vec2 p, float t) {
  float k = atan(p.y, p.x) / 6.2831853 + .5 + t * .03;
  vec3 w = pow(.5 + .5 * cos(6.2831853 * (k - vec3(0., 1., 2.) / 3.)), vec3(2.));
  vec3 col = (u_c1 * w.x + u_c2 * w.y + u_c3 * w.z) / (w.x + w.y + w.z);
  vec3 mid = (u_c1 + u_c2 + u_c3) / 3.;
  return mix(mid, col, smoothstep(0., .45, length(p)));
}`,
  },
  satin: {
    title: 'Сатин',
    colors: ['#2b1830', '#c06c84', '#ffd1dc'],
    hint: 'складки ткани с мягким бликом',
    body: `
vec3 shade(vec2 uv, vec2 p, float t) {
  t *= .3;
  float v = sin(p.x * 7. + p.y * 3. + sin(p.y * 4. + t) * 1.4 + t * .5) * .6;
  v += sin(p.y * 9. - p.x * 2. + t * .7 + sin(p.x * 3. - t * .4) * 1.2) * .4;
  float s = .5 + .5 * v;
  return mix(u_c1, u_c2, smoothstep(0., 1., s)) + u_c3 * pow(s, 8.) * .45;
}`,
  },
  fluted: {
    title: 'Рифлёное стекло',
    colors: ['#ff7a59', '#ffd166', '#7b61ff'],
    hint: 'цветные пятна сквозь вертикальные линзы',
    body: `
vec3 behind(vec2 q, float t) {
  float f = fbm(q * 1.1 + vec2(t * .1, -t * .07));
  return ramp(smoothstep(.25, .75, f + .25 * q.y));
}
vec3 shade(vec2 uv, vec2 p, float t) {
  float x = p.x * 16.;
  float l = fract(x) - .5;
  vec3 col = behind(vec2(p.x - l * .09, p.y), t);
  col *= .88 + .14 * cos(l * 3.1416);
  return col + .06 * band(l + .3, .08);
}`,
  },
  'dot-grid': {
    title: 'Сетка точек',
    colors: ['#0c0c0f', '#3a3a46', '#b4db47'],
    hint: 'точки дышат волной',
    zoom: true,
    body: `
vec3 shade(vec2 uv, vec2 p, float t) {
  float cell = u_res.y / 36. * u_zoom;
  vec2 g = gl_FragCoord.xy / cell;
  vec2 id = floor(g), f = fract(g) - .5;
  float wave = fbm(id * .08 + vec2(t * .15, t * .1));
  float r = mix(.09, .2, smoothstep(.35, .7, wave));
  float aa = 1.5 / cell;
  float dotm = 1. - smoothstep(r - aa, r + aa, length(f));
  return mix(u_c1, mix(u_c2, u_c3, smoothstep(.45, .8, wave)), dotm);
}`,
  },
  dither: {
    title: 'Дизеринг',
    colors: ['#111216', '#3d5afe', '#e8e6ff'],
    hint: 'пиксельный градиент в три цвета',
    zoom: true,
    body: `
float bayer2(vec2 a) { a = floor(a); return fract(a.x / 2. + a.y * a.y * .75); }
float bayer8(vec2 a) { return bayer2(.25 * a) * .0625 + bayer2(.5 * a) * .25 + bayer2(a); }
vec3 shade(vec2 uv, vec2 p, float t) {
  float px = max(1., floor(u_res.y / 270. * u_zoom + .5));
  vec2 cell = floor(gl_FragCoord.xy / px);
  vec2 q = (cell * px - .5 * u_res) / u_res.y;
  float f = fbm(q * 1.6 + vec2(t * .08, -t * .05)) + .35 * q.y;
  float i = floor(smoothstep(.15, .85, f) * 2. + bayer8(cell) * .98);
  return i < .5 ? u_c1 : i < 1.5 ? u_c2 : u_c3;
}`,
  },
  smoke: {
    title: 'Дым',
    colors: ['#0d0d10', '#5a6078', '#e6e9f2'],
    hint: 'медленные клубы',
    body: `
vec3 shade(vec2 uv, vec2 p, float t) {
  t *= .08;
  vec2 q = p * 1.2;
  vec2 w = vec2(fbm(q + vec2(0., t)), fbm(q + vec2(5.2, -t)));
  float f = fbm(q + 2.2 * w + vec2(t * 2., 0.));
  vec3 col = mix(u_c1, u_c2, smoothstep(.2, .42, f));
  return mix(col, u_c3, smoothstep(.36, .55, f) * .6);
}`,
  },
  blobs: {
    title: 'Капли',
    colors: ['#f4f1ea', '#ff6b4a', '#4a6bff', '#ffb59e'],
    hint: 'пять капель сливаются и расходятся, вокруг — размытый ореол',
    body: `
vec3 shade(vec2 uv, vec2 p, float t) {
  t *= .3;
  float field = 0.;
  vec3 tint = vec3(0.);
  for (int i = 0; i < 5; i++) {
    float fi = float(i);
    vec2 c = vec2(.55 * sin(t * (.5 + fi * .13) + fi * 1.7), .32 * cos(t * (.4 + fi * .11) + fi * 2.3));
    float r = .16 + .04 * sin(t + fi);
    float v = r * r / max(dot(p - c, p - c), 1e-4);
    field += v;
    tint += mix(u_c2, u_c3, fi / 4.) * v;
  }
  vec3 blob = tint / field;
  // a wide soft edge, and the halo color in the blur around the drops
  float m = smoothstep(.6, 1.45, field);
  float halo = smoothstep(.1, .9, field) * (1. - m);
  return mix(mix(u_c1, u_c4, halo * .9), blob, m);
}`,
  },
  studio: {
    title: 'Студия',
    colors: ['#1b1b1f', '#2c2c33', '#6f6f7c'],
    hint: 'пол, стена и софтбокс сверху — для мокапа',
    body: `
vec3 shade(vec2 uv, vec2 p, float t) {
  vec3 col = mix(u_c1, u_c2, smoothstep(-.43, .17, p.y));
  vec2 l = (p - vec2(.05 * sin(t * .2), .55)) * vec2(.8, 1.1);
  col = mix(col, u_c3, exp(-dot(l, l) * 2.2) * (.55 + .05 * sin(t * .5)));
  col *= 1. - .35 * dot(p * vec2(.6, .9), p * vec2(.6, .9));
  return col + (hash(gl_FragCoord.xy + floor(t * 24.)) - .5) * .02;
}`,
  },
  halftone: {
    title: 'Растр',
    colors: ['#f2efe8', '#1d1d1f', '#ff5a36'],
    hint: 'типографский растр по плавающему пятну',
    body: `
vec3 shade(vec2 uv, vec2 p, float t) {
  float cell = u_res.y / 60.;
  mat2 R = mat2(.866, .5, -.5, .866);
  vec2 g = R * gl_FragCoord.xy / cell;
  vec2 id = floor(g) + .5, f = fract(g) - .5;
  vec2 c = (transpose(R) * (id * cell) - .5 * u_res) / u_res.y;
  float v = smoothstep(.3, .9, fbm(c * 1.4 + vec2(t * .06, -t * .04)) + .3 * c.y);
  float r = .55 * sqrt(v);
  float aa = 1.5 / cell;
  return mix(u_c1, mix(u_c2, u_c3, v), 1. - smoothstep(r - aa, r + aa, length(f)));
}`,
  },
};

export const SHADER_IDS = Object.keys(SHADERS);

export const shaderSource = (id: string) => HEADER + (SHADERS[id] ?? SHADERS.mesh).body + FOOTER;

const VERTEX = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2. - 1., 0., 1.);
}`;

export const hexToRgb = (hex: string): [number, number, number] => {
  const h = hex.replace('#', '');
  const full =
    h.length === 3
      ? h
          .split('')
          .map((c) => c + c)
          .join('')
      : h.padEnd(6, '0').slice(0, 6);
  const n = parseInt(full, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};

type Program = {
  prog: WebGLProgram;
  loc: Record<string, WebGLUniformLocation | null>;
};

/** One WebGL2 context, programs compiled once per shader id. */
export class ShaderRenderer {
  readonly gl: WebGL2RenderingContext;
  private programs = new Map<string, Program>();

  constructor(canvas: HTMLCanvasElement | OffscreenCanvas) {
    const gl = canvas.getContext('webgl2', {
      preserveDrawingBuffer: true,
      antialias: false,
      premultipliedAlpha: false,
    }) as WebGL2RenderingContext | null;
    if (!gl) throw new Error('WebGL2 недоступен');
    this.gl = gl;
  }

  private compile(type: number, src: string) {
    const gl = this.gl;
    const sh = gl.createShader(type)!;
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      throw new Error(gl.isContextLost() ? 'WebGL: контекст потерян' : gl.getShaderInfoLog(sh) || 'shader compile error');
    }
    return sh;
  }

  private program(id: string): Program {
    let p = this.programs.get(id);
    if (p) return p;
    const gl = this.gl;
    const prog = gl.createProgram()!;
    gl.attachShader(prog, this.compile(gl.VERTEX_SHADER, VERTEX));
    gl.attachShader(prog, this.compile(gl.FRAGMENT_SHADER, shaderSource(id)));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) ?? 'shader link error');
    const loc: Program['loc'] = {};
    for (const name of ['u_res', 'u_time', 'u_seed', 'u_zoom', 'u_c1', 'u_c2', 'u_c3', 'u_c4']) loc[name] = gl.getUniformLocation(prog, name);
    p = {prog, loc};
    this.programs.set(id, p);
    return p;
  }

  draw(
    id: string,
    o: {
      time: number;
      width: number;
      height: number;
      colors?: string[];
      seed?: number;
      /** pattern size of the shaders that have one */
      zoom?: number;
    },
  ) {
    const gl = this.gl;
    const {prog, loc} = this.program(SHADERS[id] ? id : 'mesh');
    const colors = (SHADERS[id] ?? SHADERS.mesh).colors.map((c, i) => o.colors?.[i] || c);
    gl.viewport(0, 0, o.width, o.height);
    gl.useProgram(prog);
    gl.uniform2f(loc.u_res, o.width, o.height);
    gl.uniform1f(loc.u_time, o.time);
    gl.uniform1f(loc.u_seed, o.seed ?? 0);
    gl.uniform1f(loc.u_zoom, o.zoom ?? 1);
    gl.uniform3fv(loc.u_c1, hexToRgb(colors[0]));
    gl.uniform3fv(loc.u_c2, hexToRgb(colors[1]));
    gl.uniform3fv(loc.u_c3, hexToRgb(colors[2]));
    gl.uniform3fv(loc.u_c4, hexToRgb(colors[3] ?? colors[2]));
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  dispose() {
    const gl = this.gl;
    for (const {prog} of this.programs.values()) gl.deleteProgram(prog);
    this.programs.clear();
    // no loseContext(): a canvas gives back the same context, and a remount on it must still draw
  }
}
