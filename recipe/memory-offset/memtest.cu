// VRAM pattern test + bandwidth: memtest GPU MB SECONDS
// Fills a buffer with a hash of (index, pass), verifies it, and times a copy kernel. Prints errors and GB/s.
#include <cstdio>
#include <cstdlib>
#include <chrono>
#include <cuda_runtime.h>
__device__ __forceinline__ unsigned h(unsigned long long i, unsigned s) {
  unsigned long long x = i * 0x9E3779B97F4A7C15ull ^ ((unsigned long long)s << 32 | s);
  x ^= x >> 31; x *= 0xBF58476D1CE4E5B9ull; x ^= x >> 29; return (unsigned)x;
}
__global__ void fill(unsigned *p, size_t n, unsigned s) {
  for (size_t i = blockIdx.x * (size_t)blockDim.x + threadIdx.x; i < n; i += (size_t)gridDim.x * blockDim.x) p[i] = h(i, s);
}
__global__ void check(const unsigned *p, size_t n, unsigned s, unsigned long long *err) {
  unsigned long long e = 0;
  for (size_t i = blockIdx.x * (size_t)blockDim.x + threadIdx.x; i < n; i += (size_t)gridDim.x * blockDim.x) e += p[i] != h(i, s);
  if (e) atomicAdd(err, e);
}
__global__ void copy(const uint4 *a, uint4 *b, size_t n) {
  for (size_t i = blockIdx.x * (size_t)blockDim.x + threadIdx.x; i < n; i += (size_t)gridDim.x * blockDim.x) b[i] = a[i];
}
int main(int argc, char **argv) {
  int dev = argc > 1 ? atoi(argv[1]) : 0; size_t mb = argc > 2 ? atol(argv[2]) : 6000; double secs = argc > 3 ? atof(argv[3]) : 60;
  cudaSetDevice(dev);
  size_t n = mb * (1 << 20) / 4; unsigned *p; unsigned long long *err;
  if (cudaMalloc(&p, n * 4) != cudaSuccess) { printf("alloc failed\n"); return 2; }
  cudaMallocManaged(&err, 8); *err = 0;
  int G = 20 * 64, B = 256; unsigned pass = 0; double bw_best = 0, bw_sum = 0; int bw_n = 0;
  auto t0 = std::chrono::steady_clock::now();
  while (std::chrono::duration<double>(std::chrono::steady_clock::now() - t0).count() < secs) {
    ++pass; fill<<<G, B>>>(p, n, pass); check<<<G, B>>>(p, n, pass, err);
    // bandwidth: copy first half -> second half (reads + writes), then re-verify is skipped for that region next pass
    size_t m = n / 8;  // uint4 count of half buffer
    cudaEvent_t a, b; cudaEventCreate(&a); cudaEventCreate(&b);
    cudaEventRecord(a); for (int k = 0; k < 10; ++k) copy<<<G, B>>>((uint4 *)p, (uint4 *)p + m, m); cudaEventRecord(b);
    cudaEventSynchronize(b); float ms; cudaEventElapsedTime(&ms, a, b);
    double bw = 2.0 * m * 16 * 10 / (ms * 1e6); bw_sum += bw; ++bw_n; if (bw > bw_best) bw_best = bw;
    cudaEventDestroy(a); cudaEventDestroy(b);
  }
  cudaError_t e = cudaDeviceSynchronize();
  printf("gpu%d passes=%u mb=%zu errors=%llu copy_GBps_avg=%.1f best=%.1f cuda=%s\n", dev, pass, mb, *err, bw_sum / bw_n, bw_best, cudaGetErrorString(e));
  return *err ? 1 : 0;
}
