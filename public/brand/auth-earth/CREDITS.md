# Earth textures

Solar System Scope / INOVE: https://ssi.solarsystemscope.com/textures/
Licence: Creative Commons Attribution 4.0 International
https://creativecommons.org/licenses/by/4.0/
Based on NASA imagery/elevation; authored colour adjustments by Solar System Scope.

- day.jpg: 8k_earth_daymap.jpg resized to 4096 x 2048, JPEG.
- clouds.jpg: 2k_earth_clouds.jpg, unchanged.
- oceans.jpg: 2k_earth_specular_map.tif converted to JPEG.

Textures are static imagery, not live cloud/weather data.
Renderer uses Three.js (MIT); geometry, lighting and interaction written locally.
Existing Global banner image serves as fallback and is not modified.

Credited on the site in the marketing footer (MarketingSite.jsx), linking the
source and the licence.

# Homepage globe (nterGlobe.js)

- fallback.jpg: NASA Earth Observatory / Robert Simmon, "Blue Marble — Eastern Hemisphere",
  using Suomi NPP VIIRS imagery from NOAA. Shown as the still Earth when WebGL is unavailable.
  Source: https://science.nasa.gov/resource/blue-marble-eastern-hemisphere/
- The day, clouds and oceans textures above are byte-identical to the ones embedded in the
  client-approved globe package, so the homepage globe uses these files directly.
- Orbital paths are decorative and their speeds are illustrative, not measured data or
  real-time planetary speeds.
