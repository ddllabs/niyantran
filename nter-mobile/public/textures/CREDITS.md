# Earth textures

Solar System Scope / INOVE: https://ssi.solarsystemscope.com/textures/
Licence: Creative Commons Attribution 4.0 International
https://creativecommons.org/licenses/by/4.0/
Based on NASA imagery/elevation; authored colour adjustments by Solar System Scope.

- day.webp: 8k_earth_daymap.jpg resized to 2048 x 1024, WebP (quality 82).
- clouds.webp: 2k_earth_clouds.jpg at 2048 x 1024, WebP (quality 70).
- oceans.webp: 2k_earth_specular_map.tif resized to 1024 x 512, WebP (quality 80).

The three were 4096 x 2048 / 2048 x 1024 JPEGs (2.3 MB) until F145 (2026-10-14), which re-encoded
them at the sizes the globe is drawn (0.5 MB). Rendered at the largest globe (756 px, 2x), the
picture differs from the JPEG version by 2.5 of 255 per channel on average.

Textures are static imagery, not live cloud/weather data.
Rendered by src/marketing/nterGlobe.js (a WebGL shader ported from the client's globe package).

Credited on the site in the marketing footer (MarketingSite.jsx), linking the
source and the licence.

# Homepage globe (nterGlobe.js)

- globe-still.webp: a still of this globe at time 0, rendered from its own shader and the textures
  above on a transparent background (F145). It covers 16% to 84% of the globe's box and stands in
  until WebGL draws, or instead of it where WebGL is unavailable. It replaced fallback.jpg, a
  NASA "Blue Marble" photograph on black space, which showed as a black flash on every page change.
- The day, clouds and oceans textures above come from the same sources as the ones embedded in
  the client-approved globe package (which were byte-identical to our former JPEGs).
- Orbital paths are decorative and their speeds are illustrative, not measured data or
  real-time planetary speeds.
