import './style.css'

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
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
        <a href="./direct-preview.html">Direct Preview</a>
        <a href="./validate-webgl.html">Validate WebGL</a>
        <a href="./validate-webgpu.html">Validate WebGPU</a>
      </nav>
    </header>

    <main class="landing">
      <section class="landing-copy">
        <p class="eyebrow">MVP workflow</p>
        <h1>Sponza volume lighting pipeline.</h1>
        <p>
          Use the bake page to generate an IrradianceVolume JSON from the classic Sponza
          scene, then use the validation page to sample that volume on moving dynamic objects.
        </p>
        <div class="landing-actions">
          <a class="primary-link" href="./bake.html">Open bake page</a>
          <a class="secondary-link" href="./direct-preview.html">Open direct .ivol preview</a>
          <a class="secondary-link" href="./validate-webgl.html">Open WebGL validation</a>
          <a class="secondary-link" href="./validate-webgpu.html">Open WebGPU validation</a>
        </div>
      </section>

      <section class="workflow-grid" aria-label="Workflow">
        <article>
          <span>01</span>
          <h2>Generate</h2>
          <p>Load Sponza, choose a regular 3D grid, run CPU probe visibility sampling, and export JSON.</p>
        </article>
        <article>
          <span>02</span>
          <h2>Store</h2>
          <p>The latest volume is saved in localStorage so the validation page can pick it up immediately.</p>
        </article>
        <article>
          <span>03</span>
          <h2>Direct preview</h2>
          <p>Load the downloaded binary asset directly and animate PBR objects around the default bake lights.</p>
        </article>
        <article>
          <span>04</span>
          <h2>Validate</h2>
          <p>Move dynamic meshes through Sponza and verify trilinear volume sampling in world space.</p>
        </article>
      </section>
    </main>
  </div>
`
