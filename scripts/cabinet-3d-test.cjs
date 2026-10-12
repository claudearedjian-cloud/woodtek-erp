// Cabinet selection regressions run by render-test.js / CI. Real React DOM,
// parser, layout, Three.js geometry/materials/camera/raycaster and component
// effects; only the GPU renderer, dynamic loader and HTTP transport are adapted.
// This is not a pixel/GPU test or an exact Polyboard CAD reconstruction check.
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const React = require("react");
const THREE = require("three");
const { JSDOM } = require("jsdom");

module.exports = async function checkCabinet3D({ compile, check }) {
  compile("src/lib/cabinetScene.ts", "lib/cabinetScene.js");
  compile("src/lib/partLabels.ts", "lib/partLabels.js");
  compile("src/components/Cabinet3DViewer.tsx", "components/Cabinet3DViewer.js");
  compile("src/components/AssemblyView.tsx", "components/AssemblyView.js");
  const compiled = (file) => path.join(__dirname, "..", "compiled", file);
  const { buildCabinetLayout, deriveCabinetDimensions } = require(compiled("lib/polyboardParts.js"));
  const { createCabinetScene, applyExplosion, updateCabinetMaterials, disposeSceneResources, fitCabinetCamera } = require(compiled("lib/cabinetScene.js"));
  const polyboard = require(compiled("lib/polyboard.js"));
  const { SAMPLE_CIX_FILES } = require(compiled("lib/samplePolyboardData.js"));
  const near = (a, b) => Math.abs(a - b) < 0.001;
  const sizeOf = (object) => new THREE.Box3().setFromObject(object).getSize(new THREE.Vector3());
  const boundsFit = (group, camera) => {
    const bounds = new THREE.Box3().setFromObject(group);
    if (bounds.isEmpty()) return false;
    const points = [];
    for (const x of [bounds.min.x, bounds.max.x]) {
      for (const y of [bounds.min.y, bounds.max.y]) {
        for (const z of [bounds.min.z, bounds.max.z]) points.push(new THREE.Vector3(x, y, z).project(camera));
      }
    }
    return points.every((p) => Number.isFinite(p.x + p.y + p.z) && Math.abs(p.x) < 1 && Math.abs(p.y) < 1 && Math.abs(p.z) < 1);
  };
  const watchResources = (root) => {
    const resources = new Map();
    root.traverse((object) => {
      if (object.geometry) resources.set(object.geometry, 0);
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        if (material) resources.set(material, 0);
      }
    });
    resources.forEach((_, resource) => resource.addEventListener("dispose", () => resources.set(resource, resources.get(resource) + 1)));
    return () => resources.size > 0 && Array.from(resources.values()).every((count) => count === 1);
  };

  const header = "Length;Width;Thickness;Qty;Edge1;Grain;Part;Material;Edge2;Edge3;Edge4;Project;Cabinet;CIX";
  const row = (l, w, name, cabinet, cix = "", qty = 1) => [l, w, 18, qty, "", 0, name, "MFC", "", "", "", "Selected cabinet test", cabinet, cix].join(";");
  const csv = [header,
    row(720, 560, "Left Side", "Floor 600", "BASE_LEFT.CIX"),
    row(720, 560, "Right Side", "Floor 600"),
    row(564, 560, "Bottom", "Floor 600"),
    row(715, 596, "Door", "Floor 600"),
    row(2100, 380, "Left Side", "Tall 900", "TALL_LEFT.cix"),
    row(2100, 380, "Right Side", "Tall 900"),
    row(864, 380, "Bottom", "Tall 900"),
    row(2090, 446, "Door", "Tall 900", "", 2),
  ].join("\n");
  const cixFiles = [
    { filename: "BASE_LEFT.CIX", content: SAMPLE_CIX_FILES["KB600_LS.cix"] },
    { filename: "TALL_LEFT.cix", content: SAMPLE_CIX_FILES["WU900_LS.cix"].replace("LPX=600 LPY=320", "LPX=2100 LPY=380") },
  ];
  const imported = polyboard.parsePolyboardCsv(csv);
  const cabinets = Array.from(imported.cabinetsMap.values());
  polyboard.matchCixToParts(cabinets, cixFiles);
  const [base, tall] = cabinets;
  const baseLayout = buildCabinetLayout(base);
  const tallLayout = buildCabinetLayout(tall);
  const baseModel = createCabinetScene(base, baseLayout);
  const tallModel = createCabinetScene(tall, tallLayout);
  const ownsOnly = (model, cabinet) => model.group.children.length === cabinet.parts.length &&
    model.meshes.size === cabinet.parts.length && cabinet.parts.every((p) => model.meshes.get(p.id)?.userData.cabinetId === cabinet.id) &&
    Array.from(model.meshes.keys()).every((id) => cabinet.parts.some((p) => p.id === id));
  check(ownsOnly(baseModel, base) && ownsOnly(tallModel, tall), "3D geometry: each imported cabinet owns exactly its own part meshes");
  check(baseModel.group !== tallModel.group && baseModel.meshes !== tallModel.meshes && baseModel.holes !== tallModel.holes, "3D geometry: scene groups, mesh maps and CNC marker lists are not shared between cabinets");
  check(baseModel.holes.length === 5 && tallModel.holes.length === 2 &&
    baseModel.holes.every((h) => h.parent === baseModel.meshes.get(base.parts[0].id)) &&
    tallModel.holes.every((h) => h.parent === tallModel.meshes.get(tall.parts[0].id)), "3D geometry: only the selected cabinet's attached CIX borings appear, on their own part");
  check(baseModel.holes[0].material === baseModel.holes[1].material, "3D geometry: a part's drilling markers share one material");
  check(baseLayout.width === 600 && baseLayout.height === 720 && tallLayout.width === 900 && tallLayout.height === 2100, "3D geometry: differently sized CSV cabinets keep their respective imported envelopes");
  const doorId = base.parts.find((p) => p.name === "Door").id;
  const doorSize = sizeOf(baseModel.meshes.get(doorId));
  check(near(doorSize.x, 596) && near(doorSize.y, 715) && near(doorSize.z, 18), "3D geometry: a tall door uses cut length as height, not horizontal width");
  const tallDoors = tall.parts.filter((p) => p.name.startsWith("Door"));
  check(tallDoors.length === 2 && tallDoors.every((p) => near(sizeOf(tallModel.meshes.get(p.id)).x, 446) && near(sizeOf(tallModel.meshes.get(p.id)).y, 2090)), "3D geometry: both quantity-expanded doors stand upright with their own net sizes");

  const part = (id, name, l, w, t = 18) => ({ id, name, length: l, width: w, thickness: t, material: "MFC", cabinetName: "Fixture", quantity: 1, barcode: id });
  const drawers = { id: "drawers", name: "Drawers", width: 600, height: 720, depth: 560, quantity: 1,
    parts: [part("df1", "Drawer Front", 140, 596), part("df2", "Drawer Front", 285, 596), part("df3", "Drawer Front", 285, 596)] };
  const drawerModel = createCabinetScene(drawers, buildCabinetLayout(drawers));
  check(drawers.parts.every((p) => near(sizeOf(drawerModel.meshes.get(p.id)).x, 596) && near(sizeOf(drawerModel.meshes.get(p.id)).y, p.length)), "3D geometry: stacked drawer fronts remain wide and short instead of rotated sideways");
  check(drawerModel.meshes.get("df1").position.y > drawerModel.meshes.get("df2").position.y && drawerModel.meshes.get("df2").position.y > drawerModel.meshes.get("df3").position.y, "3D geometry: drawer fronts are stacked at distinct heights");
  const generic = { ...base, id: "generic", parts: [part("left", "Part 1", 720, 560), part("divider", "Part 2", 720, 560), part("right", "Part 3", 720, 560), part("bottom", "Bottom", 564, 560)] };
  const genericLayout = buildCabinetLayout(generic);
  const genericModel = createCabinetScene(generic, genericLayout);
  check(near(genericLayout.placements[0].center.x, -291) && near(genericLayout.placements[2].center.x, 291), "3D geometry: inferred left/right sides stay on the outer faces");
  check(near(genericLayout.placements[1].center.x, 0) && new Set(genericLayout.placements.map((p) => p.center.x + ',' + p.center.y + ',' + p.center.z)).size === 4, "3D geometry: the inferred right side is removed from divider candidates and never overwritten");
  check([baseLayout, tallLayout, genericLayout, buildCabinetLayout(drawers)].every((layout) => layout.placements.every((p) => {
    const cross = new THREE.Vector3(p.axisX.x, p.axisX.y, p.axisX.z).cross(new THREE.Vector3(p.axisY.x, p.axisY.y, p.axisY.z));
    return cross.distanceTo(new THREE.Vector3(p.axisZ.x, p.axisZ.y, p.axisZ.z)) < 0.001;
  })), "3D geometry: front/side/fallback placements all use proper, non-mirrored rotation bases");

  const canonical = buildCabinetLayout({ ...base, width: 750, height: 800, depth: 600 });
  check(canonical.width === 750 && canonical.height === 800 && canonical.depth === 600, "3D geometry: positive stored dimensions are authoritative, matching the cabinet list");
  const partial = deriveCabinetDimensions({ ...base, width: 980, height: 0, depth: 0 });
  check(partial.width === 980 && partial.height === 720 && partial.depth === 560, "3D geometry: only missing cabinet dimensions are derived from parts");
  const invalid = buildCabinetLayout({ ...base, width: Infinity, height: NaN, depth: -1 });
  check(Number.isFinite(invalid.width + invalid.height + invalid.depth) && invalid.width > 0 && invalid.height > 0 && invalid.depth > 0, "3D geometry: invalid/non-finite cabinet dimensions cannot corrupt camera framing");
  const invalidPanel = buildCabinetLayout({ ...base, parts: [part("invalid", "Left Side", Infinity, NaN, -1)] }).placements[0].size;
  check(Number.isFinite(invalidPanel.length + invalidPanel.width + invalidPanel.thickness) && invalidPanel.thickness === 18, "3D geometry: invalid panel dimensions have finite positive fallbacks");
  const worktop = { ...base, id: "large-worktop", parts: [part("worktop", "Worktop", 2400, 1800, 140)] };
  const worktopLayout = buildCabinetLayout(worktop);
  const worktopModel = createCabinetScene(worktop, worktopLayout);
  const params = worktopModel.meshes.get("worktop").geometry.parameters;
  check(params.width === 2400 && params.height === 1800 && params.depth === 140, "3D geometry: real overhanging/large panel sizes are never silently capped to cabinet metadata");

  const firstMesh = baseModel.meshes.get(base.parts[0].id);
  const material = firstMesh.material;
  firstMesh.userData.isScanned = true;
  updateCabinetMaterials(doorId, baseModel.meshes, true);
  check(firstMesh.material === material && material.color.getHex() === 0x10b981 && material.wireframe, "3D materials: scan/edge updates reuse the existing material with the correct color");
  check(baseModel.meshes.get(doorId).material.color.getHex() === 0xfbbf24, "3D materials: only the selected part is amber");
  updateCabinetMaterials(tall.parts[0].id, baseModel.meshes, false, false);
  check(firstMesh.material === material && material.color.getHex() === 0x64748b && !material.wireframe &&
    Array.from(baseModel.meshes.values()).every((m) => m.material.color.getHex() !== 0xfbbf24), "3D materials: foreign-cabinet part IDs cannot highlight this cabinet, and highlightScanned=false is honored");
  const assembledPosition = firstMesh.position.clone();
  applyExplosion(baseLayout, 1, baseModel.meshes);
  check(firstMesh.position.distanceTo(assembledPosition) > 0 && baseModel.holes[0].parent === firstMesh, "3D explosion: parts move outward with their own attached CNC holes");
  applyExplosion(baseLayout, 0, baseModel.meshes);
  check(firstMesh.position.distanceTo(assembledPosition) < 0.001, "3D explosion: reset returns every part to the assembled placement");

  const camera = new THREE.PerspectiveCamera(45, 760 / 450, 0.1, 100000);
  worktopModel.group.rotation.set(0.35, -0.6, 0);
  fitCabinetCamera(camera, worktopModel.group, worktopLayout);
  check(boundsFit(worktopModel.group, camera), "3D camera: actual overhanging mesh bounds fit a wide viewport");
  camera.aspect = 220 / 460;
  fitCabinetCamera(camera, worktopModel.group, worktopLayout);
  check(boundsFit(worktopModel.group, camera), "3D camera: horizontal FOV fits the entire model on a narrow/portrait viewport");
  applyExplosion(worktopLayout, 1, worktopModel.meshes);
  fitCabinetCamera(camera, worktopModel.group, worktopLayout);
  check(boundsFit(worktopModel.group, camera), "3D camera: exploded panel bounds are reframed instead of cropped");
  const distance = camera.position.clone();
  worktopModel.group.scale.setScalar(2);
  fitCabinetCamera(camera, worktopModel.group, worktopLayout);
  check(worktopModel.group.scale.x === 2 && camera.position.distanceTo(distance) < 0.001, "3D camera: automatic framing preserves deliberate user zoom");
  const empty = { ...base, id: "empty", name: "Empty cabinet", parts: [] };
  const emptyLayout = buildCabinetLayout(empty);
  const emptyModel = createCabinetScene(empty, emptyLayout);
  fitCabinetCamera(camera, emptyModel.group, emptyLayout);
  check(emptyModel.meshes.size === 0 && emptyModel.holes.length === 0 && Number.isFinite(camera.position.length()) && camera.far > camera.near, "3D geometry: an empty cabinet has no borrowed meshes and a finite metadata-based camera");
  const baseDisposedOnce = watchResources(baseModel.group);
  disposeSceneResources(baseModel.group);
  check(baseDisposedOnce(), "3D cleanup: panel/edge/hole geometries and shared CNC materials are disposed exactly once");
  const grid = new THREE.GridHelper(2000, 20);
  const gridDisposedOnce = watchResources(grid);
  disposeSceneResources(grid);
  check(gridDisposedOnce(), "3D cleanup: floor-grid geometry and materials are also disposed");
  [tallModel, drawerModel, genericModel, worktopModel, emptyModel].forEach((model) => disposeSceneResources(model.group));

  // Real client effects, toolbar controls, selection and application import flow.
  const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://woodtek.test/" });
  const win = dom.window;
  const globals = new Map();
  const setGlobal = (name, value) => {
    if (!globals.has(name)) globals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  };
  const raf = new Map();
  let rafId = 0;
  const renderers = [];
  const observers = [];
  let failRenderer = false;
  let viewport = { width: 760, height: 450 };
  const frames = (count = 1) => {
    for (let i = 0; i < count; i++) {
      const callbacks = Array.from(raf.values());
      raf.clear();
      callbacks.forEach((callback) => callback(i * 16));
    }
  };
  class TestRenderer {
    constructor() {
      if (failRenderer) throw new Error("Expected test GPU failure");
      this.domElement = win.document.createElement("canvas");
      this.shadowMap = { enabled: true };
      this.disposals = 0;
      this.contextLosses = 0;
      renderers.push(this);
    }
    setSize(w, h) { this.width = w; this.height = h; }
    setPixelRatio(value) { this.pixelRatio = value; }
    render(scene, camera) {
      scene.updateMatrixWorld(true);
      camera.updateMatrixWorld(true);
      this.scene = scene;
      this.camera = camera;
    }
    dispose() { this.disposals++; }
    forceContextLoss() { this.contextLosses++; }
  }
  class TestResizeObserver {
    constructor(callback) { this.callback = callback; this.disconnected = false; observers.push(this); }
    observe(element) { this.element = element; }
    disconnect() { this.disconnected = true; }
  }
  const fileReads = [];
  class TrackedFileReader extends win.FileReader {
    readAsText(file) {
      fileReads.push(new Promise((resolve) => this.addEventListener("loadend", resolve, { once: true })));
      super.readAsText(file);
    }
  }
  const { act } = React;
  const hosts = [];
  const roots = [];
  const originalError = console.error;
  const expectedErrors = [];
  const unexpectedErrors = [];
  try {
    for (const name of ["window", "document", "navigator", "HTMLElement", "Node", "Event", "MouseEvent", "WheelEvent", "File"]) setGlobal(name, name === "window" ? win : win[name]);
    setGlobal("FileReader", TrackedFileReader);
    setGlobal("ResizeObserver", TestResizeObserver);
    setGlobal("requestAnimationFrame", (callback) => { raf.set(++rafId, callback); return rafId; });
    setGlobal("cancelAnimationFrame", (id) => raf.delete(id));
    setGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    setGlobal("alert", (message) => { throw new Error("Unexpected alert: " + message); });
    Object.defineProperty(win.HTMLElement.prototype, "clientWidth", { get: () => viewport.width });
    Object.defineProperty(win.HTMLElement.prototype, "clientHeight", { get: () => viewport.height });
    win.HTMLElement.prototype.getBoundingClientRect = () => new win.DOMRect(0, 0, viewport.width, viewport.height);
    const loadWith = (file, replacements) => {
      const filename = compiled(file);
      const loaded = new Module(filename, module);
      loaded.filename = filename;
      loaded.paths = Module._nodeModulePaths(path.dirname(filename));
      loaded.require = (id) => Object.hasOwn(replacements, id) ? replacements[id] : Module.prototype.require.call(loaded, id);
      loaded._compile(fs.readFileSync(filename, "utf8"), filename);
      return loaded.exports;
    };
    const Cabinet3DViewer = loadWith("components/Cabinet3DViewer.js", { three: { ...THREE, WebGLRenderer: TestRenderer } }).default;
    const AssemblyView = loadWith("components/AssemblyView.js", { "next/dynamic": () => Cabinet3DViewer }).default;
    const { createRoot } = require("react-dom/client");
    const mountRoot = () => {
      const host = win.document.createElement("div");
      win.document.body.appendChild(host);
      const root = createRoot(host);
      hosts.push(host);
      roots.push(root);
      return { host, root };
    };
    const latest = () => renderers[renderers.length - 1];
    const groupOf = (renderer = latest()) => renderer.scene.children.find((object) => object.isGroup && object.userData.cabinetId);
    const meshesOf = (renderer = latest()) => groupOf(renderer).children.filter((object) => object.userData.partId);
    const holesOf = (renderer = latest()) => meshesOf(renderer).flatMap((mesh) => mesh.children.filter((object) => object.geometry?.type === "CylinderGeometry"));
    const hasCabinet = (cabinet) => {
      const meshes = meshesOf();
      return groupOf().userData.cabinetId === cabinet.id && meshes.length === cabinet.parts.length &&
        cabinet.parts.every((p) => meshes.some((m) => m.userData.partId === p.id && m.userData.partName === p.name && near(m.geometry.parameters.width, p.length) && near(m.geometry.parameters.height, p.width)));
    };
    const button = (host, text) => {
      const node = Array.from(host.querySelectorAll("button")).find((b) => b.textContent.trim() === text);
      if (!node) throw new Error("Button not found: " + text);
      return node;
    };
    const click = async (node) => { await act(async () => node.dispatchEvent(new win.MouseEvent("click", { bubbles: true }))); };
    const change = async (node, value) => {
      await act(async () => {
        const prototype = node.tagName === "SELECT" ? win.HTMLSelectElement.prototype : win.HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(prototype, "value").set.call(node, String(value));
        node.dispatchEvent(new win.Event("input", { bubbles: true }));
        node.dispatchEvent(new win.Event("change", { bubbles: true }));
      });
    };
    const wheel = async (host) => {
      await act(async () => host.querySelector('[data-testid="cabinet-3d-canvas"]').dispatchEvent(new win.WheelEvent("wheel", { bubbles: true, deltaY: -10, cancelable: true })));
      frames();
    };
    console.error = (...args) => {
      if (args[0] === "Unable to start the cabinet 3D renderer") expectedErrors.push(args);
      else {
        // Transpiled CommonJS tests emit this known dependency warning; keep it
        // visible, but do not confuse it with a component/lifecycle error.
        const knownDeprecation = typeof args[0] === "string" && /^\(node:\d+\) \[THREE_CJS_DEPRECATED\]/.test(args[0]);
        if (!knownDeprecation) unexpectedErrors.push(args);
        originalError(...args);
      }
    };

    const { host, root } = mountRoot();
    const clickedParts = [];
    const show = async (cabinet, projectId = "imported", props = {}) => {
      await act(async () => root.render(React.createElement(Cabinet3DViewer, {
        key: `${projectId}:${cabinet.id}`, cabinet, selectedPartId: cabinet.parts[0]?.id,
        onSelectPart: (p) => clickedParts.push(p), ...props,
      })));
      frames();
    };
    await show(base);
    check(hasCabinet(base) && host.querySelectorAll("canvas").length === 1, "3D lifecycle: the initial imported cabinet mounts exactly one canvas containing only its own meshes");
    check(host.textContent.includes("Floor 600") && host.textContent.includes("600 × 720 × 560 mm") && host.textContent.includes("4 parts"), "3D lifecycle: the viewer visibly identifies the selected cabinet, dimensions and part count");
    check(host.textContent.includes("Placement is estimated"), "3D lifecycle: reconstructed placement is honestly labelled, not presented as the original CAD transforms");
    const initialRenderer = latest();
    const startY = groupOf().rotation.y;
    await click(button(host, "Rotate"));
    frames(3);
    check(groupOf().rotation.y > startY && latest() === initialRenderer, "3D controls: Rotate takes effect in the existing animation loop without recreating the renderer");
    await click(button(host, "Pause"));
    const pausedY = groupOf().rotation.y;
    frames(3);
    check(near(groupOf().rotation.y, pausedY), "3D controls: Pause stops the live rotation flag");
    await click(button(host, "Edges"));
    check(meshesOf().every((m) => m.material.wireframe), "3D controls: Edges updates current part materials");
    await click(button(host, "CNC Holes"));
    check(holesOf().length === 5 && holesOf().every((h) => !h.visible), "3D controls: CNC Holes hides only this cabinet's own boring markers");
    await change(host.querySelector('input[type="range"]'), 0.8);
    frames();
    check(meshesOf().some((m) => m.position.distanceTo(m.userData.basePos) > 10), "3D controls: the actual slider updates native mesh explosion positions");
    await wheel(host);
    check(groupOf().scale.x > 1, "3D controls: wheel zoom updates the active model");
    const canvasHost = host.querySelector('[data-testid="cabinet-3d-canvas"]');
    await act(async () => {
      canvasHost.dispatchEvent(new win.MouseEvent("mousedown", { bubbles: true, clientX: 0, clientY: 0 }));
      canvasHost.dispatchEvent(new win.MouseEvent("mousemove", { bubbles: true, clientX: 30, clientY: 20 }));
      canvasHost.dispatchEvent(new win.MouseEvent("mouseup", { bubbles: true }));
    });
    frames();
    check(groupOf().rotation.x > 0.35 && groupOf().rotation.y > pausedY, "3D controls: drag orbit updates only the active cabinet");
    const oldGroup = groupOf();
    const disposedOldModel = watchResources(initialRenderer.scene);
    const scannedBase = { ...base, parts: base.parts.map((p, i) => i === 0 ? { ...p, isScanned: true } : p) };
    await show(scannedBase, "imported", { selectedPartId: doorId });
    check(latest() === initialRenderer && groupOf() !== oldGroup && host.querySelectorAll("canvas").length === 1, "3D lifecycle: a scan update replaces local geometry but preserves the renderer/canvas");
    check(disposedOldModel() && initialRenderer.scene.children.filter((o) => o.isGroup).length === 1, "3D lifecycle: a scan update disposes the old model/grid and leaves one parts group, never a pile of old meshes");
    check(meshesOf()[0].material.color.getHex() === 0x10b981 && meshesOf().find((m) => m.userData.partId === doorId).material.color.getHex() === 0xfbbf24, "3D lifecycle: scan colors and the selected part update within the current cabinet");
    check(groupOf().scale.x > 1 && meshesOf().every((m) => m.material.wireframe) && holesOf().every((h) => !h.visible) && meshesOf().some((m) => m.position.distanceTo(m.userData.basePos) > 10), "3D lifecycle: scan updates preserve this cabinet's zoom, edge, hole and explosion settings");
    await click(button(host, "Reset"));
    frames();
    check(host.querySelector('input[type="range"]').value === "0" && groupOf().scale.x === 1 && near(groupOf().rotation.x, 0.35) && near(groupOf().rotation.y, -0.6), "3D controls: Reset restores assembled placement, rotation and zoom");
    check(meshesOf().every((m) => !m.material.wireframe && m.position.distanceTo(m.userData.basePos) < 0.001) && holesOf().every((h) => h.visible) && button(host, "Rotate"), "3D controls: Reset also restores normal edges/holes and pauses auto-rotation");
    check(boundsFit(groupOf(), latest().camera), "3D controls: Reset refits the actual selected model inside the camera");
    viewport = { width: 220, height: 460 };
    observers[observers.length - 1].callback();
    frames();
    check(near(latest().camera.aspect, 220 / 460) && boundsFit(groupOf(), latest().camera), "3D lifecycle: container resize refits the selected cabinet on a narrow canvas");
    viewport = { width: 0, height: 0 };
    win.dispatchEvent(new win.Event("resize"));
    check(Number.isFinite(latest().camera.aspect) && latest().width > 0 && latest().height > 0, "3D lifecycle: temporarily hidden/zero-sized containers never create an invalid camera");
    viewport = { width: 760, height: 450 };
    win.dispatchEvent(new win.Event("resize"));
    frames();
    const doorPoint = meshesOf().find((m) => m.userData.partId === doorId).getWorldPosition(new THREE.Vector3()).project(latest().camera);
    await act(async () => canvasHost.dispatchEvent(new win.MouseEvent("click", { bubbles: true, clientX: (doorPoint.x + 1) * viewport.width / 2, clientY: (1 - doorPoint.y) * viewport.height / 2 })));
    check(clickedParts.length === 1 && clickedParts[0].id === doorId, "3D picking: the native raycaster selects the current cabinet's door, not a cached cabinet part");
    const disposedBase = watchResources(initialRenderer.scene);
    const baseCameraZ = initialRenderer.camera.position.z;
    await show(tall, "imported", { selectedPartId: base.parts[0].id });
    check(hasCabinet(tall) && meshesOf().length === 5 && holesOf().length === 2 && latest().camera.position.z > baseCameraZ, "3D lifecycle: switching cabinets loads only the tall cabinet's five parts/two borings and its own camera bounds");
    check(initialRenderer.disposals === 1 && initialRenderer.contextLosses === 1 && !initialRenderer.domElement.isConnected && disposedBase(), "3D lifecycle: the previous cabinet's resources/canvas/WebGL context are fully released");
    check(raf.size === 1 && host.querySelectorAll("canvas").length === 1 && host.querySelector('input[type="range"]').value === "0" && groupOf().scale.x === 1 && meshesOf().every((m) => !m.material.wireframe && m.material.color.getHex() !== 0xfbbf24), "3D lifecycle: cabinet switching starts clean controls and cannot retain a foreign selected-part highlight");
    check(host.textContent.includes("Tall 900") && !host.textContent.includes("Floor 600") && host.textContent.includes("900 × 2100 × 380 mm"), "3D lifecycle: the visible cabinet label and envelope change together with the model");
    const tallPoint = meshesOf().find((m) => m.userData.role === "door").getWorldPosition(new THREE.Vector3()).project(latest().camera);
    await act(async () => host.querySelector('[data-testid="cabinet-3d-canvas"]').dispatchEvent(new win.MouseEvent("click", { bubbles: true, clientX: (tallPoint.x + 1) * viewport.width / 2, clientY: (1 - tallPoint.y) * viewport.height / 2 })));
    check(clickedParts.length === 2 && tall.parts.some((p) => p.id === clickedParts[1].id), "3D picking: after switching, click ownership belongs only to the newly selected cabinet");
    await click(button(host, "Rotate"));
    await change(host.querySelector('input[type="range"]'), 0.7);
    await wheel(host);
    const otherTall = { ...tall, name: "Other tall model", height: 1500, parts: tall.parts.map((p) => ({ ...p, length: p.length / 2, cixData: undefined })) };
    const previousTallRenderer = latest();
    await show(otherTall, "another-project");
    check(latest() !== previousTallRenderer && hasCabinet(otherTall) && holesOf().length === 0 && host.textContent.includes("Other tall model"), "3D lifecycle: another project with the SAME cabinet/part IDs still mounts its own model and CNC data");
    check(groupOf().scale.x === 1 && host.querySelector('input[type="range"]').value === "0" && near(groupOf().rotation.y, -0.6) && button(host, "Rotate"), "3D lifecycle: project identity also resets previous explosion, zoom and rotation state");
    await show(empty);
    check(meshesOf().length === 0 && holesOf().length === 0 && host.textContent.includes("No imported parts in this cabinet.") && !host.textContent.includes("Other tall model"), "3D lifecycle: an empty selected cabinet shows an empty preview, never the previous cabinet");
    await show(base);
    const currentCanvas = latest().domElement;
    await act(async () => currentCanvas.dispatchEvent(new win.Event("webglcontextlost", { cancelable: true })));
    check(host.textContent.includes("3D rendering stopped") && hasCabinet(base), "3D lifecycle: a lost GPU context reports an error without substituting another model");
    await act(async () => currentCanvas.dispatchEvent(new win.Event("webglcontextrestored")));
    check(!host.textContent.includes("3D rendering stopped"), "3D lifecycle: GPU context recovery clears the error for the current cabinet");
    await act(async () => root.unmount());
    check(raf.size === 0 && host.querySelectorAll("canvas").length === 0 && observers.every((o) => o.disconnected), "3D lifecycle: unmount cancels every animation loop, removes the canvas and disconnects resize observers");
    const strict = mountRoot();
    const beforeStrict = renderers.length;
    await act(async () => strict.root.render(React.createElement(React.StrictMode, null, React.createElement(Cabinet3DViewer, { cabinet: base }))));
    frames();
    check(renderers.length === beforeStrict + 2 && renderers[beforeStrict].disposals === 1 && strict.host.querySelectorAll("canvas").length === 1 && raf.size === 1 && hasCabinet(base), "3D lifecycle: React Strict Mode's setup/cleanup replay leaves one correct model/canvas/loop");
    await act(async () => strict.root.unmount());
    const unavailable = mountRoot();
    failRenderer = true;
    await act(async () => unavailable.root.render(React.createElement(Cabinet3DViewer, { cabinet: tall })));
    check(unavailable.host.textContent.includes("3D is unavailable") && unavailable.host.querySelectorAll("canvas").length === 0 && raf.size === 0 && expectedErrors.length === 1, "3D lifecycle: unavailable WebGL shows an honest error, not a stale cabinet canvas");
    failRenderer = false;
    await act(async () => unavailable.root.unmount());

    // The real AssemblyView import/selection path, including reused cabinet IDs
    // across two projects. Fetch returns fixtures produced by the real parser.
    const otherProject = { id: "other-project", name: "Existing different project", importedAt: "2026-10-12T08:00:00Z", sourceFiles: { cixFiles: [] }, cabinets: cabinets.map((cab, i) => ({
      ...cab, name: i === 0 ? "Other base model" : "Other tall model", height: cab.height / 2,
      parts: cab.parts.map((p) => ({ ...p, name: "Existing " + p.name, length: p.length / 2, cixData: undefined })),
    })) };
    let savedImport;
    const requests = [];
    setGlobal("fetch", async (url, options = {}) => {
      const method = options.method || "GET";
      const body = options.body ? JSON.parse(options.body) : undefined;
      requests.push({ url, method, body });
      const response = (data) => ({ ok: true, json: async () => data });
      if (url === "/api/orders") return response([]);
      if (url === "/api/assembly" && method === "GET") return response({ projects: [otherProject] });
      if (url === "/api/assembly" && method === "POST") {
        const parsed = polyboard.parsePolyboardCsv(body.csvContent, { layout: body.csvLayout });
        const importedCabinets = Array.from(parsed.cabinetsMap.values());
        const cix = polyboard.matchCixToParts(importedCabinets, body.cixFiles);
        savedImport = { id: "new-import", name: parsed.projectName, importedAt: "2026-10-12T09:00:00Z", sourceFiles: { csvName: body.csvFilename, cixFiles: body.cixFiles.map((f) => f.filename) }, cabinets: importedCabinets };
        return response({ project: savedImport, diagnostics: { csv: parsed.diagnostics, cix, warnings: [] } });
      }
      if (url === "/api/assembly/scan" && method === "POST") {
        savedImport = { ...savedImport, cabinets: savedImport.cabinets.map((cab) => cab.id === body.cabinetId ? { ...cab, parts: cab.parts.map((p) => p.id === body.partId ? { ...p, isScanned: !p.isScanned } : p) } : cab) };
        return response({ success: true, project: savedImport });
      }
      throw new Error("Unexpected test request: " + method + " " + url);
    });
    const app = mountRoot();
    await act(async () => app.root.render(React.createElement(AssemblyView, { currentUser: { role: "Manager", name: "Test Manager" } })));
    frames();
    check(hasCabinet(otherProject.cabinets[0]) && app.host.querySelector('[data-testid="cabinet-3d-viewer"]').textContent.includes("Other base model"), "3D assembly integration: initial project selection resolves its own cabinet object");
    await change(app.host.querySelector('input[type="range"]'), 0.8);
    await wheel(app.host);
    await click(button(app.host, "Rotate"));
    const existingRenderer = latest();
    await click(button(app.host, "Import Polyboard Project"));
    const upload = async (input, files) => {
      const before = fileReads.length;
      Object.defineProperty(input, "files", { value: files, configurable: true });
      await act(async () => {
        input.dispatchEvent(new win.Event("change", { bubbles: true }));
        await Promise.all(fileReads.slice(before));
      });
    };
    await upload(app.host.querySelector('input[accept=".csv,.txt"]'), [new win.File([csv], "selected-cabinets.csv", { type: "text/csv" })]);
    await upload(app.host.querySelector('input[accept=".cix,.cid,.txt"]'), cixFiles.map((f) => new win.File([f.content], f.filename, { type: "text/plain" })));
    await click(button(app.host, "Start Import"));
    frames();
    const importRequest = requests.find((r) => r.method === "POST" && r.url === "/api/assembly");
    check(importRequest?.body.csvContent === csv && importRequest.body.csvLayout === "woodtek" && importRequest.body.cixFiles.length === 2 && savedImport.name === "Selected cabinet test", "3D assembly integration: real file inputs/import action send the intended CSV and CNC files with the owner mapping");
    check(hasCabinet(savedImport.cabinets[0]) && latest() !== existingRenderer && existingRenderer.disposals === 1 && app.host.querySelectorAll("canvas").length === 1, "3D assembly integration: finishing import replaces the old project's preview even when the first cabinet ID is reused");
    check(app.host.querySelector('input[type="range"]').value === "0" && groupOf().scale.x === 1 && near(groupOf().rotation.y, -0.6) && button(app.host, "Rotate"), "3D assembly integration: a newly imported project starts an assembled, freshly framed view");
    const partRows = Array.from(app.host.querySelectorAll('button[title="Mark as scanned"]')).map((b) => b.closest("div.cursor-pointer"));
    const beforePartSelection = latest();
    const beforeMaterials = meshesOf().map((m) => m.material);
    await click(partRows[3]);
    check(latest() === beforePartSelection && meshesOf().find((m) => m.userData.partId === doorId).material.color.getHex() === 0xfbbf24 && meshesOf().every((m, i) => m.material === beforeMaterials[i]), "3D assembly integration: part-list selection highlights the correct current mesh without allocating new materials or contexts");
    await click(app.host.querySelector('button[title="Mark as scanned"]'));
    frames();
    const scanRequest = requests.find((r) => r.url === "/api/assembly/scan");
    check(scanRequest.body.projectId === savedImport.id && scanRequest.body.cabinetId === base.id && latest() === beforePartSelection && meshesOf()[0].material.color.getHex() === 0x10b981, "3D assembly integration: scanning targets the selected project/cabinet and refreshes its colors without changing the canvas");
    await change(app.host.querySelector('input[type="range"]'), 0.7);
    await wheel(app.host);
    await click(button(app.host, "Rotate"));
    const importedRenderer = latest();
    await change(app.host.querySelector('select[aria-label="Loaded assembly project"]'), otherProject.id);
    frames();
    check(hasCabinet(otherProject.cabinets[0]) && latest() !== importedRenderer && importedRenderer.disposals === 1 && holesOf().length === 0 && groupOf().scale.x === 1 && app.host.querySelector('input[type="range"]').value === "0", "3D assembly integration: switching projects with identical cabinet IDs discards the previous model, CNC data and view state");
    await change(app.host.querySelector('select[aria-label="Loaded assembly project"]'), savedImport.id);
    frames();
    const cabinetButton = (name) => {
      const node = Array.from(app.host.querySelectorAll("button")).find((b) => b.textContent.includes(name) && b.textContent.includes("parts"));
      if (!node) throw new Error("Cabinet button not found: " + name);
      return node;
    };
    const smallerRenderer = latest();
    await change(app.host.querySelector('input[type="range"]'), 0.75);
    await wheel(app.host);
    await click(cabinetButton("Tall 900"));
    frames();
    const viewer = app.host.querySelector('[data-testid="cabinet-3d-viewer"]');
    check(hasCabinet(savedImport.cabinets[1]) && holesOf().length === 2 && viewer.textContent.includes("Tall 900") && viewer.textContent.includes("900 × 2100 × 380 mm") && !viewer.textContent.includes("Floor 600"), "3D assembly integration: clicking a cabinet after import loads that cabinet's model, borings, label and dimensions together");
    check(latest() !== smallerRenderer && smallerRenderer.disposals === 1 && groupOf().scale.x === 1 && app.host.querySelector('input[type="range"]').value === "0" && boundsFit(groupOf(), latest().camera), "3D assembly integration: cabinet click discards the previous explosion/zoom and fits the newly selected model");
    const highlighted = meshesOf().filter((m) => m.material.color.getHex() === 0xfbbf24);
    check(highlighted.length === 1 && highlighted[0].userData.partId === savedImport.cabinets[1].parts[0].id, "3D assembly integration: cabinet click also selects/highlights its own first part, never the old cabinet's selection");
    for (let i = 0; i < 8; i++) {
      await click(cabinetButton(i % 2 === 0 ? "Floor 600" : "Tall 900"));
      frames();
    }
    check(hasCabinet(savedImport.cabinets[1]) && app.host.querySelectorAll("canvas").length === 1 && raf.size === 1 && renderers.filter((r) => !r.disposals).length === 1, "3D assembly integration: repeated cabinet switches leave only one live selected model/canvas/animation loop");
    await act(async () => app.root.unmount());
    check(raf.size === 0 && renderers.every((r) => r.disposals === 1 && r.contextLosses === 1) && observers.every((o) => o.disconnected), "3D assembly integration: every old renderer/context/resize observer is released when leaving the module");
    check(unexpectedErrors.length === 0, "3D assembly integration: real React lifecycle/events complete without unexpected console errors");
  } finally {
    failRenderer = false;
    for (const root of roots) await act(async () => root.unmount());
    hosts.forEach((host) => host.remove());
    console.error = originalError;
    dom.window.close();
    for (const [name, descriptor] of globals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  }
};
