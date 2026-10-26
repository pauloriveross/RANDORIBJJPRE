(() => {
  // Quitar el overlay de entrada siempre, aunque el modelo falle o el hilo esté ocupado.
  const intro = document.querySelector('.intro-mark');
  if (intro) {
    const removeIntro = () => intro.remove();
    intro.addEventListener('animationend', (e) => { if (e.target === intro) removeIntro(); });
    setTimeout(removeIntro, 1800);
  }

  const host = document.getElementById('inicio');
  if (!host || !window.THREE || !window.RANDORI_BELT_GZIP) return;

  const fail = () => {
    host.dataset.modelState = 'error';
    host.removeAttribute('aria-busy');
    const note = document.createElement('p');
    note.className = 'belt-error';
    note.setAttribute('role', 'alert');
    note.textContent = 'No se pudo cargar el cinturón 3D.';
    host.appendChild(note);
  };

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'high-performance' });
  } catch (error) {
    fail();
    return;
  }

  const canvas = renderer.domElement;
  canvas.className = 'hero-canvas';
  canvas.setAttribute('aria-label', 'Cinturón negro de jiu-jitsu en 3D. Arrastra para girar y usa la rueda para acercar.');
  canvas.setAttribute('role', 'img');
  canvas.tabIndex = 0;
  host.insertBefore(canvas, host.firstChild);
  host.dataset.modelState = 'loading';
  host.setAttribute('aria-busy', 'true');

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
  camera.position.set(0, 0, 5.2);

  // Even lighting tuned so a black cotton belt still reads against the black page.
  scene.add(new THREE.AmbientLight(0xffffff, 0.5));
  const hemi = new THREE.HemisphereLight(0xffffff, 0x555555, 0.55);
  scene.add(hemi);
  const key = new THREE.DirectionalLight(0xffffff, 1.2);
  key.position.set(2.6, 2.2, 5.5);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xffffff, 0.55);
  fill.position.set(-4, 0.6, 3);
  scene.add(fill);
  // A black belt on a black stage only reads through its rim light.
  const rim = new THREE.DirectionalLight(0xffffff, 0.9);
  rim.position.set(0, -3, -4);
  scene.add(rim);

  const controls = new THREE.OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.075;
  controls.enablePan = false;
  controls.rotateSpeed = 0.7;
  controls.zoomSpeed = 0.7;
  controls.minDistance = 2.4;
  controls.maxDistance = 9;
  controls.target.set(0, 0, 0);

  // En mobile/tablet el scroll vertical de la página debe seguir funcionando.
  if (window.matchMedia('(max-width:999px)').matches) {
    controls.enableZoom = false;
    canvas.style.touchAction = 'pan-y';
  }

  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.7));
  renderer.setClearColor(0x000000, 0);
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;

  let modelPivot = null;
  let visible = true;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const clock = new THREE.Clock();

  // El renderer se ajusta al tamaño del canvas (su propia columna/bloque), no al hero completo.
  const resize = () => {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (!width || !height) return;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  };

  if ('ResizeObserver' in window) new ResizeObserver(resize).observe(canvas);
  else window.addEventListener('resize', resize, { passive: true });
  resize();

  if ('IntersectionObserver' in window) {
    new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; }).observe(host);
  }

  let dragging = false;
let spin = 0;
let readyAt = null;
controls.addEventListener('start', () => { dragging = true; });
controls.addEventListener('end', () => { dragging = false; });

const animationFrame = () => {
  requestAnimationFrame(animationFrame);
  if (!visible || document.hidden) return;
  const delta = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;

  if (modelPivot) {
    const targetSpin = (reduceMotion.matches || dragging) ? 0 : 0.3;
    spin += (targetSpin - spin) * Math.min(delta * 3, 1);
    modelPivot.rotation.y += delta * spin;

    if (!reduceMotion.matches) modelPivot.position.y = Math.sin(t * 0.9) * 0.04;

    if (readyAt === null) readyAt = t;
    const p = Math.min((t - readyAt) / 1.2, 1);
    const ease = 1 - Math.pow(1 - p, 3);
    modelPivot.scale.setScalar(0.85 + 0.15 * ease);
  }

  controls.update();
  renderer.render(scene, camera);
};
animationFrame();

  const decodeFbx = async () => {
    if (!('DecompressionStream' in window)) throw new Error('Este navegador no admite la carga comprimida del modelo.');
    const binary = atob(window.RANDORI_BELT_GZIP);
    const compressed = Uint8Array.from(binary, character => character.charCodeAt(0));
    const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip'));
    return new Response(stream).arrayBuffer();
  };

  decodeFbx().then((fbxBytes) => {
    const modelPath = new URL('Meshy_AI_Black_Belt_Resolve_1025162705_texture_fbx/', document.baseURI).href;
    const model = new THREE.FBXLoader().parse(fbxBytes, modelPath);
    const bounds = new THREE.Box3().setFromObject(model);
    const size = bounds.getSize(new THREE.Vector3());
    const center = bounds.getCenter(new THREE.Vector3());
    const maxDimension = Math.max(size.x, size.y, size.z);
    if (!Number.isFinite(maxDimension) || maxDimension === 0) throw new Error('El modelo no contiene geometría visible.');

    // Escala según la proporción del canvas, no de la ventana.
    const aspect = canvas.clientWidth / Math.max(canvas.clientHeight, 1);
    const isMobile = window.matchMedia('(max-width:999px)').matches;
const fitScale = (2.4 * (isMobile ? 0.95 : (aspect > 1.05 ? 0.75 : 0.7))) / maxDimension;
    model.scale.setScalar(fitScale);
    model.position.set(-center.x * fitScale, -center.y * fitScale, -center.z * fitScale);
    modelPivot = new THREE.Group();
    // Slightly tilted so the flat belt shows its form instead of an edge-on sliver.
    modelPivot.rotation.set(-0.06, 0, -0.09);
    modelPivot.add(model);
    scene.add(modelPivot);

    // Matte fabric: keep the loader's material but kill the plastic specular highlight.
    model.traverse((node) => {
  if (!node.isMesh) return;
  const convert = (old) => {
    if (!old) return old;
    const mat = new THREE.MeshStandardMaterial({
      map: old.map || null,
      normalMap: old.normalMap || null,
      color: old.color ? old.color.clone() : new THREE.Color(0xffffff),
      roughness: 1,
      metalness: 0,
      side: old.side,
    });
    if (mat.normalMap) mat.normalScale.set(1.2, 1.2);   // realza la trama de la tela
    mat.emissive.setHex(0x000000);                        // evita que el negro quede "muerto"
    old.dispose();
    return mat;
  };
  node.material = Array.isArray(node.material) ? node.material.map(convert) : convert(node.material);
});

    controls.target.set(0, 0, 0);
    controls.update();
    resize();
    host.dataset.modelState = 'ready';
    host.removeAttribute('aria-busy');
    window.RANDORI_BELT_VIEWER = { scene, camera, controls, model: modelPivot, renderer };
  }).catch((error) => {
    console.error('Randori 3D belt viewer:', error);
    fail();
  });
})();