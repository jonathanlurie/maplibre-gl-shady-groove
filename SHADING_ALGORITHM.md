# How cavity, groove, and trench shading works

Shady Groove produces an **orientation-independent depression overlay** from a raster elevation tile. It does not simulate a directional light and it does not use slope or aspect. Instead, it asks the same question at several neighborhood sizes:

> How far below the locally smoothed terrain is this pixel?

Pixels that lie below their surroundings receive the chosen tint. Peaks and ridges do not. Repeating the measurement at five Gaussian scales makes both narrow grooves and broad valleys visible in the same image.

The implementation has two parallel high-level paths:

- `computeTileGl()` runs the Gaussian passes and final combination in WebGL and is the default.
- `computeTile()` sends the work to `tile-worker.ts`, where the same operations are performed on `Float32Array` elevation images on the CPU.

The important implementation files are:

- [`src/lib/ShadyGroove.ts`](src/lib/ShadyGroove.ts): WebGL shaders, tile orchestration, and final composition.
- [`src/lib/tools.ts`](src/lib/tools.ts): Gaussian-kernel construction, CPU convolution, elevation differences, weighting, and opacity transfer functions.
- [`src/lib/tile-worker.ts`](src/lib/tile-worker.ts): CPU version of the complete shading pipeline.
- [`src/lib/gaussianScaleSpaceWeights.ts`](src/lib/gaussianScaleSpaceWeights.ts): empirical weights for every zoom level and Gaussian scale.

## Pipeline at a glance

For an elevation image \(H\), the computation is:

```text
encoded terrain tile
        |
        v
elevation H in metres
        |
        +--> Gaussian blur r=3  --> max(blur - H, 0) -- weight w(z,3)  --+
        +--> Gaussian blur r=7  --> max(blur - H, 0) -- weight w(z,7)  --+
        +--> Gaussian blur r=15 --> max(blur - H, 0) -- weight w(z,15) --+--> sum
        +--> Gaussian blur r=30 --> max(blur - H, 0) -- weight w(z,30) --+
        +--> Gaussian blur r=60 --> max(blur - H, 0) -- weight w(z,60) --+
                                                                            |
                                                                            v
                                                              sine opacity mapping
                                                                            |
                                                                            v
                                                               tinted raster overlay
```

These scales are **combined**, but the Gaussian blurs are not applied successively to one another. Every scale is computed directly from the original elevation image \(H\). Likewise, this is not the usual Difference of Gaussians between adjacent blurred images. Each response is a rectified difference between one low-pass image and the original terrain.

## 1. Decode elevation

For Terrarium terrain, an RGB pixel is converted to an elevation in metres using

$$
H(x,y) = 256R(x,y) + G(x,y) + \frac{B(x,y)}{256} - 32768,
$$

where \(R\), \(G\), and \(B\) are byte values in \([0,255]\).

This is implemented in both `terrariumToElevation()` in the shaders and `getElevationData()` on the CPU.

## 2. Build the Gaussian scale space

The five kernel radii are

$$
\mathcal{R} = \{3, 7, 15, 30, 60\}\ \text{pixels}.
$$

For a radius \(r\), the one-dimensional kernel contains \(2r+1\) samples. Its standard deviation is selected so that 99% of a one-dimensional Gaussian's probability mass lies between \(-r\) and \(+r\):

$$
\sigma_r = \frac{r}{2.575829}.
$$

The unnormalized discrete kernel is

$$
\widetilde{k}_r(i) = \exp\!\left(-\frac{i^2}{2\sigma_r^2}\right),
\qquad i\in\{-r,\ldots,r\},
$$

and normalization makes its coefficients sum to one:

$$
k_r(i) =
\frac{\widetilde{k}_r(i)}{\displaystyle\sum_{j=-r}^{r}\widetilde{k}_r(j)}.
$$

The actual values used by the code are approximately:

| Radius \(r\) | Kernel size \(2r+1\) | \(\sigma_r\) |
| ---: | ---: | ---: |
| 3 | 7 | 1.165 |
| 7 | 15 | 2.718 |
| 15 | 31 | 5.823 |
| 30 | 61 | 11.647 |
| 60 | 121 | 23.294 |

A two-dimensional Gaussian is separable, so the implementation first convolves horizontally and then vertically. This reduces the work per scale from a square \((2r+1)^2\) kernel to two one-dimensional passes of length \(2r+1\).

Written as a single equation, the low-pass terrain at radius \(r\) is

$$
L_r(x,y)
= (G_r * H)(x,y)
= \sum_{i=-r}^{r}\sum_{j=-r}^{r}
   k_r(i)k_r(j)H(x-i,y-j).
$$

Because the kernel sums to one, flat terrain is unchanged. Away from boundaries, a planar ramp is unchanged too. The response therefore describes local shape rather than absolute elevation.

## 3. Keep only cavities

At each scale, the code subtracts the original elevation from the smoothed elevation and clips negative results:

$$
D_r(x,y) = \max\!\left(0,\ L_r(x,y)-H(x,y)\right).
$$

This sign is the essential cavity detector:

- At the bottom of a depression, nearby higher ground raises the Gaussian average, so \(L_r>H\) and \(D_r>0\).
- On a ridge or summit, nearby lower ground lowers the average, so \(L_r<H\); clipping makes \(D_r=0\).
- On locally flat or uniformly sloping terrain, \(L_r\approx H\), so the response is near zero.

Thus \(D_r\) is measured in metres and can be read as a scale-dependent **depth below the local Gaussian baseline**. It is similar to an inverted, positive-only unsharp-mask residual.

The scale determines which landforms respond most clearly. Small radii emphasize tight gullies and narrow channels; large radii establish a broader baseline and reveal wide trenches, valleys, and basins. A feature can respond at several scales at once.

## 4. Stack the scale responses

At map zoom \(z\), the five responses are added with zoom- and radius-dependent gains:

$$
S_z(x,y) = \sum_{r\in\mathcal{R}} w_{z,r}\,D_r(x,y).
$$

Expanded, this is

$$
\begin{aligned}
S_z ={}& w_{z,3}D_3 + w_{z,7}D_7 + w_{z,15}D_{15} \\
      &+ w_{z,30}D_{30} + w_{z,60}D_{60}.
\end{aligned}
$$

This addition is what gives the result its multi-resolution character. The responses are not mutually exclusive frequency bands, so a deep groove may contribute at every scale. The weights are gains, not percentages, and are not normalized to sum to one. Increasing all of them makes the opacity curve saturate sooner.

The defaults are hand-tuned per zoom in `defaultGaussianScaleSpaceWeights`. For example:

| Zoom | \(w_{z,3}\) | \(w_{z,7}\) | \(w_{z,15}\) | \(w_{z,30}\) | \(w_{z,60}\) |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 2 | 0.10 | 0.05 | 0.12 | 0.08 | 0.08 |
| 8 | 2 | 1 | 0.10 | 0.10 | 0.50 |
| 12 | 12 | 10 | 3 | 3 | 1.5 |
| 16–22 | 20 | 18 | 25 | 25 | 30 |

The radii are in source-tile pixels, not metres. For a Web Mercator tile of width \(N\) pixels, an approximate pixel size at latitude \(\varphi\) is

$$
p(z,\varphi) \approx
\frac{2\pi R_\mathrm{Earth}\cos\varphi}{N\,2^z}
\quad\text{metres per pixel}.
$$

Consequently, radius \(r\) examines a support extending approximately \(r\,p(z,\varphi)\) metres from a pixel. The same radius represents a smaller ground footprint as zoom increases and toward the poles. The changing per-zoom weights compensate perceptually for this change, but do not make the scales geographically invariant.

Custom weights replace the complete five-weight object at each supplied zoom. The constructor merges the outer zoom-level record only; it does not merge individual fields inside one zoom level.

## 5. Convert cavity strength to opacity

The weighted result is compressed into an opacity with a clamped ease-out sine curve. Let \(M=2000\) be the hard-coded saturation threshold in weighted elevation units. The normalized shading strength is

$$
q_z(x,y) =
\sin\!\left(
  \frac{\pi}{2}
  \frac{\min(S_z(x,y),M)}{M}
\right).
$$

The WebGL path then applies the configured global opacity \(\alpha_0\):

$$
\alpha_\text{out}(x,y) = \alpha_0\,q_z(x,y).
$$

The output pixel is the constant configured tint \((C_R,C_G,C_B)\) with this spatially varying alpha:

$$
\operatorname{RGBA}(x,y)
= \left(C_R,C_G,C_B,\alpha_\text{out}(x,y)\right).
$$

The sine curve rises quickly for weak and medium depressions, then gradually flattens. Values at or above \(S_z=2000\) receive the full configured opacity. MapLibre displays the generated image as a normal raster layer, so this tinted image is alpha-composited over the layers beneath it.

## Avoiding seams between tiles

The largest convolution radius is 60 pixels. Processing a tile in isolation would therefore invent an edge condition and produce a visible halo along every tile boundary.

To avoid that, Shady Groove fetches the center tile and all eight neighbors. It copies a 60-pixel strip or corner from each neighbor around the center tile, creating an image of size

$$
(N+120)\times(N+120).
$$

All Gaussian passes operate on this padded image. The code then crops away the padding and returns only the original \(N\times N\) center. Every returned pixel therefore has real neighboring samples available for even the radius-60 kernel, provided the corresponding neighbor tiles loaded successfully.

## Why the visual effect reads as a groove

Consider a narrow channel cut into otherwise level ground. At its center, the original elevation \(H\) is low. A small Gaussian includes the channel walls and produces a somewhat higher \(L_3\); wider Gaussians include still more surrounding terrain and can produce higher values at \(L_7,L_{15},\ldots\). Each positive difference is added, so the channel receives a strong, soft-edged tint.

Now consider a ridge with the same absolute height difference but the opposite shape. Its Gaussian averages are below its center elevation. Every difference is negative and discarded, so the ridge remains transparent. Because this test does not depend on a compass direction, a north–south trench and an east–west trench shade identically.

The result is best understood as **multi-scale cavity emphasis**, not physical ambient occlusion. It conveys concavity very effectively, but it does not model a horizon, visibility rays, material properties, cast shadows, or illumination direction.

## CPU and GPU implementation details

The two paths implement the same main equations but differ in storage and final composition:

- The CPU worker decodes the padded tile once to a floating-point elevation array, performs two 1D convolutions for each radius, sums the responses, maps the result to an alpha byte in \([0,255]\), and crops the center tile.
- The GPU path stores every low-pass elevation image in a Terrarium-encoded texture, then its combine shader decodes the original and five low-pass textures, evaluates all five differences and weights in one pass, and crops while reading the result back.

There are two current-code caveats worth knowing:

1. Although the public type accepts `terrainEncoding: "mapbox"`, elevation decoding is currently implemented only for Terrarium. The CPU decoder leaves Mapbox elevations at zero, and the GPU shaders always use Terrarium decoding.
2. The CPU worker does not receive or apply the `alpha` option. Its sine output can reach alpha 255 regardless of `alpha`; the default GPU path multiplies by the configured `alpha` as described above.

Also, the built-in weight table starts at zoom 2. Requests at zoom 0 or 1 need explicit five-scale weight objects, otherwise the current code has no weights for those zooms.

## Compact mathematical definition

Putting the default WebGL path into one expression, the final opacity is

$$
\boxed{
\alpha_\text{out}(x,y;z)
= \alpha_0
\sin\!\left[
\frac{\pi}{2}
\frac{
\min\!\left(
\displaystyle\sum_{r\in\{3,7,15,30,60\}}
w_{z,r}\max\!\left(0,(G_r*H)(x,y)-H(x,y)\right),
2000
\right)
}{2000}
\right]
}
$$

That expression captures the entire visual idea: construct several Gaussian notions of the surrounding terrain, measure only how far the original surface falls below each one, add those cavity depths with scale-dependent gains, and map the result smoothly to the opacity of a fixed tint.
