import"./style-CVgRVYuf.js";import{o as e}from"./math.vector.pure-D3Yk2YK3.js";import{n as t,t as n}from"./math.color.pure-_GxBM3om.js";import"./math.color-BSJGaPKM.js";import{S as r,c as i,f as a,m as o,t as s,x as c}from"./sponzaScene-bJ_EwyGQ.js";import"./constants-FfqMFcYa.js";import{t as l}from"./defaultBakeLights-DV5KA0qV.js";import{t as u}from"./pbrBaseMaterial.pure-DsUZKEaB.js";import{a as d,i as f,n as p,r as m,t as h}from"./irradianceVolumePbrPlugin-BCRgMpT3.js";import{t as g}from"./pbrMaterial-B_fqOoYK.js";var _=`assets/sponza-irradiance-volume-4.ivol`,v={speed:.62,distance:1,intensity:1.35};u.ForceGLSL=!0,c.ForceGLSL=!0,document.querySelector(`#app`).innerHTML=`
  <div class="app-shell">
    <header class="topbar">
      <a class="brand" href="./">
        <span class="brand-mark" aria-hidden="true">IV</span>
        <span>
          <strong>Sponza IVOL Direct Preview</strong>
          <small>direct baked asset / dynamic PBR material check</small>
        </span>
      </a>
      <nav class="nav-links" aria-label="Pages">
        <a href="./">Home</a>
        <a href="./bake.html">Bake</a>
        <a href="./direct-preview.html">Direct Preview</a>
        <a href="./validate-webgl.html">Validate WebGL</a>
      </nav>
    </header>

    <main class="workspace">
      <section class="viewport-panel" aria-label="Direct IVOL preview viewport">
        <canvas id="renderCanvas" aria-label="Sponza direct irradiance volume preview"></canvas>
        <div class="viewport-hud">
          <span id="volumeState">Loading .ivol</span>
          <span id="sampleReadout">samples: -</span>
        </div>
        <div id="status" class="status">Booting Babylon.js</div>
      </section>

      <aside class="research-panel" aria-label="Direct preview controls">
        <section>
          <p class="eyebrow">direct binary asset</p>
          <h1>Baked light centers.</h1>
          <p>
            This page fetches <code>${_}</code> directly. Four neutral
            PBR objects are created around the default bake light positions, then rotate
            while moving toward and away from each light center.
          </p>
        </section>

        <section class="control-grid" aria-label="Preview settings">
          <label>
            Motion speed
            <input id="speed" type="number" min="0" max="2" step="0.05" value="${v.speed}" />
          </label>
          <label>
            Travel scale
            <input id="distance" type="number" min="0" max="2" step="0.05" value="${v.distance}" />
          </label>
          <label>
            Volume intensity
            <input id="intensity" type="number" min="0" max="4" step="0.05" value="${v.intensity}" />
          </label>
        </section>

        <section class="note-list">
          <h2>Material audit</h2>
          <ol>
            <li id="summaryLine">Waiting for Sponza and .ivol.</li>
            <li id="materialLine">Dynamic materials are not initialized yet.</li>
            <li id="reasonLine">Distance color changes are diagnosed after samples are available.</li>
          </ol>
        </section>
      </aside>
    </main>
  </div>
`;var y=R(`#renderCanvas`),b=R(`#status`),x=R(`#volumeState`),S=R(`#sampleReadout`),C=R(`#summaryLine`),w=R(`#materialLine`),T=R(`#reasonLine`),E=(e,t=!1)=>{b.textContent=e,b.dataset.state=t?`error`:`ready`},D=null;try{let t=await s(y,E,!1);N(t);let n=await O();D=p(t.scene,n);let r=m(t.importedMeshes),a=k(t.scene,n),c=a.map(e=>e.plugin),l=[...r,...c];d(l,D,v.intensity),x.textContent=`Direct .ivol loaded`,C.textContent=`${_}: ${i(n)}.`,w.textContent=`${a.length} dynamic objects use neutral PBRMaterial, metallic 0, roughness 0.72, with one IVOL PBR plugin each.`,E(`Loaded direct binary volume: ${i(n)}.`),t.engine.runRenderLoop(()=>{P(),f(l,v.intensity);let r=performance.now()*.001*v.speed,i=[],s=0,c=1/0,u=0;for(let t=0;t<a.length;t+=1){let l=a[t];A(l,r,v.distance,n);let d=o(n,l.mesh.position).ambient.scale(v.intensity),f=d.r+d.g+d.b,p=Math.max(d.r,d.g,d.b)-Math.min(d.r,d.g,d.b),m=e.Distance(l.mesh.position,l.center);c=Math.min(c,f),u=Math.max(u,f),s=Math.max(s,p),i.push(`${l.name}:${d.r.toFixed(2)},${d.g.toFixed(2)},${d.b.toFixed(2)} d=${m.toFixed(1)}`)}let d=u/Math.max(1e-4,c);T.textContent=M(s,d),S.textContent=`samples: ${i.join(` | `)}`,t.scene.render()}),window.addEventListener(`beforeunload`,()=>{for(let e of a)e.material.dispose(),e.mesh.dispose();D?.ambientTexture.dispose(),D?.directionTexture.dispose(),t.dispose()})}catch(e){E(`Failed to start direct preview: ${e.message}`,!0)}async function O(){let e=await fetch(I(_));if(!e.ok)throw Error(`Could not fetch ${_}: HTTP ${e.status}.`);return a(await e.arrayBuffer())}function k(t,i){let a=new e(i.bounds.max[0]-i.bounds.min[0],i.bounds.max[1]-i.bounds.min[1],i.bounds.max[2]-i.bounds.min[2]),o=Math.max(.22,Math.min(a.x,a.z)*.018);return l.map((i,a)=>{let s=new e(i.x,i.y,i.z),c=a%2==0?r.CreateSphere(`direct-preview-pbr-object-${i.id}`,{diameter:o*2.2,segments:32},t):r.CreateBox(`direct-preview-pbr-object-${i.id}`,{size:o*2},t),l=new g(`direct-preview-pbr-material-${i.id}`,t);return l.albedoColor=new n(.86,.86,.82),l.metallic=0,l.roughness=.72,l.directIntensity=1,l.environmentIntensity=0,c.material=l,{mesh:c,material:l,plugin:new h(l),center:s,name:i.name,phase:a*Math.PI*.5,axisDistance:Math.max(1.4,i.range*.36)}})}function A(t,n,r,i){let a=t.axisDistance*(.18+.82*(.5+.5*Math.sin(n*1.25+t.phase)))*r,o=n*.62+t.phase,s=Math.sin(n*1.8+t.phase)*.28,c=new e(Math.cos(o)*a,s,Math.sin(o)*a);t.mesh.position.copyFrom(j(t.center.add(c),i)),t.mesh.rotation.x=n*.75+t.phase,t.mesh.rotation.y=n*1.25,t.mesh.rotation.z=n*.35}function j(t,n){return new e(L(t.x,n.bounds.min[0],n.bounds.max[0]),L(t.y,n.bounds.min[1],n.bounds.max[1]),L(t.z,n.bounds.min[2],n.bounds.max[2]))}function M(e,t){return e<.08&&t<1.35?`Weak visible change: the .ivol stores smoothed irradiance probes, samples are clamped inside the volume, and the bake includes indirect/bounced energy instead of raw point-light falloff.`:`Sample variation is present: max channel spread ${e.toFixed(2)}, brightness ratio ${t.toFixed(2)}. Trilinear probe interpolation still smooths local point-light color changes.`}function N(e){e.scene.clearColor=new t(0,0,0,1),e.scene.ambientColor=n.Black(),e.scene.environmentIntensity=0,e.scene.environmentTexture=null;for(let t of e.scene.lights)t.intensity=0,t.setEnabled(!1);e.bakeLight.intensity=0,e.bakeLight.setEnabled(!1)}function P(){v.speed=F(`#speed`,v.speed),v.distance=F(`#distance`,v.distance),v.intensity=F(`#intensity`,v.intensity)}function F(e,t){let n=Number(R(e).value);return Number.isFinite(n)?n:t}function I(e){return`/Babylon-LPV-Research/${e}`.replace(/\/{2,}/g,`/`)}function L(e,t,n){return Math.min(n,Math.max(t,e))}function R(e){let t=document.querySelector(e);if(!t)throw Error(`Missing element: ${e}`);return t}