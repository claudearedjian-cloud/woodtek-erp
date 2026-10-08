"use client";

import React, { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import type { PolyboardCabinet, PolyboardPart } from "@/lib/polyboard";
import { buildCabinetLayout, type CabinetLayout, type PartPlacement } from "@/lib/polyboardParts";

interface Cabinet3DViewerProps {
  cabinet: PolyboardCabinet;
  selectedPartId?: string | null;
  onSelectPart?: (part: PolyboardPart) => void;
  highlightScanned?: boolean;
}

export default function Cabinet3DViewer({
  cabinet,
  selectedPartId,
  onSelectPart,
  highlightScanned = true,
}: Cabinet3DViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [explosion, setExplosion] = useState<number>(0); // 0 = assembled, 1 = exploded view
  const [wireframe, setWireframe] = useState<boolean>(false);
  const [showDrillHoles, setShowDrillHoles] = useState<boolean>(true);
  const [autorotate, setAutorotate] = useState<boolean>(false);

  // References for three.js rendering loop & cleanup
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const meshesRef = useRef<Map<string, THREE.Mesh>>(new Map());
  const holesRef = useRef<THREE.Object3D[]>([]);
  const layoutRef = useRef<CabinetLayout | null>(null);
  const partsGroupRef = useRef<THREE.Group | null>(null);

  // Rotation controls state
  const isDraggingRef = useRef(false);
  const prevMousePosRef = useRef({ x: 0, y: 0 });
  const rotationRef = useRef({ x: 0.35, y: -0.6 });
  const zoomRef = useRef(1.0);

  // Layout is recomputed for each cabinet (sizes + placement of every part)
  const layout = React.useMemo(() => buildCabinetLayout(cabinet), [cabinet]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Dimensions
    const width = container.clientWidth || 600;
    const height = container.clientHeight || 450;

    const cabW = layout.width;
    const cabH = layout.height;
    const cabD = layout.depth;
    const maxDim = Math.max(cabW, cabH, cabD, 100);

    // 1. Scene
    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#090d16");
    sceneRef.current = scene;

    // 2. Camera — framed from the real assembly bounds
    const radius = 0.6 * Math.sqrt(cabW * cabW + cabH * cabH + cabD * cabD);
    const fov = 45;
    const distance = (radius / Math.sin((fov * Math.PI) / 360)) * 1.05;
    const camera = new THREE.PerspectiveCamera(fov, width / height, 1, distance * 6);
    camera.position.set(0, maxDim * 0.55, distance);
    camera.lookAt(0, 0, 0);
    cameraRef.current = camera;

    // 3. Lights
    const ambientLight = new THREE.AmbientLight(0xffffff, 1.1);
    scene.add(ambientLight);

    const dirLight1 = new THREE.DirectionalLight(0xffffff, 1.6);
    dirLight1.position.set(maxDim * 2, maxDim * 3, maxDim * 2);
    scene.add(dirLight1);

    const dirLight2 = new THREE.DirectionalLight(0x93c5fd, 0.8);
    dirLight2.position.set(-maxDim * 2, -maxDim, -maxDim);
    scene.add(dirLight2);

    const fillLight = new THREE.DirectionalLight(0xfef3c7, 0.5);
    fillLight.position.set(maxDim, -maxDim * 0.5, maxDim * 2);
    scene.add(fillLight);

    // Grid Floor
    const gridHelper = new THREE.GridHelper(maxDim * 2.5, 20, 0x334155, 0x1e293b);
    gridHelper.position.y = -cabH / 2 - 20;
    scene.add(gridHelper);

    // 4. Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = false;
    container.innerHTML = "";
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // 5. Build the parts group (holes are children of their own part mesh)
    const partsGroup = new THREE.Group();
    partsGroupRef.current = partsGroup;
    scene.add(partsGroup);

    meshesRef.current = new Map();
    buildCabinetMeshes(cabinet, layout, partsGroup, meshesRef.current, holesRef.current);
    layoutRef.current = layout;
    applyExplosion(layout, explosion, meshesRef.current);
    updateMaterials(selectedPartId, meshesRef.current, wireframe);

    // 6. Animation loop
    let animId: number;
    const animate = () => {
      animId = requestAnimationFrame(animate);

      if (autorotate) {
        rotationRef.current.y += 0.005;
      }

      partsGroup.rotation.x = rotationRef.current.x;
      partsGroup.rotation.y = rotationRef.current.y;
      partsGroup.scale.setScalar(zoomRef.current);

      renderer.render(scene, camera);
    };
    animate();

    // Resize handler
    const handleResize = () => {
      if (!container || !renderer || !camera) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener("resize", handleResize);

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener("resize", handleResize);
      renderer.dispose();
      partsGroup.traverse((object) => {
        const mesh = object as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
        const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(material)) material.forEach((m) => m.dispose());
        else material?.dispose();
      });
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cabinet, layout]);

  // Update exploded view positions when slider changes
  useEffect(() => {
    if (!layoutRef.current) return;
    applyExplosion(layoutRef.current, explosion, meshesRef.current);
  }, [explosion, layout]);

  // Update materials when selectedPartId or isScanned changes
  useEffect(() => {
    updateMaterials(selectedPartId, meshesRef.current, wireframe);
  }, [selectedPartId, cabinet, wireframe, layout]);

  // Toggle drill holes visibility
  useEffect(() => {
    holesRef.current.forEach((object) => {
      object.visible = showDrillHoles;
    });
  }, [showDrillHoles, layout]);

  // Mouse / Touch Interaction for Orbiting & Zooming
  const handleMouseDown = (e: React.MouseEvent) => {
    isDraggingRef.current = true;
    prevMousePosRef.current = { x: e.clientX, y: e.clientY };
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDraggingRef.current) return;
    const deltaX = e.clientX - prevMousePosRef.current.x;
    const deltaY = e.clientY - prevMousePosRef.current.y;
    prevMousePosRef.current = { x: e.clientX, y: e.clientY };

    rotationRef.current.y += deltaX * 0.008;
    rotationRef.current.x += deltaY * 0.008;
    // Clamp X rotation to prevent flipping upside down
    rotationRef.current.x = Math.max(-Math.PI / 2.2, Math.min(Math.PI / 2.2, rotationRef.current.x));
  };

  const handleMouseUp = () => {
    isDraggingRef.current = false;
  };

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.08 : 0.92;
    zoomRef.current = Math.max(0.3, Math.min(3.0, zoomRef.current * factor));
  };

  // Raycasting for clicking parts directly in 3D
  const handleClick = (e: React.MouseEvent) => {
    if (!containerRef.current || !cameraRef.current || !sceneRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(new THREE.Vector2(x, y), cameraRef.current);

    const meshes = Array.from(meshesRef.current.values());
    const intersects = raycaster.intersectObjects(meshes, true);

    if (intersects.length > 0 && onSelectPart) {
      let object: THREE.Object3D | null = intersects[0].object;
      while (object && !object.userData.partId) object = object.parent;
      const partId = object?.userData.partId;
      const part = cabinet.parts.find((p) => p.id === partId);
      if (part) {
        onSelectPart(part);
      }
    }
  };

  return (
    <div className="relative flex flex-col h-full w-full rounded-2xl overflow-hidden border border-slate-800 bg-slate-950/80 shadow-2xl">
      {/* 3D Canvas Container */}
      <div
        ref={containerRef}
        className="w-full h-[400px] sm:h-[460px] cursor-grab active:cursor-grabbing select-none"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onWheel={handleWheel}
        onClick={handleClick}
      />

      {/* Floating 3D Toolbar & Controls */}
      <div className="absolute top-3 left-3 right-3 flex flex-wrap items-center justify-between gap-2 pointer-events-none">
        <div className="pointer-events-auto flex items-center gap-2 bg-slate-900/90 backdrop-blur-md px-3 py-1.5 rounded-xl border border-slate-700/60 shadow-lg text-xs">
          <span className="font-bold text-white flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
            3D Assembly Simulator
          </span>
          <span className="text-slate-500">|</span>
          <span className="text-slate-300 font-mono text-[11px]">
            {layout.width} × {layout.height} × {layout.depth} mm
          </span>
          <span className="text-slate-500">|</span>
          <span className="text-slate-400 text-[11px]">
            {cabinet.parts.length} parts
          </span>
        </div>

        <div className="pointer-events-auto flex items-center gap-1.5 bg-slate-900/90 backdrop-blur-md px-2 py-1 rounded-xl border border-slate-700/60 shadow-lg text-xs">
          <button
            onClick={() => setAutorotate(!autorotate)}
            className={`px-2.5 py-1 rounded-lg font-medium transition ${
              autorotate ? "bg-amber-500 text-slate-950 font-bold" : "text-slate-300 hover:bg-slate-800"
            }`}
            title="Auto-rotate 3D model"
          >
            {autorotate ? "Pause" : "Rotate"}
          </button>
          <button
            onClick={() => setWireframe(!wireframe)}
            className={`px-2.5 py-1 rounded-lg font-medium transition ${
              wireframe ? "bg-sky-500 text-white font-bold" : "text-slate-300 hover:bg-slate-800"
            }`}
            title="Toggle Wireframe mode"
          >
            Edges
          </button>
          <button
            onClick={() => setShowDrillHoles(!showDrillHoles)}
            className={`px-2.5 py-1 rounded-lg font-medium transition ${
              showDrillHoles ? "bg-emerald-600 text-white font-bold" : "text-slate-400 hover:bg-slate-800"
            }`}
            title="Toggle CNC Rover A Borings"
          >
            CNC Holes
          </button>
          <button
            onClick={() => {
              rotationRef.current = { x: 0.35, y: -0.6 };
              zoomRef.current = 1.0;
            }}
            className="px-2.5 py-1 rounded-lg font-medium text-slate-300 hover:bg-slate-800 transition"
            title="Reset View"
          >
            Reset
          </button>
        </div>
      </div>

      {/* Exploded View Slider Controls at Bottom */}
      <div className="p-3 bg-slate-900/95 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-3 flex-1 min-w-[200px]">
          <span className="font-semibold text-slate-300 whitespace-nowrap">
            Exploded View:
          </span>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={explosion}
            onChange={(e) => setExplosion(parseFloat(e.target.value))}
            className="w-full accent-amber-500 cursor-pointer h-1.5 bg-slate-700 rounded-lg"
          />
          <span className="font-mono text-amber-400 w-10 text-right">
            {Math.round(explosion * 100)}%
          </span>
        </div>

        {/* Legend */}
        <div className="flex items-center gap-3 text-[11px] text-slate-400">
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded bg-emerald-500 border border-emerald-300" />
            <span>Available / Scanned</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded bg-slate-600 border border-slate-500" />
            <span>Waiting CNC / Unscanned</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded bg-amber-400 border border-amber-200" />
            <span>Selected</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------
// 3D Cabinet Geometry Builder
// Every part is built as a box of its REAL cutting list size, oriented from the
// assembly layout computed in polyboardParts.ts. Parts whose names are not in
// the vocabulary still get their own slot (interior panels), so the model never
// collapses into a single pile on the origin.
// ----------------------------------------------------------------------------

function buildCabinetMeshes(
  cabinet: PolyboardCabinet,
  layout: CabinetLayout,
  partsGroup: THREE.Group,
  meshesMap: Map<string, THREE.Mesh>,
  holeMarkers: THREE.Object3D[],
) {
  meshesMap.clear();
  holeMarkers.length = 0;

  cabinet.parts.forEach((part, index) => {
    const placement: PartPlacement | undefined = layout.placements[index];
    const size = placement?.size || {
      length: part.length > 0 ? part.length : layout.height,
      width: part.width > 0 ? part.width : layout.depth,
      thickness: part.thickness > 0 ? part.thickness : 18,
    };

    const geom = new THREE.BoxGeometry(size.length, size.width, size.thickness);

    // Edges geometry for clean CAD look
    const edgesGeom = new THREE.EdgesGeometry(geom);
    const lineMat = new THREE.LineBasicMaterial({ color: 0x1e293b, linewidth: 1 });
    const wireframeLines = new THREE.LineSegments(edgesGeom, lineMat);

    const mat = createPartMaterial(part.isScanned);
    const mesh = new THREE.Mesh(geom, mat);
    mesh.add(wireframeLines);

    if (placement) {
      mesh.position.set(placement.center.x, placement.center.y, placement.center.z);
      const basis = new THREE.Matrix4().makeBasis(
        new THREE.Vector3(placement.axisX.x, placement.axisX.y, placement.axisX.z),
        new THREE.Vector3(placement.axisY.x, placement.axisY.y, placement.axisY.z),
        new THREE.Vector3(placement.axisZ.x, placement.axisZ.y, placement.axisZ.z),
      );
      mesh.quaternion.setFromRotationMatrix(basis);
    }

    mesh.userData = {
      partId: part.id,
      basePos: mesh.position.clone(),
      explodeDir: placement ? placement.explode : { x: 0, y: 0.5, z: 0.5 },
      size,
      role: placement?.role || "generic",
      isScanned: !!part.isScanned,
    };

    partsGroup.add(mesh);
    meshesMap.set(part.id, mesh);

    // Add CNC Rover A drilling holes onto the 3D part if CIX borings exist
    const borings = part.cixData?.borings || [];
    if (borings.length > 0) {
      const holeMat = new THREE.MeshBasicMaterial({ color: 0x10b981 });
      borings.forEach((b) => {
        const dia = Math.max(2, b.diameter || 5);
        const depth = Math.max(2, b.depth || 12);
        const holeGeom = new THREE.CylinderGeometry(dia / 2, dia / 2, Math.min(depth, size.thickness * 1.5), 12);
        const holeMesh = new THREE.Mesh(holeGeom, holeMat);

        const x = Math.min(Math.max(b.x, 0), size.length) - size.length / 2;
        const y = Math.min(Math.max(b.y, 0), size.width) - size.width / 2;
        const half = size.thickness / 2;

        switch (b.side) {
          case 1: // bottom face
            holeMesh.rotation.x = Math.PI / 2;
            holeMesh.position.set(x, y, -half - 0.6);
            break;
          case 2: // left edge
            holeMesh.rotation.z = Math.PI / 2;
            holeMesh.position.set(-size.length / 2 + Math.min(depth, size.length) / 2, y, 0);
            break;
          case 3: // right edge
            holeMesh.rotation.z = Math.PI / 2;
            holeMesh.position.set(size.length / 2 - Math.min(depth, size.length) / 2, y, 0);
            break;
          case 4: // front edge
            holeMesh.position.set(x, -size.width / 2 + Math.min(depth, size.width) / 2, 0);
            break;
          case 5: // back edge
            holeMesh.position.set(x, size.width / 2 - Math.min(depth, size.width) / 2, 0);
            break;
          default: // top face
            holeMesh.rotation.x = Math.PI / 2;
            holeMesh.position.set(x, y, half + 0.6);
            break;
        }

        mesh.add(holeMesh);
        holeMarkers.push(holeMesh);
      });
    }
  });
}

function createPartMaterial(isScanned?: boolean, isSelected?: boolean, wireframe: boolean = false) {
  let color = 0x64748b; // Unscanned slate-500
  const roughness = 0.6;
  const metalness = 0.1;

  if (isSelected) {
    color = 0xfbbf24; // Amber 400
  } else if (isScanned) {
    color = 0x10b981; // Emerald 500
  }

  return new THREE.MeshStandardMaterial({
    color,
    roughness,
    metalness,
    wireframe,
  });
}

function updateMaterials(
  selectedPartId: string | null | undefined,
  meshesMap: Map<string, THREE.Mesh>,
  wireframe: boolean
) {
  meshesMap.forEach((mesh, partId) => {
    const isSelected = partId === selectedPartId;
    const isScanned = !!mesh.userData.isScanned;
    mesh.material = createPartMaterial(isScanned, isSelected, wireframe);
  });
}

function applyExplosion(layout: CabinetLayout, explosionFactor: number, meshesMap: Map<string, THREE.Mesh>) {
  const explodeDistance = Math.max(layout.width, layout.height, layout.depth) * 0.45;

  meshesMap.forEach((mesh) => {
    const basePos = mesh.userData.basePos as THREE.Vector3 | undefined;
    const explodeDir = mesh.userData.explodeDir as { x: number; y: number; z: number } | undefined;
    if (basePos && explodeDir) {
      mesh.position.x = basePos.x + explodeDir.x * explodeDistance * explosionFactor;
      mesh.position.y = basePos.y + explodeDir.y * explodeDistance * explosionFactor;
      mesh.position.z = basePos.z + explodeDir.z * explodeDistance * explosionFactor;
    }
  });
}
