import * as THREE from "three";
import type { PolyboardCabinet } from "./polyboard";
import type { CabinetLayout, PartPlacement } from "./polyboardParts";

/** A fresh, cabinet-local model. No mesh/CNC data is shared with other cabinets. */
export function createCabinetScene(cabinet: PolyboardCabinet, layout: CabinetLayout) {
  const group = new THREE.Group();
  group.userData.cabinetId = cabinet.id;
  const meshes = new Map<string, THREE.Mesh>();
  const holes: THREE.Object3D[] = [];
  buildCabinetMeshes(cabinet, layout, group, meshes, holes);
  return { group, meshes, holes };
}

/** Dispose mesh/edge/grid resources, including materials shared by hole markers. */
export function disposeSceneResources(root: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  root.traverse((object) => {
    const drawable = object as THREE.Mesh;
    if (drawable.geometry) geometries.add(drawable.geometry);
    const material = drawable.material;
    if (Array.isArray(material)) material.forEach((item) => materials.add(item));
    else if (material) materials.add(material);
  });
  geometries.forEach((geometry) => geometry.dispose());
  materials.forEach((material) => material.dispose());
}

/**
 * Fit actual transformed panels (not just metadata), even on a narrow canvas.
 * Frame at default scale so resize/scan updates do not cancel the user's zoom.
 */
export function fitCabinetCamera(
  camera: THREE.PerspectiveCamera,
  group: THREE.Group,
  envelope: Pick<CabinetLayout, "width" | "height" | "depth">,
) {
  const scale = group.scale.clone();
  group.scale.setScalar(1);
  const bounds = new THREE.Box3().setFromObject(group);
  group.scale.copy(scale);
  group.updateMatrixWorld(true);
  if (bounds.isEmpty()) {
    bounds.setFromCenterAndSize(
      new THREE.Vector3(),
      new THREE.Vector3(envelope.width, envelope.height, envelope.depth),
    );
  }
  const center = bounds.getCenter(new THREE.Vector3());
  const radius = Math.max(bounds.getSize(new THREE.Vector3()).length() / 2, 50) * 1.1;
  const verticalHalfFov = THREE.MathUtils.degToRad(camera.fov) / 2;
  const halfFov = Math.atan(Math.tan(verticalHalfFov) * Math.min(camera.aspect, 1));
  const distance = radius / Math.sin(halfFov);
  camera.position.set(center.x, center.y + radius * 0.15, center.z + distance);
  camera.lookAt(center);
  camera.near = Math.max(0.1, distance / 1000);
  camera.far = distance + radius * 10;
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
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
      cabinetId: cabinet.id,
      partName: part.name,
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

export function updateCabinetMaterials(
  selectedPartId: string | null | undefined,
  meshesMap: Map<string, THREE.Mesh>,
  wireframe: boolean,
  highlightScanned: boolean = true,
) {
  meshesMap.forEach((mesh, partId) => {
    const material = mesh.material as THREE.MeshStandardMaterial;
    const color = partId === selectedPartId ? 0xfbbf24
      : highlightScanned && mesh.userData.isScanned ? 0x10b981 : 0x64748b;
    material.color.setHex(color);
    if (material.wireframe !== wireframe) {
      material.wireframe = wireframe;
      material.needsUpdate = true;
    }
  });
}

export function applyExplosion(layout: CabinetLayout, explosionFactor: number, meshesMap: Map<string, THREE.Mesh>) {
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
