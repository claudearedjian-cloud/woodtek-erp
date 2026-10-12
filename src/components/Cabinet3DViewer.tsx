"use client";

import React, { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import type { PolyboardCabinet, PolyboardPart } from "@/lib/polyboard";
import { buildCabinetLayout, type CabinetLayout } from "@/lib/polyboardParts";
import {
  applyExplosion,
  createCabinetScene,
  disposeSceneResources,
  fitCabinetCamera,
  updateCabinetMaterials,
} from "@/lib/cabinetScene";

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
  const [viewerError, setViewerError] = useState<string | null>(null);
  const autorotateRef = useRef(false);

  // References for three.js rendering loop & cleanup
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const meshesRef = useRef<Map<string, THREE.Mesh>>(new Map());
  const holesRef = useRef<THREE.Object3D[]>([]);
  const layoutRef = useRef<CabinetLayout | null>(null);
  const partsGroupRef = useRef<THREE.Group | null>(null);
  const disposeModelRef = useRef<(() => void) | null>(null);

  // Rotation controls state
  const isDraggingRef = useRef(false);
  const prevMousePosRef = useRef({ x: 0, y: 0 });
  const rotationRef = useRef({ x: 0.35, y: -0.6 });
  const zoomRef = useRef(1.0);

  // Layout is recomputed for each cabinet (sizes + placement of every part)
  const layout = React.useMemo(() => buildCabinetLayout(cabinet), [cabinet]);

  // The animation loop must read the current toggle, not its mount-time value.
  useEffect(() => {
    autorotateRef.current = autorotate;
  }, [autorotate]);

  // One renderer per mounted viewer. AssemblyView keys this component by BOTH
  // project and cabinet ID, so changing selection starts a clean view/context.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const width = container.clientWidth || 600;
    const height = container.clientHeight || 450;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch (error) {
      console.error("Unable to start the cabinet 3D renderer", error);
      setViewerError("3D is unavailable. Enable hardware acceleration and reload the page.");
      return;
    }
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = false;
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#090d16");
    scene.add(new THREE.AmbientLight(0xffffff, 1.1));
    const keyLight = new THREE.DirectionalLight(0xffffff, 1.6);
    keyLight.position.set(2, 3, 2);
    const backLight = new THREE.DirectionalLight(0x93c5fd, 0.8);
    backLight.position.set(-2, -1, -1);
    const fillLight = new THREE.DirectionalLight(0xfef3c7, 0.5);
    fillLight.position.set(1, -0.5, 2);
    scene.add(keyLight, backLight, fillLight);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100000);
    cameraRef.current = camera;
    let animId = 0;
    let disposed = false;
    const animate = () => {
      if (disposed) return;
      animId = requestAnimationFrame(animate);
      const group = partsGroupRef.current;
      if (group) {
        if (autorotateRef.current) rotationRef.current.y += 0.005;
        group.rotation.x = rotationRef.current.x;
        group.rotation.y = rotationRef.current.y;
        group.scale.setScalar(zoomRef.current);
      }
      renderer.render(scene, camera);
    };
    animate();

    const handleResize = () => {
      const w = container.clientWidth || 600;
      const h = container.clientHeight || 450;
      camera.aspect = w / h;
      renderer.setSize(w, h);
      if (partsGroupRef.current && layoutRef.current) {
        fitCabinetCamera(camera, partsGroupRef.current, layoutRef.current);
      } else {
        camera.updateProjectionMatrix();
      }
    };
    window.addEventListener("resize", handleResize);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(handleResize);
    observer?.observe(container);
    const handleContextLost = (event: Event) => {
      event.preventDefault();
      setViewerError("3D rendering stopped. Reload the page if the graphics context does not recover.");
    };
    const handleContextRestored = () => setViewerError(null);
    renderer.domElement.addEventListener("webglcontextlost", handleContextLost);
    renderer.domElement.addEventListener("webglcontextrestored", handleContextRestored);

    return () => {
      disposed = true;
      cancelAnimationFrame(animId);
      window.removeEventListener("resize", handleResize);
      observer?.disconnect();
      renderer.domElement.removeEventListener("webglcontextlost", handleContextLost);
      renderer.domElement.removeEventListener("webglcontextrestored", handleContextRestored);
      disposeModelRef.current?.();
      scene.clear();
      renderer.dispose();
      renderer.forceContextLoss();
      if (container.contains(renderer.domElement)) container.removeChild(renderer.domElement);
      rendererRef.current = null;
      sceneRef.current = null;
      cameraRef.current = null;
    };
  }, []);

  // Rebuild only cabinet-local geometry on an import/scan update, never reuse
  // another cabinet's meshes or recreate a WebGL renderer for each scan.
  useEffect(() => {
    const scene = sceneRef.current;
    const camera = cameraRef.current;
    if (!scene || !camera) return;
    const { group, meshes, holes } = createCabinetScene(cabinet, layout);
    partsGroupRef.current = group;
    meshesRef.current = meshes;
    holesRef.current = holes;
    layoutRef.current = layout;
    group.rotation.set(rotationRef.current.x, rotationRef.current.y, 0);
    group.scale.setScalar(zoomRef.current);
    scene.add(group);
    const grid = new THREE.GridHelper(Math.max(layout.width, layout.height, layout.depth) * 2.5, 20, 0x334155, 0x1e293b);
    grid.position.y = -layout.height / 2 - 20;
    scene.add(grid);
    fitCabinetCamera(camera, group, layout);

    let disposed = false;
    const dispose = () => {
      if (disposed) return;
      disposed = true;
      scene.remove(group, grid);
      disposeSceneResources(group);
      disposeSceneResources(grid);
      meshes.clear();
      holes.length = 0;
      if (partsGroupRef.current === group) {
        partsGroupRef.current = null;
        layoutRef.current = null;
      }
      if (disposeModelRef.current === dispose) disposeModelRef.current = null;
    };
    disposeModelRef.current = dispose;
    return dispose;
  }, [cabinet, layout]);

  useEffect(() => {
    applyExplosion(layout, explosion, meshesRef.current);
    if (cameraRef.current && partsGroupRef.current) {
      fitCabinetCamera(cameraRef.current, partsGroupRef.current, layout);
    }
  }, [explosion, layout]);

  useEffect(() => {
    updateCabinetMaterials(selectedPartId, meshesRef.current, wireframe, highlightScanned);
  }, [selectedPartId, wireframe, highlightScanned, layout]);

  useEffect(() => {
    holesRef.current.forEach((object) => { object.visible = showDrillHoles; });
  }, [showDrillHoles, layout]);

  const handleResetView = () => {
    rotationRef.current = { x: 0.35, y: -0.6 };
    zoomRef.current = 1;
    autorotateRef.current = false;
    setAutorotate(false);
    setExplosion(0);
    setWireframe(false);
    setShowDrillHoles(true);
    const group = partsGroupRef.current;
    const camera = cameraRef.current;
    if (group && camera) {
      group.rotation.set(0.35, -0.6, 0);
      group.scale.setScalar(1);
      applyExplosion(layout, 0, meshesRef.current);
      fitCabinetCamera(camera, group, layout);
    }
  };

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
    if (!rect.width || !rect.height) return;
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
    <div
      className="relative flex flex-col h-full w-full rounded-2xl overflow-hidden border border-slate-800 bg-slate-950/80 shadow-2xl"
      data-testid="cabinet-3d-viewer"
      data-cabinet-id={cabinet.id}
    >
      {/* 3D Canvas Container */}
      <div
        ref={containerRef}
        data-testid="cabinet-3d-canvas"
        role="img"
        aria-label={`3D assembly preview of ${cabinet.name}`}
        className="w-full h-[400px] sm:h-[460px] cursor-grab active:cursor-grabbing select-none"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onWheel={handleWheel}
        onClick={handleClick}
      />

      {(viewerError || cabinet.parts.length === 0) && (
        <div role="status" className="absolute top-40 left-6 right-6 text-center text-sm text-slate-300 pointer-events-none">
          {viewerError || "No imported parts in this cabinet."}
        </div>
      )}

      {/* Floating 3D Toolbar & Controls */}
      <div className="absolute top-3 left-3 right-3 flex flex-wrap items-center justify-between gap-2 pointer-events-none">
        <div className="pointer-events-auto flex flex-wrap items-center gap-2 bg-slate-900/90 backdrop-blur-md px-3 py-1.5 rounded-xl border border-slate-700/60 shadow-lg text-xs">
          <span className="font-bold text-white flex items-center gap-1.5" title={`Selected cabinet: ${cabinet.name} (${cabinet.id})`}>
            <span className="w-2.5 h-2.5 shrink-0 rounded-full bg-emerald-500" />
            <span className="max-w-[180px] truncate">{cabinet.name}</span>
            <span className="text-slate-400 font-normal">3D</span>
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
            onClick={handleResetView}
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
            aria-label="Exploded view"
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
      <p className="px-3 py-2 text-[11px] text-slate-400 border-t border-slate-800/80">
        Reconstructed from this cabinet’s imported parts. Placement is estimated where design coordinates are unavailable.
      </p>
    </div>
  );
}
