"use client";

/**
 * The 3D dice cup: a leather cup and two dice on a transparent canvas over the
 * centre of the board (three.js, loaded on demand).
 *
 * The dice result always comes from the server; the animation is steered so the
 * dice settle showing those numbers (each value has a fixed face, and the final
 * orientation puts that face on top).
 */
import type * as THREE_NS from "three";
import { playSound } from "./sound";

type Three = typeof THREE_NS;

export interface DiceScene {
  /** Pick the cup up and start shaking it (dice disappear into the cup). */
  startShake(): void;
  /** Pointer position over the canvas, -1..1 on both axes, steers the shaking cup. */
  moveShake(nx: number, ny: number): void;
  /** Shake by itself for `ms` (other players' rolls, or the Roll button). */
  autoShake(ms: number): Promise<void>;
  /** Slam the cup upside down in the centre of the table. */
  flip(): Promise<void>;
  /** Lift the cup and let the dice settle on `dice`. */
  reveal(dice: [number, number]): Promise<void>;
  /** Put the cup back without changing the dice (e.g. the roll failed). */
  cancel(): Promise<void>;
  /** Your turn to roll: the cup bobs gently to invite a press. */
  setReady(ready: boolean): void;
  resize(): void;
  dispose(): void;
}

const H = 1.25; // cup height
const REST = { x: -2.05, z: 0.35 };
const SHAKE = { x: -0.9, y: 1.35, z: 0.7 };
const DIE = 0.56;

/** Material order of a box: +x, -x, +y, -y, +z, -z. Opposite faces add up to 7. */
const FACE_VALUES = [3, 4, 1, 6, 2, 5];

const easeOut = (t: number) => 1 - (1 - t) ** 3;
const easeIn = (t: number) => t * t * t;
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function dieFaceTexture(THREE: Three, value: number) {
  const size = 256;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d")!;
  g.fillStyle = "#fbf8f1";
  g.fillRect(0, 0, size, size);
  const pip = (x: number, y: number) => {
    g.beginPath();
    g.arc(x * size, y * size, size * 0.085, 0, Math.PI * 2);
    g.fill();
  };
  g.fillStyle = value === 1 ? "#c62828" : "#1d2328";
  const a = 0.27, m = 0.5, b = 0.73;
  const layouts: Record<number, [number, number][]> = {
    1: [[m, m]],
    2: [[a, a], [b, b]],
    3: [[a, a], [m, m], [b, b]],
    4: [[a, a], [b, a], [a, b], [b, b]],
    5: [[a, a], [b, a], [m, m], [a, b], [b, b]],
    6: [[a, a], [b, a], [a, m], [b, m], [a, b], [b, b]],
  };
  layouts[value].forEach(([x, y]) => pip(x, y));
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function leatherTexture(THREE: Three) {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 256;
  const g = c.getContext("2d")!;
  g.fillStyle = "#6e2418";
  g.fillRect(0, 0, c.width, c.height);
  // Grain.
  for (let i = 0; i < 9000; i++) {
    const v = Math.random();
    g.fillStyle = v > 0.5 ? "rgba(255,220,200,0.05)" : "rgba(0,0,0,0.08)";
    g.fillRect(Math.random() * c.width, Math.random() * c.height, 2, 2);
  }
  // Stitching near the rim and the base.
  g.strokeStyle = "rgba(240, 210, 150, 0.85)";
  g.lineWidth = 3;
  for (const y of [18, c.height - 22]) {
    for (let x = 0; x < c.width; x += 18) {
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + 10, y);
      g.stroke();
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  return tex;
}

/** Rotation that puts `value` on top (+y). */
function faceUp(THREE: Three, value: number) {
  const q = new THREE.Quaternion();
  const X = new THREE.Vector3(1, 0, 0);
  const Z = new THREE.Vector3(0, 0, 1);
  switch (value) {
    case 6: q.setFromAxisAngle(X, Math.PI); break;
    case 3: q.setFromAxisAngle(Z, Math.PI / 2); break;
    case 4: q.setFromAxisAngle(Z, -Math.PI / 2); break;
    case 2: q.setFromAxisAngle(X, -Math.PI / 2); break;
    case 5: q.setFromAxisAngle(X, Math.PI / 2); break;
    default: break; // 1 is already on top
  }
  return q;
}

export async function createDiceScene(canvas: HTMLCanvasElement, initial: [number, number] | null): Promise<DiceScene> {
  const THREE = await import("three");
  const { RoundedBoxGeometry } = await import("three/examples/jsm/geometries/RoundedBoxGeometry.js");
  const instant = prefersReducedMotion();
  // Phones/tablets: no soft shadows (lighter on the battery, and some mobile GPUs render the
  // shadow plane as a dark film over the whole canvas).
  const lowPower = window.matchMedia("(pointer: coarse)").matches;

  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, lowPower ? 1.5 : 2));
  renderer.setClearColor(0x000000, 0);
  renderer.shadowMap.enabled = !lowPower;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 60);

  scene.add(new THREE.HemisphereLight(0xfff6e8, 0x334455, 1.4));
  const sun = new THREE.DirectionalLight(0xffffff, 2.4);
  sun.position.set(-3, 9, 5);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = -5;
  sun.shadow.camera.right = 5;
  sun.shadow.camera.top = 5;
  sun.shadow.camera.bottom = -5;
  sun.shadow.radius = 4;
  scene.add(sun);

  // Invisible table that only shows shadows (the board art stays visible underneath).
  const table = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), new THREE.ShadowMaterial({ opacity: 0.35 }));
  table.rotation.x = -Math.PI / 2;
  table.receiveShadow = true;
  if (!lowPower) scene.add(table);

  // ---- cup: a lathe-turned leather cup with gold bands; group origin = middle of the cup
  const cup = new THREE.Group();
  const profile = [
    new THREE.Vector2(0, 0.07),
    new THREE.Vector2(0.47, 0.07),
    new THREE.Vector2(0.55, H),
    new THREE.Vector2(0.62, H),
    new THREE.Vector2(0.53, 0),
    new THREE.Vector2(0, 0),
  ];
  const leather = new THREE.MeshStandardMaterial({
    map: leatherTexture(THREE),
    roughness: 0.62,
    metalness: 0.05,
    side: THREE.DoubleSide,
    emissive: new THREE.Color(0xffc24a),
    emissiveIntensity: 0,
  });
  const body = new THREE.Mesh(new THREE.LatheGeometry(profile, 56), leather);
  body.castShadow = true;
  body.position.y = -H / 2;
  cup.add(body);
  const gold = new THREE.MeshStandardMaterial({ color: 0xd9a93a, metalness: 0.85, roughness: 0.3 });
  for (const [y, r] of [[H, 0.585], [0.06, 0.535]] as const) {
    const band = new THREE.Mesh(new THREE.TorusGeometry(r, 0.035, 12, 56), gold);
    band.rotation.x = Math.PI / 2;
    band.position.y = y - H / 2;
    band.castShadow = true;
    cup.add(band);
  }
  scene.add(cup);

  // ---- dice
  const faceMaterials = FACE_VALUES.map(
    (v) => new THREE.MeshStandardMaterial({ map: dieFaceTexture(THREE, v), roughness: 0.32 }),
  );
  const dieGeometry = new RoundedBoxGeometry(DIE, DIE, DIE, 4, DIE * 0.16);
  const dice = [0, 1].map(() => {
    const d = new THREE.Mesh(dieGeometry, faceMaterials);
    d.castShadow = true;
    scene.add(d);
    return d;
  });

  // ---- state + animation loop
  type Tween = { start: number; dur: number; step: (t: number) => void; done: () => void };
  let tweens: Tween[] = [];
  let shaking = false;
  let ready = false;
  let pointer = { x: 0, y: 0 };
  let shakeT = 0;
  let nextClack = 0;
  let frame = 0;
  let last = performance.now();
  let disposed = false;

  const cupRest = () => {
    cup.position.set(REST.x, H / 2, REST.z);
    cup.rotation.set(0, 0, 0);
  };
  cupRest();

  const placeDice = (values: [number, number] | null) => {
    dice.forEach((d, i) => {
      d.visible = !!values;
      if (!values) return;
      const yaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), (i ? 0.35 : -0.25) + Math.random() * 0.3);
      d.quaternion.copy(yaw.multiply(faceUp(THREE, values[i])));
      d.position.set(i ? 0.55 : -0.25, DIE / 2, i ? 0.15 : -0.1);
    });
  };
  placeDice(initial);

  const tween = (dur: number, step: (t: number) => void) =>
    new Promise<void>((resolve) => {
      if (instant || dur <= 0) {
        step(1);
        resolve();
        kick();
        return;
      }
      tweens.push({ start: performance.now(), dur, step, done: resolve });
      kick();
    });

  const render = () => renderer.render(scene, camera);

  const loop = (now: number) => {
    frame = 0;
    if (disposed) return;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;

    if (shaking) {
      shakeT += dt;
      const t = shakeT;
      cup.position.set(
        SHAKE.x + pointer.x * 0.9 + Math.sin(t * 37) * 0.14,
        SHAKE.y + Math.abs(Math.sin(t * 29)) * 0.18 - pointer.y * 0.25,
        SHAKE.z + Math.cos(t * 31) * 0.1,
      );
      cup.rotation.set(-0.3 + Math.cos(t * 34) * 0.16, 0, Math.sin(t * 41) * 0.28);
      if (now > nextClack) {
        playSound("step", { rate: 0.75 + Math.random() * 0.7, volume: 0.5 + Math.random() * 0.5 });
        nextClack = now + 65 + Math.random() * 95;
      }
    } else if (ready && tweens.length === 0) {
      const t = now / 1000;
      cup.position.y = H / 2 + Math.abs(Math.sin(t * 2.4)) * 0.12;
      cup.rotation.z = Math.sin(t * 2.4) * 0.04;
      leather.emissiveIntensity = 0.1 + Math.sin(t * 3) * 0.06;
    }

    const done: Tween[] = [];
    tweens = tweens.filter((tw) => {
      const p = Math.min(1, (now - tw.start) / tw.dur);
      tw.step(p);
      if (p >= 1) done.push(tw);
      return p < 1;
    });
    render();
    done.forEach((tw) => tw.done());
    if (shaking || ready || tweens.length) frame = requestAnimationFrame(loop);
  };

  function kick() {
    if (!frame && !disposed) {
      last = performance.now();
      frame = requestAnimationFrame(loop);
    }
  }

  const resize = () => {
    const w = canvas.clientWidth || 1;
    const h = canvas.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // Keep about 6.6 units of table visible across, whatever the canvas shape.
    const halfWidth = 3.3;
    const dist = halfWidth / (Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * Math.min(camera.aspect, 1.9));
    const dir = new THREE.Vector3(0, 0.78, 0.62).normalize();
    camera.position.set(-0.45, 0, 0.25).addScaledVector(dir, Math.max(dist, 6.5));
    camera.lookAt(-0.45, 0.2, 0.25);
    camera.updateProjectionMatrix();
    render();
  };
  resize();

  /** Animate the cup from where it is to a position/rotation. */
  const moveCup = (dur: number, to: { x: number; y: number; z: number; rx: number; rz: number }, ease = easeInOut) => {
    const from = { x: cup.position.x, y: cup.position.y, z: cup.position.z, rx: cup.rotation.x, rz: cup.rotation.z };
    return tween(dur, (t) => {
      const e = ease(t);
      cup.position.set(lerp(from.x, to.x, e), lerp(from.y, to.y, e), lerp(from.z, to.z, e));
      cup.rotation.set(lerp(from.rx, to.rx, e), 0, lerp(from.rz, to.rz, e));
    });
  };

  const api: DiceScene = {
    startShake() {
      if (instant) return;
      tweens = [];
      leather.emissiveIntensity = 0;
      dice.forEach((d) => (d.visible = false)); // scooped into the cup
      shaking = true;
      shakeT = 0;
      pointer = { x: 0, y: 0 };
      kick();
    },
    moveShake(nx, ny) {
      pointer = { x: Math.max(-1, Math.min(1, nx)), y: Math.max(-1, Math.min(1, ny)) };
    },
    async autoShake(ms) {
      if (instant) return;
      api.startShake();
      // Wander a little so it doesn't look mechanical.
      const t0 = performance.now();
      await new Promise<void>((resolve) => {
        const tick = () => {
          const t = (performance.now() - t0) / ms;
          if (t >= 1 || !shaking) return resolve();
          pointer = { x: Math.sin(t * 9) * 0.35, y: Math.cos(t * 7) * 0.2 };
          setTimeout(tick, 40);
        };
        tick();
      });
    },
    async flip() {
      shaking = false;
      leather.emissiveIntensity = 0;
      dice.forEach((d) => (d.visible = false));
      // Swing up and over, then slam mouth-down in the centre of the table.
      await moveCup(170, { x: -0.5, y: H / 2 + 1.5, z: 0.4, rx: Math.PI * 0.55, rz: 0.1 }, easeOut);
      await moveCup(200, { x: 0.15, y: H / 2, z: 0.1, rx: Math.PI, rz: 0 }, easeIn);
      playSound("step", { rate: 0.5, volume: 1.6 });
      // Little bounce.
      await tween(120, (t) => (cup.position.y = H / 2 + Math.sin(t * Math.PI) * 0.06));
    },
    async reveal(values) {
      shaking = false;
      // Dice start bunched under the cup with a random spin and roll out to their spots.
      const finals = values.map((v, i) => {
        const yaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), (Math.random() - 0.5) * 1.2);
        return {
          q: yaw.multiply(faceUp(THREE, v)),
          p: new THREE.Vector3(i ? 0.75 + Math.random() * 0.25 : -0.45 - Math.random() * 0.2, DIE / 2, 0.15 + (Math.random() - 0.5) * 0.6),
          axis: new THREE.Vector3(Math.random() - 0.5, 0.2, Math.random() - 0.5).normalize(),
          spin: Math.PI * (2 + Math.random() * 1.5),
        };
      });
      const starts = finals.map((_, i) => new THREE.Vector3(0.15 + (i ? 0.12 : -0.12), DIE / 2 + 0.1, 0.1));
      dice.forEach((d) => (d.visible = true));
      playSound("dice");
      const lift = moveCup(320, { x: -1.1, y: H / 2 + 0.45, z: 0.45, rx: Math.PI * 0.55, rz: 0.4 }, easeOut);
      const roll = tween(700, (t) => {
        const e = easeOut(t);
        dice.forEach((d, i) => {
          const f = finals[i];
          d.position.lerpVectors(starts[i], f.p, e);
          d.position.y = DIE / 2 + Math.abs(Math.sin(t * Math.PI * 2.5)) * 0.35 * (1 - t);
          const spin = new THREE.Quaternion().setFromAxisAngle(f.axis, (1 - e) * f.spin);
          d.quaternion.copy(spin.multiply(f.q));
        });
      });
      await Promise.all([lift, roll]);
      // Cup goes back to its spot (not awaited by the caller's reveal: the dice are what matter).
      void moveCup(450, { x: REST.x, y: H / 2, z: REST.z, rx: 0, rz: 0 }, easeInOut);
    },
    async cancel() {
      shaking = false;
      await moveCup(400, { x: REST.x, y: H / 2, z: REST.z, rx: 0, rz: 0 });
      dice.forEach((d) => (d.visible = true));
      render();
    },
    setReady(value) {
      ready = value && !instant;
      if (!ready) leather.emissiveIntensity = 0;
      if (!ready && !shaking && tweens.length === 0) {
        cup.position.y = H / 2;
        cup.rotation.z = 0;
      }
      kick();
    },
    resize,
    dispose() {
      disposed = true;
      if (frame) cancelAnimationFrame(frame);
      renderer.dispose();
      dieGeometry.dispose();
      faceMaterials.forEach((m) => {
        m.map?.dispose();
        m.dispose();
      });
      leather.map?.dispose();
      leather.dispose();
      gold.dispose();
    },
  };
  return api;
}
