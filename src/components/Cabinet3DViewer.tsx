"use client";

import React, { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import type { PolyboardCabinet, PolyboardPart } from "@/lib/polyboard";

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
  const holesGroupRef = useRef<THREE.Group | null>(null);
  const partsGroupRef = useRef<THREE.Group | null>(null);

  // Rotation controls state
  const isDraggingRef = useRef(false);
  const prevMousePosRef = useRef({ x: 0, y: 0 });
  const rotationRef = useRef({ x: 0.35, y: -0.6 });
  const zoomRef = useRef(1.0);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Dimensions
    const width = container.clientWidth || 600;
    const height = container.clientHeight || 450;

    // 1. Scene
    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#090d16");
    sceneRef.current = scene;

    // 2. Camera
    const maxDim = Math.max(cabinet.width || 600, cabinet.height || 720, cabinet.depth || 560);
    const camera = new THREE.PerspectiveCamera(45, width / height, 10, maxDim * 15);
    camera.position.set(0, maxDim * 0.8, maxDim * 2.2);
    camera.lookAt(0, 0, 0);
    cameraRef.current = camera;

    // 3. Lights
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.9);
    scene.add(ambientLight);

    const dirLight1 = new THREE.DirectionalLight(0xffffff, 1.2);
    dirLight1.position.set(maxDim * 2, maxDim * 3, maxDim * 2);
    scene.add(dirLight1);

    const dirLight2 = new THREE.DirectionalLight(0x93c5fd, 0.6);
    dirLight2.position.set(-maxDim * 2, -maxDim, -maxDim);
    scene.add(dirLight2);

    // Grid Floor
    const gridHelper = new THREE.GridHelper(maxDim * 2.5, 20, 0x334155, 0x1e293b);
    gridHelper.position.y = -(cabinet.height || 720) / 2 - 20;
    scene.add(gridHelper);

    // 4. Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    container.innerHTML = "";
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // 5. Build Parts & Holes Groups
    const partsGroup = new THREE.Group();
    partsGroupRef.current = partsGroup;
    scene.add(partsGroup);

    const holesGroup = new THREE.Group();
    holesGroupRef.current = holesGroup;
    scene.add(holesGroup);

    // Assemble cabinet geometries
    buildCabinetMeshes(cabinet, partsGroup, holesGroup, meshesRef.current);

    // 6. Animation loop
    let animId: number;
    const animate = () => {
      animId = requestAnimationFrame(animate);

      if (autorotate) {
        rotationRef.current.y += 0.005;
      }

      if (partsGroupRef.current && holesGroupRef.current) {
        partsGroupRef.current.rotation.x = rotationRef.current.x;
        partsGroupRef.current.rotation.y = rotationRef.current.y;
        partsGroupRef.current.scale.setScalar(zoomRef.current);

        holesGroupRef.current.rotation.x = rotationRef.current.x;
        holesGroupRef.current.rotation.y = rotationRef.current.y;
        holesGroupRef.current.scale.setScalar(zoomRef.current);
      }

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
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
    };
  }, [cabinet]);

  // Update exploded view positions when slider changes
  useEffect(() => {
    applyExplosion(cabinet, explosion, meshesRef.current);
  }, [explosion, cabinet]);

  // Update materials when selectedPartId or isScanned changes
  useEffect(() => {
    updateMaterials(cabinet, selectedPartId, meshesRef.current, wireframe);
  }, [selectedPartId, cabinet, wireframe]);

  // Toggle drill holes visibility
  useEffect(() => {
    if (holesGroupRef.current) {
      holesGroupRef.current.visible = showDrillHoles;
    }
  }, [showDrillHoles]);

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
    const intersects = raycaster.intersectObjects(meshes);

    if (intersects.length > 0 && onSelectPart) {
      const hitMesh = intersects[0].object as THREE.Mesh;
      const partId = hitMesh.userData.partId;
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
            3D CNC Simulator
          </span>
          <span className="text-slate-500">|</span>
          <span className="text-slate-300 font-mono text-[11px]">
            {cabinet.width} × {cabinet.height} × {cabinet.depth} mm
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
// Positions cabinet parts realistically in 3D based on Polyboard naming & dimensions
// ----------------------------------------------------------------------------

function buildCabinetMeshes(
  cabinet: PolyboardCabinet,
  partsGroup: THREE.Group,
  holesGroup: THREE.Group,
  meshesMap: Map<string, THREE.Mesh>
) {
  meshesMap.clear();

  const cabW = cabinet.width || 600;
  const cabH = cabinet.height || 720;
  const cabD = cabinet.depth || 560;

  cabinet.parts.forEach((part, index) => {
    const partNameLower = part.name.toLowerCase();
    const thk = part.thickness || 18;
    const len = part.length || cabH;
    const wid = part.width || cabD;

    // Default base dimensions & offset
    let size = new THREE.Vector3(wid, len, thk);
    let basePos = new THREE.Vector3(0, 0, 0);
    let explodeDir = new THREE.Vector3(0, 0, 0);

    // Heuristically place cabinet components based on Polyboard nomenclature
    if (partNameLower.includes("left") && (partNameLower.includes("side") || partNameLower.includes("panel"))) {
      // Left vertical side
      size.set(thk, cabH, cabD);
      basePos.set(-cabW / 2 + thk / 2, 0, 0);
      explodeDir.set(-1.2, 0, 0);
    } else if (partNameLower.includes("right") && (partNameLower.includes("side") || partNameLower.includes("panel"))) {
      // Right vertical side
      size.set(thk, cabH, cabD);
      basePos.set(cabW / 2 - thk / 2, 0, 0);
      explodeDir.set(1.2, 0, 0);
    } else if (partNameLower.includes("bottom") || partNameLower.includes("deck") || partNameLower.includes("base")) {
      // Bottom horizontal panel
      size.set(cabW - thk * 2, thk, cabD);
      basePos.set(0, -cabH / 2 + thk / 2, 0);
      explodeDir.set(0, -1.2, 0);
    } else if (partNameLower.includes("top") || partNameLower.includes("roof")) {
      // Top horizontal panel
      size.set(cabW - thk * 2, thk, cabD);
      basePos.set(0, cabH / 2 - thk / 2, 0);
      explodeDir.set(0, 1.2, 0);
    } else if (partNameLower.includes("stretcher") || partNameLower.includes("rail")) {
      // Top stretchers (front or back)
      const isFront = partNameLower.includes("front") || index % 2 === 0;
      size.set(cabW - thk * 2, thk, 100);
      basePos.set(0, cabH / 2 - thk / 2, isFront ? cabD / 2 - 50 : -cabD / 2 + 50);
      explodeDir.set(0, 1.0, isFront ? 0.8 : -0.8);
    } else if (partNameLower.includes("back") || partNameLower.includes("fond")) {
      // Back panel (thin, typically 3mm)
      size.set(cabW - thk * 2, cabH - thk * 2, Math.min(thk, 6));
      basePos.set(0, 0, -cabD / 2 + 10);
      explodeDir.set(0, 0, -1.5);
    } else if (partNameLower.includes("shelf") || partNameLower.includes("etagere")) {
      // Internal adjustable shelf
      size.set(cabW - thk * 2 - 2, thk, cabD - 20);
      basePos.set(0, 0, 0);
      explodeDir.set(0, 0.4, 0.4);
    } else if (partNameLower.includes("door") || partNameLower.includes("porte")) {
      // Front Door panel
      const isDouble = partNameLower.includes("left") || partNameLower.includes("right");
      const doorW = isDouble ? cabW / 2 - 2 : cabW - 4;
      const doorOffset = partNameLower.includes("right") ? cabW / 4 : partNameLower.includes("left") ? -cabW / 4 : 0;
      size.set(doorW, cabH - 4, thk);
      basePos.set(doorOffset, 0, cabD / 2 + thk / 2);
      explodeDir.set(0, 0, 1.5);
    } else if (partNameLower.includes("drawer") || partNameLower.includes("tiroir")) {
      // Drawer front
      size.set(cabW - 4, 180, thk);
      basePos.set(0, -cabH / 4 + index * 40, cabD / 2 + thk / 2);
      explodeDir.set(0, 0, 1.4);
    } else {
      // Generic part fallback
      size.set(Math.min(cabW, wid), Math.min(cabH, len), thk);
      basePos.set(0, 0, 0);
      explodeDir.set(0, 0.5, 0.5);
    }

    // Geometry & Material
    const geom = new THREE.BoxGeometry(size.x, size.y, size.z);
    
    // Edges geometry for clean CAD look
    const edgesGeom = new THREE.EdgesGeometry(geom);
    const lineMat = new THREE.LineBasicMaterial({ color: 0x1e293b, linewidth: 1 });
    const wireframeLines = new THREE.LineSegments(edgesGeom, lineMat);

    const mat = createPartMaterial(part.isScanned);
    const mesh = new THREE.Mesh(geom, mat);
    mesh.add(wireframeLines);

    mesh.position.copy(basePos);
    mesh.userData = {
      partId: part.id,
      basePos: basePos.clone(),
      explodeDir: explodeDir.clone(),
      size: size.clone(),
      isScanned: !!part.isScanned,
    };

    partsGroup.add(mesh);
    meshesMap.set(part.id, mesh);

    // 7. Add CNC Rover A Drilling Holes onto the 3D part if CIX borings exist!
    if (part.cixData && part.cixData.borings && part.cixData.borings.length > 0) {
      const holeMat = new THREE.MeshBasicMaterial({ color: 0x10b981 }); // Glowing emerald drill hole marker
      part.cixData.borings.forEach((b) => {
        const dia = b.diameter || 5;
        const holeGeom = new THREE.CylinderGeometry(dia / 2, dia / 2, b.depth || 12, 12);
        const holeMesh = new THREE.Mesh(holeGeom, holeMat);

        // Position hole relative to part face
        const relX = (b.x / (part.cixData?.length || cabH) - 0.5) * size.x;
        const relY = (b.y / (part.cixData?.width || cabD) - 0.5) * size.y;
        holeMesh.position.set(relX, relY, size.z / 2 + 1);
        holeMesh.rotation.x = Math.PI / 2;

        mesh.add(holeMesh);
      });
    }
  });
}

function createPartMaterial(isScanned?: boolean, isSelected?: boolean, wireframe: boolean = false) {
  let color = 0x64748b; // Unscanned slate-500
  let roughness = 0.6;
  let metalness = 0.1;

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
  cabinet: PolyboardCabinet,
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

function applyExplosion(
  cabinet: PolyboardCabinet,
  explosionFactor: number,
  meshesMap: Map<string, THREE.Mesh>
) {
  const explodeDistance = (cabinet.width || 600) * 0.45;

  meshesMap.forEach((mesh) => {
    const basePos = mesh.userData.basePos as THREE.Vector3;
    const explodeDir = mesh.userData.explodeDir as THREE.Vector3;
    if (basePos && explodeDir) {
      mesh.position.x = basePos.x + explodeDir.x * explodeDistance * explosionFactor;
      mesh.position.y = basePos.y + explodeDir.y * explodeDistance * explosionFactor;
      mesh.position.z = basePos.z + explodeDir.z * explodeDistance * explosionFactor;
    }
  });
}
