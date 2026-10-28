(() => {
  // Quitar el overlay de entrada siempre, aunque el modelo falle o el hilo esté ocupado.
  const intro = document.querySelector('.intro-mark');
  if (intro) {
    const removeIntro = () => intro.remove();
    intro.addEventListener('animationend', (e) => { if (e.target === intro) removeIntro(); });
    setTimeout(removeIntro, 1800);
  }

  const host = document.getElementById('inicio');
  if (!host || !window.THREE || !THREE.GLTFLoader || !THREE.OrbitControls || !THREE.DRACOLoader) return;

  const MODEL_URL = host.dataset.model || 'assets/Meshy_AI_Black_Belt_Resolve_1025162705_texture.fbx.glb';

  const mqCompact = window.matchMedia('(max-width:999px)');   // móvil + tablet
  const mqCoarse = window.matchMedia('(pointer:coarse)');
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const isCompact = () => mqCompact.matches;

  const fail = () => {
    host.dataset.modelState = 'error';
    host.removeAttribute('aria-busy');
    if (host.querySelector('.belt-error')) return;
    const note = document.createElement('p');
    note.className = 'belt-error';
    note.setAttribute('role', 'alert');
    note.textContent = 'No se pudo cargar el cinturón 3D.';
    host.appendChild(note);
  };

  // ---------- Renderer ----------
  // En pantallas pequeñas/táctiles: sin MSAA (el costo es alto y el DPR ya suaviza) y GPU por defecto (batería).
  const lowPower = mqCoarse.matches || isCompact();
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: !lowPower,
      powerPreference: lowPower ? 'default' : 'high-performance',
      stencil: false,
      depth: true,
    });
  } catch (error) {
    fail();
    return;
  }

  const maxDpr = lowPower ? 1.5 : 2;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, maxDpr));
  renderer.setClearColor(0x000000, 0);
  if ('outputColorSpace' in renderer && THREE.SRGBColorSpace) renderer.outputColorSpace = THREE.SRGBColorSpace;
  else renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = false;

  const canvas = renderer.domElement;
  canvas.className = 'hero-canvas';
  canvas.setAttribute('aria-label', 'Cinturón negro de jiu-jitsu en 3D. Arrastra para girar y usa la rueda para acercar.');
  canvas.setAttribute('role', 'img');
  canvas.tabIndex = 0;
  host.insertBefore(canvas, host.firstChild);
  host.dataset.modelState = 'loading';
  host.setAttribute('aria-busy', 'true');

  // ---------- Escena ----------
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 40);
  camera.position.set(0, 0, 5);

  // Tres luces bastan: un cinturón negro sobre fondo negro se lee gracias al rim light.
  scene.add(new THREE.HemisphereLight(0xffffff, 0x555555, 1.0));
  const key = new THREE.DirectionalLight(0xffffff, 1.3);
  key.position.set(2.6, 2.2, 5.5);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xffffff, 1.0);
  rim.position.set(-2, -3, -4);
  scene.add(rim);

  const controls = new THREE.OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.075;
  controls.enablePan = false;
  controls.rotateSpeed = 0.7;
  controls.zoomSpeed = 0.7;
  controls.target.set(0, 0, 0);

  // En móvil/tablet el scroll vertical de la página debe seguir funcionando (el zoom por gesto queda desactivado).
  let touchMode = false;
const applyInputMode = () => {
  touchMode = isCompact() || mqCoarse.matches;
  controls.enabled = !touchMode;        // en táctil, OrbitControls queda apagado
  controls.enableZoom = !touchMode;
  canvas.style.touchAction = touchMode ? 'pan-y' : 'none';
};
applyInputMode();
  // ---------- Encuadre responsivo ----------
  // El modelo se normaliza a una esfera de radio 1; la cámara se aleja lo justo según el aspecto del canvas.
  const SPHERE_MARGIN = 1.28;
  let fitDistance = 5;
  let userZoomed = false;
  canvas.addEventListener('wheel', () => { userZoomed = true; }, { passive: true });

  const updateFit = () => {
    const vHalf = THREE.MathUtils.degToRad(camera.fov / 2);
    const hHalf = Math.atan(Math.tan(vHalf) * camera.aspect);
    fitDistance = (1 / Math.sin(Math.min(vHalf, hHalf))) * SPHERE_MARGIN * (isCompact() ? 0.92 : 0.9);
    controls.minDistance = fitDistance * 0.5;
    controls.maxDistance = fitDistance * 1.8;
    if (!userZoomed) {
      const dir = camera.position.clone().sub(controls.target);
      if (dir.lengthSq() === 0) dir.set(0, 0, 1);
      camera.position.copy(controls.target).add(dir.setLength(fitDistance));
    }
  };

  // ---------- Tamaño ----------
  let lastW = 0, lastH = 0, lastDpr = 0;
  const resize = () => {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, maxDpr);
    if (!width || !height || (width === lastW && height === lastH && dpr === lastDpr)) return;
    lastW = width; lastH = height; lastDpr = dpr;
    renderer.setPixelRatio(dpr);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    updateFit();
    requestRender();
  };

  // ---------- Bucle de render (se detiene cuando no se ve) ----------
  let modelPivot = null;
  let running = false;
  let rafId = 0;
  let inView = true;
  let dragging = false;
  let spin = 0;
  let readyAt = null;
  let lastFrame = 0;
  let renderQueued = false;
  const clock = new THREE.Clock(false);
  const MIN_FRAME_MS = lowPower ? 1000 / 45 : 0;   // tope de 45 fps en táctil

  const shouldAnimate = () => !!modelPivot && inView && !document.hidden;

  const tick = (now) => {
    rafId = 0;
    if (!running) return;
    rafId = requestAnimationFrame(tick);
    if (MIN_FRAME_MS && now - lastFrame < MIN_FRAME_MS) return;
    lastFrame = now;

    const delta = Math.min(clock.getDelta(), 0.05);
    const t = clock.elapsedTime;

    if (modelPivot) {
      const targetSpin = (reduceMotion.matches || dragging) ? 0 : 0.3;
      spin += (targetSpin - spin) * Math.min(delta * 3, 1);
      modelPivot.rotation.y += delta * spin;
      if (!reduceMotion.matches) modelPivot.position.y = Math.sin(t * 0.9) * 0.04;

      if (readyAt === null) readyAt = t;
      const p = Math.min((t - readyAt) / 1.2, 1);
      if (p < 1) modelPivot.scale.setScalar(0.85 + 0.15 * (1 - Math.pow(1 - p, 3)));
      else if (modelPivot.scale.x !== 1) modelPivot.scale.setScalar(1);
    }

    controls.update();
    renderer.render(scene, camera);

    // Con movimiento reducido y sin interacción pendiente no hace falta seguir dibujando.
    if (reduceMotion.matches && !dragging && readyAt !== null && (t - readyAt) > 1.3 && Math.abs(spin) < 1e-3) stop();
  };

  const start = () => {
    if (running || !shouldAnimate()) return;
    running = true;
    clock.start();
    lastFrame = 0;
    rafId = requestAnimationFrame(tick);
  };
  const stop = () => {
    running = false;
    if (clock.running) clock.stop();
    if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
  };
  const sync = () => { if (shouldAnimate()) start(); else stop(); };

  // Render puntual (resize, cambios de controles) cuando el bucle está detenido.
  function requestRender() {
    if (running || !modelPivot || renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(() => { renderQueued = false; controls.update(); renderer.render(scene, camera); });
  }

  controls.addEventListener('start', () => { dragging = true; start(); });
  controls.addEventListener('end', () => { dragging = false; });
  // Arrastre horizontal para pantallas táctiles (el scroll vertical queda libre)
let dragX = null;
canvas.addEventListener('pointerdown', (e) => {
  if (!touchMode || e.pointerType === 'mouse') return;
  dragX = e.clientX;
  dragging = true;
  start();
});
canvas.addEventListener('pointermove', (e) => {
  if (dragX === null || !modelPivot) return;
  modelPivot.rotation.y += (e.clientX - dragX) * 0.012;
  dragX = e.clientX;
  requestRender();
});
const endDrag = () => { dragX = null; dragging = false; };
['pointerup', 'pointercancel', 'pointerleave'].forEach((ev) => canvas.addEventListener(ev, endDrag));
  controls.addEventListener('change', requestRender);

  if ('ResizeObserver' in window) new ResizeObserver(resize).observe(canvas);
  else window.addEventListener('resize', resize, { passive: true });
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(([entry]) => { inView = entry.isIntersecting; sync(); }, { rootMargin: '80px' }).observe(host);
  }
  document.addEventListener('visibilitychange', sync);
  const onMq = () => { applyInputMode(); updateFit(); requestRender(); };
  (mqCompact.addEventListener ? mqCompact.addEventListener.bind(mqCompact, 'change') : mqCompact.addListener.bind(mqCompact))(onMq);
  (reduceMotion.addEventListener ? reduceMotion.addEventListener.bind(reduceMotion, 'change') : reduceMotion.addListener.bind(reduceMotion))(sync);
  resize();

  // Pérdida de contexto WebGL (común en móviles al cambiar de app).
  canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); stop(); }, false);
  canvas.addEventListener('webglcontextrestored', () => { sync(); requestRender(); }, false);

  // ---------- Carga del modelo GLB ----------
  const prepareMaterial = (mat, maxAniso) => {
    if (!mat) return;
    // GLTFLoader ya entrega MeshStandardMaterial: se ajusta en sitio, sin recrear materiales.
    mat.roughness = 1;
    mat.metalness = 0;
    if (mat.emissive) mat.emissive.setHex(0x000000);
    if (mat.normalMap && mat.normalScale) mat.normalScale.set(1.2, 1.2);   // realza la trama de la tela
    ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap'].forEach((k) => {
      const tex = mat[k];
      if (tex) tex.anisotropy = maxAniso;
    });
    mat.needsUpdate = true;
  };

  const onLoaded = (gltf) => {
    const model = gltf.scene;
    const bounds = new THREE.Box3().setFromObject(model);
    const sphere = bounds.getBoundingSphere(new THREE.Sphere());
    if (!Number.isFinite(sphere.radius) || sphere.radius === 0) throw new Error('El modelo no contiene geometría visible.');

    // Normaliza a radio 1 y centra en el origen.
    const s = 1 / sphere.radius;
    model.scale.setScalar(s);
    model.position.copy(sphere.center).multiplyScalar(-s);

    const maxAniso = Math.min(lowPower ? 4 : 8, renderer.capabilities.getMaxAnisotropy());
    model.traverse((node) => {
      if (!node.isMesh) return;
      node.castShadow = node.receiveShadow = false;
      node.matrixAutoUpdate = false;
      node.updateMatrix();
      if (node.geometry && !node.geometry.boundingSphere) node.geometry.computeBoundingSphere();
      (Array.isArray(node.material) ? node.material : [node.material]).forEach((m) => prepareMaterial(m, maxAniso));
    });

    modelPivot = new THREE.Group();
    // Ligera inclinación para que el cinturón plano muestre su forma y no un canto.
    modelPivot.rotation.set(-0.06, 0, -0.09);
    modelPivot.scale.setScalar(0.85);
    modelPivot.add(model);
    scene.add(modelPivot);

    resize();
    updateFit();
    controls.update();
    // Sube el modelo a la GPU una vez, antes del primer frame visible (evita tirón al animar).
    renderer.compile(scene, camera);
    renderer.render(scene, camera);

    host.dataset.modelState = 'ready';
    host.removeAttribute('aria-busy');
    window.RANDORI_BELT_VIEWER = { scene, camera, controls, model: modelPivot, renderer };
    sync();
  };

  const gltfLoader = new THREE.GLTFLoader();
  const dracoLoader = new THREE.DRACOLoader();
  dracoLoader.setDecoderPath('https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/libs/draco/');
  gltfLoader.setDRACOLoader(dracoLoader);
  gltfLoader.load(
    MODEL_URL,
    (gltf) => { try { onLoaded(gltf); } catch (error) { console.error('Randori 3D belt viewer:', error); fail(); } },
    undefined,
    (error) => { console.error('Randori 3D belt viewer:', error); fail(); }
  );
})();