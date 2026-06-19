import"./style-CVgRVYuf.js";import{T as e,s as t}from"./irradianceBakeBundle-B4qs1gAW.js";import{i as n}from"./pbrMaterial-CfPkzdfn.js";import{a as r,i,n as a,o,r as s,s as c,t as l}from"./directPreviewRuntime-HMG_EfUF.js";var u=`assets/sponza-irradiance-bake.ivpack`,d={speed:.62,distance:1,intensity:1},f=location.pathname.toLowerCase().includes(`webgpu`)?`webgpu`:`webgl`,p=f===`webgpu`?`WebGPU`:`WebGL`;n.ForceGLSL=!0,e.ForceGLSL=!0,document.querySelector(`#app`).innerHTML=`
  <div class="app-shell">
    <header class="topbar">
      <a class="brand" href="./">
        <span class="brand-mark" aria-hidden="true">IV</span>
        <span>
          <strong>Sponza IVOL Direct Preview ${p}</strong>
          <small>${p} direct baked asset / shared material path</small>
        </span>
      </a>
      <nav class="nav-links" aria-label="Pages">
        <a href="./">Home</a>
        <a href="./bake.html">Bake</a>
        <a href="./direct-preview-webgl.html">Preview WebGL</a>
        <a href="./direct-preview-webgpu.html">Preview WebGPU</a>
        <a href="./validate-webgl.html">Validate WebGL</a>
        <a href="./validate-webgpu.html">Validate WebGPU</a>
      </nav>
    </header>

    <main class="workspace">
      <section class="viewport-panel" aria-label="Direct IVOL preview viewport">
        <canvas id="renderCanvas" aria-label="Sponza direct irradiance volume preview"></canvas>
        <div class="viewport-hud">
          <span id="volumeState">Loading .ivpack</span>
          <span id="sampleReadout">samples: -</span>
        </div>
        <div id="status" class="status">Booting Babylon.js</div>
      </section>

      <aside class="research-panel" aria-label="Direct preview controls">
        <section>
          <p class="eyebrow">direct binary asset</p>
          <h1>Baked light centers.</h1>
          <p>
            This page fetches <code>${u}</code> directly. Several
            PBR diagnostic receivers are created around the default bake light positions.
            Static Sponza uses baked surface lighting; moving receivers sample the volume.
          </p>
        </section>

        <section class="control-grid" aria-label="Preview settings">
          <label>
            Motion speed
            <input id="speed" type="number" min="0" max="2" step="0.05" value="${d.speed}" />
          </label>
          <label>
            Travel scale
            <input id="distance" type="number" min="0" max="2" step="0.05" value="${d.distance}" />
          </label>
          <label>
            Volume intensity
            <input id="intensity" type="number" min="0" max="4" step="0.05" value="${d.intensity}" />
          </label>
        </section>

        <section class="note-list">
          <h2>Material audit</h2>
          <ol>
            <li id="summaryLine">Waiting for Sponza and .ivpack.</li>
            <li id="materialLine">Dynamic materials are not initialized yet.</li>
            <li id="reasonLine">Distance color changes are diagnosed after samples are available.</li>
          </ol>
        </section>
      </aside>
    </main>
  </div>
`;var m=w(`#renderCanvas`),h=w(`#status`),g=w(`#volumeState`),_=w(`#sampleReadout`),v=w(`#summaryLine`),y=w(`#materialLine`),b=w(`#reasonLine`),x=(e,t=!1)=>{h.textContent=e,h.dataset.state=t?`error`:`ready`};try{let e=await t(m,x,f===`webgpu`),n=o(e),p=l(e,{namePrefix:`direct-preview`,shaderErrors:n,frameCameraOnLoad:!0}),h=await c(u),C=await p.loadBundle(h,u);g.textContent=`Direct .ivpack loaded`,v.textContent=r(C),y.textContent=s(C,n.length),C.compileAudit.errors.length>0||n.length>0?(b.textContent=a(C,n),x(`Static material audit found shader/material errors. ${C.compileAudit.errors[0]??n[0]}`,!0)):(b.textContent=`${C.dynamicObjects.length} dynamic PBR receiver(s): ${C.dynamicObjects.map(e=>e.materialLabel).join(`, `)}. Static Sponza uses the same baked material path as validation.`,x(i(C))),e.engine.runRenderLoop(()=>{S();let t=p.renderFrame(d);t&&(_.textContent=t.sampleReadout,C.compileAudit.errors.length===0&&n.length===0&&(b.textContent=t.reasonLine)),e.scene.render()}),window.addEventListener(`beforeunload`,()=>{p.disposeLoaded(),e.dispose()})}catch(e){x(`Failed to start direct preview: ${e.message}`,!0)}function S(){d.speed=C(`#speed`,d.speed),d.distance=C(`#distance`,d.distance),d.intensity=C(`#intensity`,d.intensity)}function C(e,t){let n=Number(w(e).value);return Number.isFinite(n)?n:t}function w(e){let t=document.querySelector(e);if(!t)throw Error(`Missing element: ${e}`);return t}