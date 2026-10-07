/* MIXMIND by Piradex — núcleos DSP em WebAssembly (sem libc).
 * Compilar: ./wasm/build.sh  (clang --target=wasm32 -O3 -msimd128) → js/core/wasm.js (base64 embutido).
 * A memória é gerida pelo JS (MM.wasm): os ponteiros são offsets em bytes na memória exportada. */
#define EXPORT(n) __attribute__((export_name(n)))

/* ---------- FFT real (n pontos) via FFT complexa de n/2 + pós-processamento ----------
 * tw: cos/sin(2πk/n) intercalados, k < n/2 · rev: inversão de bits para n/2 · work: 2·(n/2) doubles
 * out[k] = |X[k]|² · 4/n² (igual a D.powerSpectrum), k = 0..n/2 */
static void cfft(double *z, int m, const double *tw, int twStride, const int *rev) {
  for (int i = 0; i < m; i++) {
    int j = rev[i];
    if (j > i) { double a = z[2*i], b = z[2*i+1]; z[2*i] = z[2*j]; z[2*i+1] = z[2*j+1]; z[2*j] = a; z[2*j+1] = b; }
  }
  for (int size = 2; size <= m; size <<= 1) {
    int half = size >> 1, step = (m / size) * twStride;
    for (int i = 0; i < m; i += size) {
      for (int j = 0, k = 0; j < half; j++, k += step) {
        double c = tw[2*k], s = tw[2*k+1];
        double *pa = z + 2*(i+j), *pb = z + 2*(i+j+half);
        double br = pb[0], bi = pb[1];
        double tr = br*c + bi*s, ti = bi*c - br*s; /* W = e^{-iθ} */
        pb[0] = pa[0] - tr; pb[1] = pa[1] - ti;
        pa[0] += tr; pa[1] += ti;
      }
    }
  }
}

EXPORT("pspec")
void pspec(const float *x, int len, int start, int n, const double *win, const double *tw, const int *rev, double *work, double *out) {
  int m = n >> 1;
  for (int k = 0; k < m; k++) {
    int s0 = start + 2*k, s1 = s0 + 1;
    work[2*k]   = (s0 >= 0 && s0 < len ? (double)x[s0] : 0.0) * win[2*k];
    work[2*k+1] = (s1 >= 0 && s1 < len ? (double)x[s1] : 0.0) * win[2*k+1];
  }
  cfft(work, m, tw, 2, rev);
  double norm = 4.0 / ((double)n * (double)n);
  for (int k = 0; k <= m; k++) {
    int a = k % m, b = (m - k) % m;
    double zr = work[2*a], zi = work[2*a+1], cr = work[2*b], ci = -work[2*b+1];
    double er = 0.5*(zr + cr), ei = 0.5*(zi + ci);
    /* O = -i/2·(Z − conj) */
    double dr = zr - cr, di = zi - ci;
    double or_ = 0.5*di, oi = -0.5*dr;
    double c, s;
    if (k < m) { c = tw[2*k]; s = tw[2*k+1]; } else { c = -1.0; s = 0.0; }
    double xr = er + (or_*c + oi*s), xi = ei + (oi*c - or_*s);
    out[k] = (xr*xr + xi*xi) * norm;
  }
}

/* ---------- biquad (forma direta I, estado em double) ---------- */
EXPORT("biquad")
void biquad(const float *x, float *y, int n, double b0, double b1, double b2, double a1, double a2) {
  double x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (int i = 0; i < n; i++) {
    double xi = x[i];
    double yi = b0*xi + b1*x1 + b2*x2 - a1*y1 - a2*y2;
    x2 = x1; x1 = xi; y2 = y1; y1 = yi; y[i] = (float)yi;
  }
}

/* ---------- K-weighting (BS.1770) + energia por bloco de 100 ms ---------- */
EXPORT("kblocks")
void kblocks(const float *x, int blk, int nBlocks, double *ms, double b0, double b1, double b2, double a1, double a2, double c1, double c2) {
  double x1 = 0, x2 = 0, y1 = 0, y2 = 0, z1 = 0, z2 = 0;
  for (int b = 0; b < nBlocks; b++) {
    double acc = 0;
    const float *p = x + b * blk;
    for (int i = 0; i < blk; i++) {
      double xi = p[i];
      double y = b0*xi + b1*x1 + b2*x2 - a1*y1 - a2*y2;
      x2 = x1; x1 = xi;
      double z = y - 2*y1 + y2 - c1*z1 - c2*z2;
      y2 = y1; y1 = y; z2 = z1; z1 = z;
      acc += z*z;
    }
    ms[b] += acc / blk;
  }
}

/* ---------- true peak ---------- */
static inline double fabsd(double v) { return v < 0 ? -v : v; }
/* máximo |x(t)| em [base, base+1) com núcleo tab[NF][2H] (fase 0 ignorada) */
static double interp(const float *x, int len, int base, int H, int NF, const double *tab) {
  if (base - H + 1 < 0 || base + H >= len) return 0;
  double m = 0;
  const float *o = x + base - H + 1;
  for (int f = 1; f < NF; f++) {
    const double *w = tab + f * 2 * H;
    double s = 0;
    for (int k = 0; k < 2*H; k++) s += w[k] * o[k];
    double v = fabsd(s); if (v > m) m = v;
  }
  return m;
}
/* passo grosseiro: devolve o número de candidatos escritos em cand (pares [m, c]); coarse[0] é atualizado */
EXPORT("tpScan")
int tpScan(const float *x, int n, double thr, int H, int NF, const double *tab, double *cand, int cap, double *coarse) {
  int cnt = 0; double co = coarse[0];
  for (int c = 1; c < n - 1; c++) {
    double a = fabsd(x[c]);
    if (a < thr) continue;
    double l = fabsd(x[c-1]), r = fabsd(x[c+1]);
    if (a < l || a < r) continue;
    double m = a, v1 = interp(x, n, c - 1, H, NF, tab), v2 = interp(x, n, c, H, NF, tab);
    if (v1 > m) m = v1; if (v2 > m) m = v2;
    if (m > co) co = m;
    if (m >= co / 1.122 && cnt < cap) { cand[2*cnt] = m; cand[2*cnt+1] = c; cnt++; }
  }
  coarse[0] = co;
  return cnt;
}
EXPORT("tpRefine")
double tpRefine(const float *x, int n, int c, int H, int NF, const double *tab) {
  double v = interp(x, n, c - 1, H, NF, tab), w = interp(x, n, c, H, NF, tab), a = fabsd(x[c]);
  if (w > v) v = w; if (a > v) v = a;
  return v;
}

/* ---------- YIN (deteção de pitch) — função de diferença direta com SIMD ----------
 * x: sinal já decimado (~16 kHz) · por trama: per = período (amostras, 0 = sem pitch), conf = 1 − CMNDF mínimo, rms
 * d: rascunho com tmax+2 floats. W múltiplo de 4. */
#include <wasm_simd128.h>
static float sqrtf_(float v) { return __builtin_sqrtf(v); }
EXPORT("yin")
int yin(const float *x, int n, int hop, int W, int tmin, int tmax, float thr, float gate, float *per, float *conf, float *rms, float *d) {
  int frames = (n - W - tmax - 2) / hop + 1;
  if (frames < 0) frames = 0;
  for (int f = 0; f < frames; f++) {
    const float *a = x + f * hop;
    v128_t e4 = wasm_f32x4_splat(0);
    for (int i = 0; i < W; i += 4) { v128_t v = wasm_v128_load(a + i); e4 = wasm_f32x4_add(e4, wasm_f32x4_mul(v, v)); }
    float e = wasm_f32x4_extract_lane(e4, 0) + wasm_f32x4_extract_lane(e4, 1) + wasm_f32x4_extract_lane(e4, 2) + wasm_f32x4_extract_lane(e4, 3);
    float r = sqrtf_(e / W);
    rms[f] = r;
    if (r < gate) { per[f] = 0; conf[f] = 0; continue; }
    d[0] = 1;
    float run = 0;
    for (int t = 1; t <= tmax + 1; t++) {
      v128_t s4 = wasm_f32x4_splat(0);
      const float *b = a + t;
      for (int i = 0; i < W; i += 4) { v128_t df = wasm_f32x4_sub(wasm_v128_load(a + i), wasm_v128_load(b + i)); s4 = wasm_f32x4_add(s4, wasm_f32x4_mul(df, df)); }
      float s = wasm_f32x4_extract_lane(s4, 0) + wasm_f32x4_extract_lane(s4, 1) + wasm_f32x4_extract_lane(s4, 2) + wasm_f32x4_extract_lane(s4, 3);
      run += s;
      d[t] = run > 0 ? s * t / run : 1;
    }
    int best = -1;
    for (int t = tmin; t <= tmax; t++) { if (d[t] < thr) { while (t + 1 <= tmax && d[t + 1] < d[t]) t++; best = t; break; } }
    if (best < 0) { float m = 1e9f; for (int t = tmin; t <= tmax; t++) if (d[t] < m) { m = d[t]; best = t; } }
    float p = (float)best;
    if (best > 1 && best < tmax + 1) { float y0 = d[best - 1], y1 = d[best], y2 = d[best + 1], den = y0 - 2 * y1 + y2; if (den > 1e-9f || den < -1e-9f) { float o = 0.5f * (y0 - y2) / den; if (o > -1 && o < 1) p += o; } }
    per[f] = p; conf[f] = 1 - d[best];
  }
  return frames;
}
