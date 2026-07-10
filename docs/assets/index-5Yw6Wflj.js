import"./style-CVgRVYuf.js";document.querySelector(`#app`).innerHTML=`
  <div class="app-shell">
    <header class="topbar">
      <a class="brand" href="./">
        <span class="brand-mark" aria-hidden="true">IV</span>
        <span>
          <strong>Babylon.js Irradiance Volume Research</strong>
          <small>Sponza bake and validation harness</small>
        </span>
      </a>
      <nav class="nav-links" aria-label="Pages">
        <a href="./bake.html">Bake</a>
        <a href="./direct-preview-webgl.html">Preview WebGL</a>
        <a href="./direct-preview-webgpu.html">Preview WebGPU</a>
        <a href="./validate-webgl.html">Validate WebGL</a>
        <a href="./validate-webgpu.html">Validate WebGPU</a>
      </nav>
    </header>

    <main class="landing">
      <section class="landing-copy">
        <p class="eyebrow">L1 SH volume lighting</p>
        <h1>WebGPU bake, WebGL2/WebGPU render.</h1>
        <p>
          Bake occluded multi-bounce irradiance into a compact VRCLightVolumes-style
          L1 SH atlas, then use the same Babylon PBR path on both rendering backends.
        </p>
        <div class="landing-actions">
          <a class="primary-link" href="./bake.html">Open bake page</a>
          <a class="secondary-link" href="./direct-preview-webgl.html">Open WebGL preview</a>
          <a class="secondary-link" href="./direct-preview-webgpu.html">Open WebGPU preview</a>
          <a class="secondary-link" href="./validate-webgl.html">Open WebGL validation</a>
          <a class="secondary-link" href="./validate-webgpu.html">Open WebGPU validation</a>
        </div>
      </section>

      <section class="workflow-grid" aria-label="Workflow">
        <article>
          <span>01</span>
          <h2>Bake</h2>
          <p>Trace Sponza geometry and configured area-like point lights with a WebGPU compute BVH.</p>
        </article>
        <article>
          <span>02</span>
          <h2>Pack</h2>
          <p>Store L0 RGB and L1 RGB vectors as three padded islands per volume in an .ivpack asset.</p>
        </article>
        <article>
          <span>03</span>
          <h2>Direct preview</h2>
          <p>Load the checked-in binary bundle and sample one shared 3D atlas from Babylon PBR materials.</p>
        </article>
        <article>
          <span>04</span>
          <h2>Validate</h2>
          <p>Upload a fresh bake and verify hardware trilinear interpolation on WebGL2 and WebGPU.</p>
        </article>
      </section>
    </main>
  </div>
`;