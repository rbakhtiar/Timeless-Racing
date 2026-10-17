
import * as THREE from "three";

const $ = (s) => document.querySelector(s);

const canvas = $("#world");
const loading = $("#loading");
const loadingBar = $("#loading-bar");
const loadingText = $("#loading-text");

const ui = {
  intro: $("#intro"),
  headline: $("#headline"),
  eyebrow: $("#eyebrow"),
  description: $("#description"),
  start: $("#start"),
  pause: $("#pause"),
  pausePanel: $("#pause-panel"),
  resume: $("#resume"),
  restart: $("#restart"),
  settings: $("#settings"),
  settingsOpen: $("#settings-open"),
  settingsClose: $("#settings-close"),
  settingsDone: $("#settings-done"),
  quality: $("#quality"),
  shake: $("#shake"),
  effects: $("#effects"),
  distance: $("#distance"),
  score: $("#score"),
  speed: $("#speed"),
  gear: $("#gear"),
  rpm: $("#rpm"),
  speedStatus: $("#speed-status"),
  status: $("#status"),
  speedLines: $("#speed-lines")
};

const QUALITY = {
  low:    { dpr: 0.8, fog: 0.011, scenery: 24, shadows: false },
  medium: { dpr: 1.2, fog: 0.008, scenery: 40, shadows: true },
  high:   { dpr: 1.5, fog: 0.006, scenery: 58, shadows: true },
  ultra:  { dpr: 2.0, fog: 0.0045, scenery: 72, shadows: true }
};

const ROAD = {
  width: 15.5,
  lanes: 4,
  segmentLength: 28,
  segmentCount: 24,
  playerZ: 2,
  spawnDistance: 280,
  maxTraffic: 14
};

const state = {
  mode: "menu",
  quality: "medium",
  speed: 0,
  maxSpeed: 245,
  acceleration: 65,
  braking: 150,
  drag: 17,
  x: 0,
  steer: 0,
  targetSteer: 0,
  distance: 0,
  score: 0,
  elapsed: 0,
  spawnTimer: 1,
  collisionCooldown: 0,
  nearMissCooldown: 0,
  gear: 1,
  cameraShake: true,
  effects: true
};

let scene;
let camera;
let renderer;
let clock;
let player;
let sky;
let roadSegments = [];
let traffic = [];
let scenery = [];
let particles = [];
let ground;
let sun;
let audioContext = null;
let engineOscillator = null;
let engineGain = null;
let engineFilter = null;
let resizeObserver = null;
let disposed = false;

const keys = new Set();
const touch = {
  left: false,
  right: false,
  brake: false,
  accelerate: false
};

const mats = {};

function progress(percent, message) {
  loadingBar.style.width = `${percent}%`;
  loadingText.textContent = message;
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function init() {
  try {
    progress(10, "INITIALIZING 3D ENGINE");
    createScene();

    progress(28, "BUILDING THE HIGHWAY");
    createMaterials();
    createRoad();

    progress(48, "ASSEMBLING YOUR CAR");
    player = createCar(0x139763, true);
    player.position.set(0, 0, ROAD.playerZ);
    scene.add(player);

    progress(65, "SCATTERING THE LANDSCAPE");
    createMountains();
    createScenery();

    progress(82, "CALIBRATING CAMERA");
    bindEvents();
    updateQuality(state.quality);

    progress(100, "READY TO DRIVE");
    await wait(250);
    loading.classList.add("done");

    clock = new THREE.Clock();
    renderer.setAnimationLoop(frame);
    ui.status.textContent = "SYSTEM READY";
  } catch (error) {
    console.error("TIMELESS initialization failed:", error);
    loadingText.textContent = "RENDERER INITIALIZATION FAILED";
    ui.description.textContent =
      "Your browser could not initialize the 3D renderer. Try a recent browser with WebGL enabled.";
  }
}

function createScene() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x9aafa5);
  scene.fog = new THREE.FogExp2(0x9aafa5, QUALITY.medium.fog);

  camera = new THREE.PerspectiveCamera(
    64,
    innerWidth / innerHeight,
    0.1,
    1400
  );
  camera.position.set(0, 5.2, 14);
  camera.lookAt(0, 1, -15);

  renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: false,
    powerPreference: "high-performance",
    stencil: false
  });

  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.2));
  renderer.setSize(innerWidth, innerHeight, false);

  const hemisphere = new THREE.HemisphereLight(
    0xd8eee4,
    0x293b30,
    2.0
  );
  scene.add(hemisphere);

  sun = new THREE.DirectionalLight(0xffedcf, 3.1);
  sun.position.set(-40, 75, 30);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = -30;
  sun.shadow.camera.right = 30;
  sun.shadow.camera.top = 55;
  sun.shadow.camera.bottom = -45;
  scene.add(sun);

  const fill = new THREE.DirectionalLight(0x9acac2, 0.75);
  fill.position.set(45, 20, -70);
  scene.add(fill);

  const skyGeometry = new THREE.SphereGeometry(800, 24, 16);
  const skyMaterial = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      top: { value: new THREE.Color(0x254946) },
      horizon: { value: new THREE.Color(0xc1d0bd) },
      bottom: { value: new THREE.Color(0x758b7f) }
    },
    vertexShader: `
      varying vec3 vWorld;
      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        vWorld = world.xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 top;
      uniform vec3 horizon;
      uniform vec3 bottom;
      varying vec3 vWorld;
      void main() {
        float h = normalize(vWorld).y;
        float upper = pow(max(h, 0.0), 0.58);
        float lower = pow(max(-h, 0.0), 0.6);
        vec3 color = mix(horizon, top, upper);
        color = mix(color, bottom, lower * 0.5);
        gl_FragColor = vec4(color, 1.0);
      }
    `
  });

  sky = new THREE.Mesh(skyGeometry, skyMaterial);
  scene.add(sky);

  ground = new THREE.Mesh(
    new THREE.PlaneGeometry(2000, 2000),
    new THREE.MeshStandardMaterial({
      color: 0x2b4434,
      roughness: 1
    })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(0, -0.24, -400);
  ground.receiveShadow = true;
  scene.add(ground);

  clock = new THREE.Clock();
}

function createMaterials() {
  mats.asphalt = new THREE.MeshStandardMaterial({
    color: 0x343b38,
    roughness: 0.96,
    metalness: 0.02
  });

  mats.line = new THREE.MeshStandardMaterial({
    color: 0xe5e8de,
    roughness: 0.8
  });

  mats.shoulder = new THREE.MeshStandardMaterial({
    color: 0x858e87,
    roughness: 0.92
  });

  mats.rail = new THREE.MeshStandardMaterial({
    color: 0x9ca69f,
    metalness: 0.72,
    roughness: 0.34
  });

  mats.post = new THREE.MeshStandardMaterial({
    color: 0x64716a,
    metalness: 0.45,
    roughness: 0.55
  });

  mats.trunk = new THREE.MeshStandardMaterial({
    color: 0x594637,
    roughness: 1
  });

  mats.leaves = [
    0x294b38, 0x315641, 0x3b6049, 0x244333
  ].map(color => new THREE.MeshStandardMaterial({
    color,
    roughness: 1,
    flatShading: true
  }));
}

function createRoad() {
  for (let i = 0; i < ROAD.segmentCount; i++) {
    const segment = createRoadSegment();
    segment.position.z = -i * ROAD.segmentLength;
    scene.add(segment);
    roadSegments.push(segment);
  }
}

function createRoadSegment() {
  const group = new THREE.Group();
  const road = new THREE.Mesh(
    new THREE.BoxGeometry(ROAD.width, 0.24, ROAD.segmentLength),
    mats.asphalt
  );
  road.position.y = -0.1;
  road.receiveShadow = true;
  group.add(road);

  for (const side of [-1, 1]) {
    const shoulder = new THREE.Mesh(
      new THREE.BoxGeometry(1.25, 0.2, ROAD.segmentLength),
      mats.shoulder
    );
    shoulder.position.set(
      side * (ROAD.width / 2 + 0.625),
      -0.1,
      0
    );
    group.add(shoulder);

    const edge = new THREE.Mesh(
      new THREE.BoxGeometry(0.11, 0.025, ROAD.segmentLength * 0.95),
      mats.line
    );
    edge.position.set(side * (ROAD.width / 2 - 0.2), 0.035, 0);
    group.add(edge);

    const rail = new THREE.Group();
    const beam = new THREE.Mesh(
      new THREE.BoxGeometry(0.12, 0.18, ROAD.segmentLength),
      mats.rail
    );
    beam.position.y = 0.58;
    rail.add(beam);

    for (let z = -12; z < 14; z += 4) {
      const post = new THREE.Mesh(
        new THREE.BoxGeometry(0.1, 0.72, 0.12),
        mats.post
      );
      post.position.set(0, 0.28, z);
      rail.add(post);
    }

    rail.position.x = side * (ROAD.width / 2 + 1.05);
    group.add(rail);
  }

  for (let lane = 1; lane < ROAD.lanes; lane++) {
    const x = -ROAD.width / 2 + ROAD.width * lane / ROAD.lanes;

    for (let i = 0; i < 4; i++) {
      const dash = new THREE.Mesh(
        new THREE.BoxGeometry(0.09, 0.025, 3.3),
        mats.line
      );
      dash.position.set(
        x,
        0.045,
        -ROAD.segmentLength / 2 + 3 + i * 6.7
      );
      group.add(dash);
    }
  }

  return group;
}

function createMountains() {
  const farMaterials = [
    new THREE.MeshStandardMaterial({ color: 0x71867b, flatShading: true }),
    new THREE.MeshStandardMaterial({ color: 0x5a7267, flatShading: true }),
    new THREE.MeshStandardMaterial({ color: 0x435d51, flatShading: true })
  ];

  for (let i = 0; i < 24; i++) {
    const radius = 25 + Math.random() * 48;
    const height = 35 + Math.random() * 70;
    const geometry = new THREE.ConeGeometry(
      radius,
      height,
      5 + Math.floor(Math.random() * 3),
      1
    );

    const mountain = new THREE.Mesh(
      geometry,
      farMaterials[i % farMaterials.length]
    );

    const side = i % 2 ? 1 : -1;
    mountain.position.set(
      side * (85 + Math.random() * 270),
      height * 0.42 - 6,
      -80 - Math.random() * 620
    );
    mountain.rotation.y = Math.random() * Math.PI;
    scene.add(mountain);
  }
}

function createScenery() {
  clearScenery();

  const count = QUALITY[state.quality].scenery;

  for (let i = 0; i < count; i++) {
    const side = Math.random() < 0.5 ? -1 : 1;
    const item = Math.random() < 0.78 ? createTree() : createSign();

    item.position.set(
      side * (ROAD.width / 2 + 5 + Math.random() * 45),
      0,
      -Math.random() * ROAD.segmentLength * ROAD.segmentCount
    );

    item.userData.side = side;
    scene.add(item);
    scenery.push(item);
  }
}

function clearScenery() {
  for (const item of scenery) scene.remove(item);
  scenery = [];
}

function createTree() {
  const group = new THREE.Group();
  const height = 4 + Math.random() * 6;

  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.12, 0.24, height * 0.4, 5),
    mats.trunk
  );
  trunk.position.y = height * 0.2;
  group.add(trunk);

  const leafMaterial = mats.leaves[
    Math.floor(Math.random() * mats.leaves.length)
  ];

  for (let layer = 0; layer < 3; layer++) {
    const cone = new THREE.Mesh(
      new THREE.ConeGeometry(
        height * (0.27 - layer * 0.045),
        height * 0.48,
        6
      ),
      leafMaterial
    );

    cone.position.y = height * (0.43 + layer * 0.18);
    cone.rotation.y = Math.random() * Math.PI;
    group.add(cone);
  }

  group.scale.setScalar(0.8 + Math.random() * 0.9);
  return group;
}

function createSign() {
  const group = new THREE.Group();

  const post = new THREE.Mesh(
    new THREE.BoxGeometry(0.12, 3.3, 0.12),
    mats.post
  );
  post.position.y = 1.65;
  group.add(post);

  const board = new THREE.Mesh(
    new THREE.BoxGeometry(2.2, 1, 0.12),
    new THREE.MeshStandardMaterial({
      color: 0x155d42,
      roughness: 0.55
    })
  );
  board.position.set(0.35, 3, 0);
  group.add(board);

  const stripe = new THREE.Mesh(
    new THREE.BoxGeometry(1.6, 0.05, 0.14),
    new THREE.MeshStandardMaterial({
      color: 0xc5f6d8,
      emissive: 0x125b3d,
      emissiveIntensity: 0.5
    })
  );
  stripe.position.set(0.35, 3, 0.08);
  group.add(stripe);

  return group;
}

function addBox(parent, size, material, position) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(size.x, size.y, size.z),
    material
  );

  mesh.position.copy(position);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function createCar(color, isPlayer = false) {
  const group = new THREE.Group();

  const bodyMaterial = new THREE.MeshStandardMaterial({
    color,
    metalness: 0.75,
    roughness: 0.25
  });

  const glassMaterial = new THREE.MeshPhysicalMaterial({
    color: 0x172a28,
    metalness: 0.3,
    roughness: 0.15,
    clearcoat: 1,
    clearcoatRoughness: 0.12
  });

  const darkMaterial = new THREE.MeshStandardMaterial({
    color: 0x101412,
    roughness: 0.65
  });

  const accentMaterial = new THREE.MeshStandardMaterial({
    color: isPlayer ? 0x42f0a3 : 0x8c9b92,
    metalness: 0.7,
    roughness: 0.28
  });

  addBox(group,
    new THREE.Vector3(1.9, 0.43, 4.15),
    bodyMaterial,
    new THREE.Vector3(0, 0.72, 0)
  );

  addBox(group,
    new THREE.Vector3(1.58, 0.14, 1.1),
    bodyMaterial,
    new THREE.Vector3(0, 0.98, -1.15)
  );

  addBox(group,
    new THREE.Vector3(1.42, 0.53, 1.75),
    glassMaterial,
    new THREE.Vector3(0, 1.18, -0.48)
  );

  addBox(group,
    new THREE.Vector3(1.52, 0.12, 0.9),
    bodyMaterial,
    new THREE.Vector3(0, 1.01, 0.98)
  );

  addBox(group,
    new THREE.Vector3(1.85, 0.13, 0.38),
    darkMaterial,
    new THREE.Vector3(0, 0.56, 1.94)
  );

  addBox(group,
    new THREE.Vector3(1.5, 0.045, 1.05),
    accentMaterial,
    new THREE.Vector3(0, 0.96, -1.2)
  );

  const wheels = [];
  const wheelGeometry = new THREE.CylinderGeometry(0.35, 0.35, 0.23, 12);
  const rimGeometry = new THREE.CylinderGeometry(0.18, 0.18, 0.24, 10);

  const rimMaterial = new THREE.MeshStandardMaterial({
    color: 0x9ba7a0,
    metalness: 0.9,
    roughness: 0.25
  });

  for (const x of [-0.98, 0.98]) {
    for (const z of [-1.28, 1.28]) {
      const wheel = new THREE.Mesh(wheelGeometry, darkMaterial);
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(x, 0.38, z);
      group.add(wheel);
      wheels.push(wheel);

      const rim = new THREE.Mesh(rimGeometry, rimMaterial);
      rim.rotation.z = Math.PI / 2;
      rim.position.copy(wheel.position);
      group.add(rim);
    }
  }

  for (const x of [-0.65, 0.65]) {
    const headlight = new THREE.Mesh(
      new THREE.BoxGeometry(0.34, 0.12, 0.055),
      new THREE.MeshStandardMaterial({
        color: 0xffffff,
        emissive: 0xc8ffe0,
        emissiveIntensity: 2
      })
    );
    headlight.position.set(x, 0.76, -2.09);
    group.add(headlight);

    const taillight = new THREE.Mesh(
      new THREE.BoxGeometry(0.4, 0.11, 0.055),
      new THREE.MeshStandardMaterial({
        color: 0xff2525,
        emissive: 0xff1010,
        emissiveIntensity: 1.2
      })
    );
    taillight.position.set(x, 0.76, 2.09);
    group.add(taillight);
  }

  group.userData.wheels = wheels;
  group.userData.isPlayer = isPlayer;
  group.userData.length = 4.15;

  return group;
}

function spawnTraffic() {
  if (traffic.length >= ROAD.maxTraffic) return;

  const lane = Math.floor(Math.random() * ROAD.lanes);
  const laneX = laneToX(lane);

  const colors = [
    0xadb9b1, 0x324d44, 0x963d34, 0x29476d,
    0xc0a36c, 0xd6d8d1, 0x4b5550, 0x735c76
  ];

  const color = colors[Math.floor(Math.random() * colors.length)];
  const car = createCar(color);

  car.position.set(
    laneX + (Math.random() - 0.5) * 0.25,
    0,
    -ROAD.spawnDistance - Math.random() * 100
  );

  car.rotation.y = Math.PI;
  car.userData.lane = lane;
  car.userData.speed = 48 + Math.random() * 95;
  car.userData.baseX = laneX;
  car.userData.phase = Math.random() * Math.PI * 2;

  scene.add(car);
  traffic.push(car);
}

function laneToX(lane) {
  return -ROAD.width / 2 +
    ROAD.width * (lane + 0.5) / ROAD.lanes;
}

function bindEvents() {
  window.addEventListener("resize", resize);

  window.addEventListener("keydown", event => {
    const key = event.key.toLowerCase();

    if ([
      "arrowup", "arrowdown", "arrowleft", "arrowright",
      " ", "w", "a", "s", "d"
    ].includes(key)) {
      event.preventDefault();
    }

    keys.add(key);

    if (key === "escape" || key === "p") {
      if (state.mode === "playing") pauseGame();
      else if (state.mode === "paused") resumeGame();
    }

    if (key === "enter" && state.mode !== "playing") startGame();

    if (key === "r" && state.mode === "gameover") restartGame();
  }, { passive: false });

  window.addEventListener("keyup", event => {
    keys.delete(event.key.toLowerCase());
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden && state.mode === "playing") pauseGame();
  });

  ui.start.addEventListener("click", startGame);
  ui.pause.addEventListener("click", () => {
    if (state.mode === "playing") pauseGame();
    else if (state.mode === "paused") resumeGame();
  });
  ui.resume.addEventListener("click", resumeGame);
  ui.restart.addEventListener("click", restartGame);
  ui.settingsOpen.addEventListener("click", openSettings);
  ui.settingsClose.addEventListener("click", closeSettings);
  ui.settingsDone.addEventListener("click", closeSettings);

  ui.quality.addEventListener("change", () => {
    updateQuality(ui.quality.value);
  });

  ui.shake.addEventListener("change", () => {
    state.cameraShake = ui.shake.checked;
  });

  ui.effects.addEventListener("change", () => {
    state.effects = ui.effects.checked;
    if (!state.effects) ui.speedLines.classList.remove("active");
  });

  for (const button of document.querySelectorAll("[data-control]")) {
    const control = button.dataset.control;

    const down = event => {
      event.preventDefault();
      touch[control] = true;
      button.classList.add("pressed");
    };

    const up = event => {
      event.preventDefault();
      touch[control] = false;
      button.classList.remove("pressed");
    };

    button.addEventListener("pointerdown", down);
    button.addEventListener("pointerup", up);
    button.addEventListener("pointercancel", up);
    button.addEventListener("pointerleave", up);
    button.addEventListener("contextmenu", e => e.preventDefault());
  }

  resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe($("#game"));
}

function resize() {
  if (!renderer || !camera) return;

  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();

  renderer.setPixelRatio(Math.min(
    devicePixelRatio || 1,
    QUALITY[state.quality].dpr
  ));

  renderer.setSize(innerWidth, innerHeight, false);
}

function updateQuality(level) {
  state.quality = QUALITY[level] ? level : "medium";

  const config = QUALITY[state.quality];

  renderer.setPixelRatio(Math.min(
    devicePixelRatio || 1,
    config.dpr
  ));

  renderer.setSize(innerWidth, innerHeight, false);
  renderer.shadowMap.enabled = config.shadows;
  sun.castShadow = config.shadows;
  scene.fog.density = config.fog;

  clearScenery();
  createScenery();
}

function openSettings() {
  if (state.mode === "playing") pauseGame();
  ui.settings.classList.remove("hidden");
}

function closeSettings() {
  ui.settings.classList.add("hidden");
}

function startGame() {
  if (state.mode === "gameover") resetRun();

  state.mode = "playing";
  ui.intro.classList.add("hidden");
  ui.pausePanel.classList.add("hidden");
  ui.settings.classList.add("hidden");
  ui.status.textContent = "DRIVE ACTIVE";

  startAudio();
}

function pauseGame() {
  if (state.mode !== "playing") return;

  state.mode = "paused";
  ui.pausePanel.classList.remove("hidden");
  ui.status.textContent = "DRIVE PAUSED";
  setAudioVolume(0.001);
}

function resumeGame() {
  if (state.mode !== "paused") return;

  state.mode = "playing";
  ui.pausePanel.classList.add("hidden");
  ui.settings.classList.add("hidden");
  ui.status.textContent = "DRIVE ACTIVE";
  startAudio();
}

function restartGame() {
  resetRun();
  startGame();
}

function resetRun() {
  state.speed = 0;
  state.x = 0;
  state.steer = 0;
  state.targetSteer = 0;
  state.distance = 0;
  state.score = 0;
  state.elapsed = 0;
  state.spawnTimer = 1;
  state.collisionCooldown = 0;
  state.nearMissCooldown = 0;
  state.gear = 1;

  player.position.set(0, 0, ROAD.playerZ);
  player.rotation.set(0, 0, 0);

  for (const car of traffic) scene.remove(car);
  traffic = [];

  for (const particle of particles) scene.remove(particle);
  particles = [];

  ui.speedStatus.textContent = "READY";
  ui.speedStatus.style.color = "";
  updateHUD();
}

function finishRun() {
  state.mode = "gameover";
  ui.eyebrow.textContent = "RUN COMPLETE / SUMMARY";
  ui.headline.innerHTML = "Every mile<br><em>counts.</em>";
  ui.description.textContent =
    `You drove ${state.distance.toFixed(1)} km and scored ${Math.floor(state.score).toLocaleString()}. Ready for another run?`;

  ui.start.querySelector("span").textContent = "DRIVE AGAIN";
  ui.intro.classList.remove("hidden");
  ui.pausePanel.classList.add("hidden");
  ui.status.textContent = "RUN COMPLETE";
  setAudioVolume(0.001);
}

function down(...names) {
  return names.some(name => keys.has(name));
}

function updatePlayer(dt) {
  const accelerating =
    down("w", "arrowup") || touch.accelerate;

  const braking =
    down("s", "arrowdown", " ") || touch.brake;

  const left =
    down("a", "arrowleft") || touch.left;

  const right =
    down("d", "arrowright") || touch.right;

  if (accelerating) {
    state.speed += state.acceleration * dt;
  } else {
    state.speed -= state.drag * dt;
  }

  if (braking) state.speed -= state.braking * dt;

  state.speed = THREE.MathUtils.clamp(
    state.speed,
    0,
    state.maxSpeed
  );

  const input = Number(right) - Number(left);
  state.targetSteer = input;

  state.steer = THREE.MathUtils.damp(
    state.steer,
    state.targetSteer,
    7,
    dt
  );

  const speedRatio = state.speed / state.maxSpeed;

  state.x += state.steer * 7.1 * (0.25 + speedRatio) * dt;

  state.x = THREE.MathUtils.clamp(
    state.x,
    -ROAD.width * 0.65,
    ROAD.width * 0.65
  );

  const roadEdge = ROAD.width / 2 - 0.95;

  if (Math.abs(state.x) > roadEdge) {
    state.speed = Math.max(0, state.speed - 35 * dt);

    if (
      Math.abs(state.x) > ROAD.width / 2 + 0.7 &&
      state.collisionCooldown <= 0
    ) {
      state.collisionCooldown = 1;
      state.speed *= 0.58;
      state.score = Math.max(0, state.score - 150);
      impactEffect();
    }
  }

  player.position.x = state.x;
  player.position.y =
    Math.sin(state.elapsed * 9) * speedRatio * 0.018;

  player.rotation.z = -state.steer * 0.075 * (0.25 + speedRatio);
  player.rotation.y = state.steer * 0.045;

  for (const wheel of player.userData.wheels) {
    wheel.rotation.x -= state.speed * dt * 0.075;
  }

  state.gear =
    speedRatio < 0.16 ? 1 :
    speedRatio < 0.32 ? 2 :
    speedRatio < 0.50 ? 3 :
    speedRatio < 0.68 ? 4 :
    speedRatio < 0.86 ? 5 : 6;

  state.distance += state.speed * dt / 3600;
  state.score += state.speed * dt * 0.42;

  if (Math.abs(state.steer) > 0.7 && state.speed > 110) {
    state.score += dt * 2;
  }

  state.collisionCooldown = Math.max(
    0, state.collisionCooldown - dt
  );

  state.nearMissCooldown = Math.max(
    0, state.nearMissCooldown - dt
  );
}

function updateRoad(dt) {
  if (state.mode !== "playing") return;

  const movement = state.speed / 3.6 * dt;

  for (const segment of roadSegments) {
    segment.position.z += movement;

    if (segment.position.z > ROAD.segmentLength) {
      segment.position.z -=
        ROAD.segmentLength * ROAD.segmentCount;
    }
  }

  for (const item of scenery) {
    item.position.z += movement;

    if (item.position.z > 35) {
      item.position.z =
        -ROAD.segmentLength * ROAD.segmentCount -
        Math.random() * 100;

      const side = item.userData.side || 1;
      item.position.x =
        side * (ROAD.width / 2 + 5 + Math.random() * 45);
    }
  }

  sky.position.x = camera.position.x * 0.04;
}

function updateTraffic(dt) {
  if (state.mode !== "playing") return;

  state.spawnTimer -= dt;

  const interval = THREE.MathUtils.mapLinear(
    state.speed,
    0,
    state.maxSpeed,
    2.1,
    0.85
  );

  if (state.spawnTimer <= 0 && traffic.length < ROAD.maxTraffic) {
    spawnTraffic();
    state.spawnTimer = interval + Math.random() * 0.65;
  }

  for (let i = traffic.length - 1; i >= 0; i--) {
    const car = traffic[i];

    // Traffic moves relative to the player's forward speed.
    const relativeSpeed =
      (state.speed - car.userData.speed) / 3.6;

    car.position.z += relativeSpeed * dt;

    car.position.x = THREE.MathUtils.damp(
      car.position.x,
      car.userData.baseX,
      1,
      dt
    );

    for (const wheel of car.userData.wheels) {
      wheel.rotation.x -= car.userData.speed * dt * 0.018;
    }

    const dz = Math.abs(car.position.z - player.position.z);
    const dx = Math.abs(car.position.x - player.position.x);

    if (
      dz < 3.0 &&
      dx < 1.72 &&
      state.collisionCooldown <= 0
    ) {
      state.collisionCooldown = 1.2;
      state.speed *= 0.46;
      state.score = Math.max(0, state.score - 350);
      car.position.z -= 8;
      impactEffect();
    } else if (
      dz < 4.8 &&
      dx < 2.75 &&
      dx > 1.55 &&
      state.nearMissCooldown <= 0 &&
      state.speed > 75
    ) {
      state.nearMissCooldown = 0.75;
      state.score += 250;
      showNearMiss();
    }

    if (car.position.z > 24 || car.position.z < -750) {
      scene.remove(car);
      traffic.splice(i, 1);
    }
  }
}

function impactEffect() {
  ui.speedStatus.textContent = "IMPACT";
  ui.speedStatus.style.color = "#ff796b";

  canvas.classList.remove("impact");
  void canvas.offsetWidth;
  canvas.classList.add("impact");

  for (let i = 0; i < 8; i++) {
    const particle = new THREE.Mesh(
      new THREE.SphereGeometry(0.04 + Math.random() * 0.05, 5, 5),
      new THREE.MeshBasicMaterial({ color: 0xffc477 })
    );

    particle.position.set(
      state.x + (Math.random() - 0.5),
      0.7 + Math.random(),
      player.position.z + (Math.random() - 0.5) * 2
    );

    particle.userData.velocity = new THREE.Vector3(
      (Math.random() - 0.5) * 7,
      Math.random() * 5,
      (Math.random() - 0.5) * 6
    );

    particle.userData.life = 0.5 + Math.random() * 0.5;

    scene.add(particle);
    particles.push(particle);
  }

  window.setTimeout(() => {
    if (ui.speedStatus.textContent === "IMPACT") {
      ui.speedStatus.textContent = "RECOVERING";
      ui.speedStatus.style.color = "";
    }
  }, 800);
}

function showNearMiss() {
  ui.speedStatus.textContent = "NEAR MISS +250";
  ui.speedStatus.style.color = "#ffe0a0";

  window.setTimeout(() => {
    if (ui.speedStatus.textContent === "NEAR MISS +250") {
      ui.speedStatus.textContent =
        state.speed > 180 ? "HIGH SPEED" : "CRUISING";

      ui.speedStatus.style.color = "";
    }
  }, 750);
}

function updateParticles(dt) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const particle = particles[i];

    particle.userData.life -= dt;
    particle.position.addScaledVector(
      particle.userData.velocity, dt
    );

    particle.userData.velocity.y -= 9.8 * dt;

    if (particle.userData.life <= 0) {
      scene.remove(particle);
      particle.geometry.dispose();
      particle.material.dispose();
      particles.splice(i, 1);
    }
  }
}

function updateCamera(dt) {
  const ratio = state.speed / state.maxSpeed;

  const targetX = state.x * 0.42;
  const targetY = 5.0 + ratio * 0.65;
  const targetZ = 13.2 + ratio * 1.3;

  camera.position.x = THREE.MathUtils.damp(
    camera.position.x, targetX, 2.2, dt
  );

  camera.position.y = THREE.MathUtils.damp(
    camera.position.y, targetY, 2.2, dt
  );

  camera.position.z = THREE.MathUtils.damp(
    camera.position.z, targetZ, 2.2, dt
  );

  if (state.cameraShake && state.mode === "playing") {
    const amount = ratio * 0.025;
    camera.position.x += (Math.random() - 0.5) * amount;
    camera.position.y += (Math.random() - 0.5) * amount;
  }

  camera.lookAt(state.x * 0.17, 0.95, -15 - ratio * 5);

  camera.fov = THREE.MathUtils.damp(
    camera.fov, 64 + ratio * 7, 2, dt
  );

  camera.updateProjectionMatrix();
}

function updateHUD() {
  ui.distance.textContent = state.distance.toFixed(1);

  ui.score.textContent = Math.floor(state.score)
    .toString()
    .padStart(6, "0");

  ui.speed.textContent = Math.round(state.speed)
    .toString()
    .padStart(3, "0");

  ui.gear.textContent = state.gear;

  ui.rpm.style.width =
    `${Math.min(100, state.speed / state.maxSpeed * 100)}%`;

  if (!["IMPACT", "NEAR MISS +250"].includes(ui.speedStatus.textContent)) {
    ui.speedStatus.textContent =
      state.speed > 180 ? "HIGH SPEED" :
      state.speed > 90 ? "PUSHING" :
      state.speed > 10 ? "CRUISING" : "IDLE";
  }

  ui.speedLines.classList.toggle(
    "active",
    state.effects &&
    state.speed > 160 &&
    state.mode === "playing"
  );
}

function startAudio() {
  try {
    const AudioContextClass =
      window.AudioContext || window.webkitAudioContext;

    if (!AudioContextClass) return;

    if (audioContext) {
      if (audioContext.state === "suspended") audioContext.resume();
      setAudioVolume(0.035);
      return;
    }

    audioContext = new AudioContextClass();

    engineOscillator = audioContext.createOscillator();
    engineFilter = audioContext.createBiquadFilter();
    engineGain = audioContext.createGain();

    engineOscillator.type = "sawtooth";
    engineOscillator.frequency.value = 55;

    engineFilter.type = "lowpass";
    engineFilter.frequency.value = 300;

    engineGain.gain.value = 0.001;

    engineOscillator.connect(engineFilter);
    engineFilter.connect(engineGain);
    engineGain.connect(audioContext.destination);

    engineOscillator.start();
    audioContext.resume();
  } catch (error) {
    console.info("Engine audio unavailable:", error);
  }
}

function setAudioVolume(value) {
  if (!audioContext || !engineGain) return;

  engineGain.gain.setTargetAtTime(
    Math.max(0.0001, value),
    audioContext.currentTime,
    0.12
  );
}

function updateAudio() {
  if (!audioContext || !engineOscillator) return;

  const ratio = state.speed / state.maxSpeed;

  engineOscillator.frequency.setTargetAtTime(
    45 + ratio * 115,
    audioContext.currentTime,
    0.08
  );

  engineFilter.frequency.setTargetAtTime(
    150 + ratio * 900,
    audioContext.currentTime,
    0.08
  );

  setAudioVolume(state.mode === "playing" ? 0.012 + ratio * 0.03 : 0.001);
}

function frame() {
  if (disposed) return;

  const dt = Math.min(clock.getDelta(), 0.04);

  if (state.mode === "playing") {
    state.elapsed += dt;

    updatePlayer(dt);
    updateRoad(dt);
    updateTraffic(dt);
    updateAudio();
  }

  updateParticles(dt);
  updateCamera(dt);
  updateHUD();

  renderer.render(scene, camera);
}

window.addEventListener("beforeunload", () => {
  disposed = true;

  if (resizeObserver) resizeObserver.disconnect();

  if (renderer) renderer.setAnimationLoop(null);

  if (audioContext) audioContext.close();
});

init();
