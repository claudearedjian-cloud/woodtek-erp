// ============================================================================
// Polyboard part classification + 3D assembly layout (pure, framework-free)
// ----------------------------------------------------------------------------
// Polyboard users export in their own interface language and can rename part
// types freely, so parts are recognized from keywords in several languages
// (EN/FR/DE/ES/IT/NL) AND from the part geometry (length/width/thickness vs the
// cabinet envelope). Everything here is pure data-in / data-out so it can be
// unit tested without three.js and shared by the server parser and the viewer.
// ============================================================================

export type PartRole =
  | "side-left"
  | "side-right"
  | "side"
  | "upright"
  | "bottom"
  | "top"
  | "shelf"
  | "back"
  | "rail"
  | "door"
  | "drawer-front"
  | "worktop"
  | "plinth"
  | "generic";

export interface PanelLike {
  id?: string;
  name?: string;
  length?: number;
  width?: number;
  thickness?: number;
}

export interface CabinetLike {
  width?: number;
  height?: number;
  depth?: number;
  parts: PanelLike[];
}

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------

/** Lower-case, strip accents (é -> e), collapse punctuation to single spaces. */
export function normalizeText(input: string | undefined | null): string {
  return (input || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Like normalizeText but with all separators removed (for CSV header keys). */
export function normalizeKey(input: string | undefined | null): string {
  return normalizeText(input).replace(/ /g, "");
}

function wordStartMatcher(word: string): RegExp {
  const escaped = normalizeText(word).replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "\\s+");
  // Match at a word start so "top" never matches "worktop" and "bas" still
  // matches "basse"/"base", which is exactly what shop vocabulary needs.
  return new RegExp(`(^|[^a-z])${escaped}`, "i");
}

/** True when any of the keywords appears at a word start of the text. */
export function matchesAny(normalizedText: string, keywords: string[]): boolean {
  for (const kw of keywords) {
    if (wordStartMatcher(kw).test(normalizedText)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Role vocabulary
// ---------------------------------------------------------------------------

const LEFT_WORDS = ["left", "gauche", "links", "izquierd", "sinistr", "lhs", "lateral b", "joue b"];
const RIGHT_WORDS = ["right", "droit", "droite", "rechts", "derech", "destr", "rhs", "lateral c", "joue c"];

const WORKTOP_WORDS = ["worktop", "work top", "countertop", "counter top", "plan de travail", "plan travail", "arbeitsplatte", "encimera", "piano di lavoro", "blad", "tablette de plan", "top work"];
const PLINTH_WORDS = ["plinth", "plinthe", "sockel", "zocalo", "zoccolo", "kick board", "kickboard", "plint", "socle", "baseboard"];

const DRAWER_WORDS = ["drawer", "drawers", "tiroir", "tiroirs", "schublade", "schubladen", "cajon", "cajones", "cajonera", "cassetto", "cassetti", "lade", "laden", "schub", "front tiroir"];
const DOOR_WORDS = ["door", "doors", "porte", "portes", "tuer", "turin", "turen", "puerta", "puertas", "porta", "porte", "deur", "deuren", "anta", "ante", "battant", "front porte"];

const SHELF_WORDS = ["shelf", "shelves", "tablette", "tablettes", "etagere", "etageres", "regal", "regalboden", "fachboden", "boden", "estante", "balda", "ripiano", "mensola", "plank", "planks", "plateau", "plateaux", "kanal", "legplank"];
const MOVABLE_SHELF_WORDS = ["adjustable", "movable", "mobile", "ajustable", "regelbar", "verstellbar", "regulable", "regolabile", "intermediaire", "zwischenboden", "middle shelf"];

const BACK_WORDS = ["back", "back panel", "fond", "fondo", "arriere", "rueckwand", "ruckwand", "trasero", "trasera", "retro", "achter", "schiena", "dos", "backpanel"];

const BOTTOM_WORDS = ["bottom", "bottom panel", "base", "bas", "basse", "dessous", "soubassement", "suelo", "suelo inferior", "fondo inferior", "unterboden", "bodenplatte", "fond de caisson", "paulownia", "under", "inferior", "onder", " sotto", "pavimento", "floor"];
const TOP_WORDS = ["top", "top panel", "roof", "top rail", "dessus", "haut", "haute", "deckel", "oberboden", "deck", "tapa", "cielo", "techo", "superior", "boven", "sopra", "lid"];

const RAIL_WORDS = ["rail", "rails", "stretcher", "stretchers", "traverse", "traverses", "travers", "traversa", "travesano", "travesanos", "riegel", "zarge", "batten", "battens", "travessa", "cross rail", "crossrail", "lintel", "bar"];

const SIDE_WORDS = ["side", "side panel", "cote", "cotes", "joue", "joues", "panneau", "panneaux", "lateral", "laterale", "lateraux", "seite", "seitenteil", "seitenwand", "zijkant", "zijkantpaneel", "fianco", "fianchi", "costado", "costados", "montant", "montants", "upright", "uprights", "stile", "flanc", "check side", "case side", "carcass side", "sideboard"];

const UPRIGHT_WORDS = ["divider", "division", "separator", "separation", "cloison", "middle", "centre", "center", "trennwand", "mittelseite", "separador", "divisorio", "centrale", "mid panel", "partition", "upright middle"];

/** Classify one part into an assembly role. */
export function classifyPartRole(part: PanelLike, index: number = 0, total: number = 1): PartRole {
  const name = normalizeText(part.name);
  const hasLeft = matchesAny(name, LEFT_WORDS);
  const hasRight = matchesAny(name, RIGHT_WORDS);

  if (!name) return "generic";

  if (matchesAny(name, WORKTOP_WORDS)) return "worktop";
  if (matchesAny(name, PLINTH_WORDS)) return "plinth";
  if (matchesAny(name, DRAWER_WORDS)) return "drawer-front";
  if (matchesAny(name, DOOR_WORDS)) return "door";
  if (matchesAny(name, BACK_WORDS)) return "back";
  if (matchesAny(name, RAIL_WORDS)) return "rail";

  // "Bottom Shelf Deck" is a cabinet bottom, "Adjustable Shelf" is a shelf.
  const movableShelf = matchesAny(name, SHELF_WORDS) && matchesAny(name, MOVABLE_SHELF_WORDS);
  if (!movableShelf && matchesAny(name, BOTTOM_WORDS)) return "bottom";
  if (!movableShelf && matchesAny(name, TOP_WORDS)) return "top";
  if (matchesAny(name, SHELF_WORDS)) return "shelf";

  if (matchesAny(name, SIDE_WORDS) || matchesAny(name, UPRIGHT_WORDS)) {
    if (hasLeft) return "side-left";
    if (hasRight) return "side-right";
    if (matchesAny(name, UPRIGHT_WORDS)) return "upright";
    // Single "side" without a hand: hand it out by position in the list.
    if (total >= 2) return index % 2 === 0 ? "side-left" : "side-right";
    return "side";
  }

  // No keyword matched: keep the part generic here, the layout resolves it
  // from its geometry instead of dropping it at the origin.
  return "generic";
}

/** True when a part belongs to the upright/vertical carcass family. */
export function isVerticalRole(role: PartRole): boolean {
  return role === "side-left" || role === "side-right" || role === "side" || role === "upright" || role === "back";
}

// ---------------------------------------------------------------------------
// Dimension derivation
// ---------------------------------------------------------------------------

const DEFAULT_DIMS = { width: 600, height: 720, depth: 560 };

/**
 * Work out a cabinet's real envelope from its cutting-list parts.
 * Polyboard gives net sizes (e.g. the bottom deck is Width - 2 x thickness),
 * so the carcass panels are used and the outer size is reconstructed.
 */
export function deriveCabinetDimensions(cabinet: CabinetLike): { width: number; height: number; depth: number } {
  const parts = (cabinet.parts || []).filter(Boolean);
  const roles = parts.map((p, i) => classifyPartRole(p, i, parts.length));

  const num = (i: number, field: "length" | "width" | "thickness", fallback = 0) => Number(parts[i][field]) || fallback;

  const verticals: number[] = [];
  const horizontals: number[] = [];
  const rails: number[] = [];
  const doors: number[] = [];
  const others: number[] = [];

  roles.forEach((role, i) => {
    if (role === "side-left" || role === "side-right" || role === "side" || role === "upright") verticals.push(i);
    else if (role === "bottom" || role === "top" || role === "shelf") horizontals.push(i);
    else if (role === "rail") rails.push(i);
    else if (role === "door") doors.push(i);
    else if (role !== "back" && role !== "worktop" && role !== "plinth" && role !== "drawer-front") others.push(i);
  });

  // Carcass panels are net sizes, so the outer width is the internal length of
  // a horizontal panel plus two thicknesses.
  const widthOf = (i: number) => num(i, "length") + num(i, "thickness", 18) * 2;

  let height = Math.max(0, ...verticals.map((i) => num(i, "length")));
  let depth = Math.max(0, ...verticals.map((i) => num(i, "width")), ...horizontals.map((i) => num(i, "width")));
  let width = Math.max(0, ...horizontals.map(widthOf), ...rails.map(widthOf));

  // Doors are the other reliable width/height reference. Two half-width doors
  // side by side (each narrower than it is tall) tell us the full width.
  if (doors.length > 0) {
    const halfWidthDoors = doors.filter((i) => num(i, "width") < num(i, "length") * 0.75);
    const doorWidth = Math.max(...doors.map((i) => num(i, "width")));
    const doorSpan = halfWidthDoors.length > 1 ? Math.max(...halfWidthDoors.map((i) => num(i, "width"))) * halfWidthDoors.length : doorWidth;
    if (doorSpan > width) width = doorSpan;
    if (height <= 0) {
      const tallest = Math.max(...doors.map((i) => num(i, "length")));
      if (tallest > 0) height = tallest;
    }
  }

  // Still unknown (a cabinet exported without carcass parts): use the other
  // parts, then whatever the project file / previous import stored.
  if (height <= 0) {
    const maxLen = Math.max(0, ...parts.map((p) => Number(p.length) || 0));
    height = (cabinet.height && cabinet.height > 0 ? cabinet.height : 0) || maxLen || DEFAULT_DIMS.height;
  }
  if (width <= 0) {
    // On a side panel the "width" is the depth, so only horizontal-ish parts
    // may suggest the cabinet width here - otherwise keep the default.
    const maxLen = Math.max(0, ...others.map((i) => num(i, "length")));
    width = (cabinet.width && cabinet.width > 0 ? cabinet.width : 0) || maxLen || DEFAULT_DIMS.width;
  }
  if (depth <= 0) {
    const maxWid = Math.max(0, ...parts.map((p) => Number(p.width) || 0));
    depth = (cabinet.depth && cabinet.depth > 0 ? cabinet.depth : 0) || maxWid || DEFAULT_DIMS.depth;
  }

  const round = (n: number) => Math.max(1, Math.round(n));
  return { width: round(width), height: round(height), depth: round(depth) };
}

// ---------------------------------------------------------------------------
// 3D layout
// ---------------------------------------------------------------------------

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface PartPlacement {
  role: PartRole;
  /** Net size used for the 3D box, in canonical order length (X) x width (Y) x thickness (Z). */
  size: { length: number; width: number; thickness: number };
  /** World-space centre of the part. */
  center: Vec3;
  /** World-space direction of the part's local X axis (its length). */
  axisX: Vec3;
  /** World-space direction of the part's local Y axis (its width). */
  axisY: Vec3;
  /** World-space direction of the part's local Z axis (its thickness). */
  axisZ: Vec3;
  /** Unit-ish direction used by the exploded view. */
  explode: Vec3;
}

export interface CabinetLayout {
  width: number;
  height: number;
  depth: number;
  placements: PartPlacement[];
  /** Parts whose role came from their geometry rather than their name. */
  geometricRoles: number;
}

const AXIS = {
  x: { x: 1, y: 0, z: 0 },
  y: { x: 0, y: 1, z: 0 },
  z: { x: 0, y: 0, z: 1 },
  negX: { x: -1, y: 0, z: 0 },
  negY: { x: 0, y: -1, z: 0 },
  negZ: { x: 0, y: 0, z: -1 },
};

/**
 * Build a full 3D placement for every part of a cabinet.
 * Parts are laid out from their real cutting-list sizes, so unrecognized part
 * names still produce a sensible, non-overlapping assembly instead of a stack
 * of boxes on the origin.
 */
export function buildCabinetLayout(cabinet: CabinetLike): CabinetLayout {
  const parts = cabinet.parts || [];
  const dims = deriveCabinetDimensions(cabinet);
  const W = dims.width;
  const H = dims.height;
  const D = dims.depth;

  const placements: PartPlacement[] = [];
  let geometricRoles = 0;

  const roles: PartRole[] = parts.map((p, i) => {
    const role = classifyPartRole(p, i, parts.length);
    if (role !== "generic") return role;

    // Geometry fallback: a part whose length is nearly the cabinet height and
    // which is as deep as the carcass is a side; one spanning the width is a
    // horizontal panel; anything else becomes an interior panel.
    const len = Number(p.length) || 0;
    const wid = Number(p.width) || 0;
    if (len > 0 && wid > 0) {
      const tall = Math.abs(len - H) <= Math.max(20, H * 0.06) && wid >= D * 0.6;
      if (tall) {
        geometricRoles++;
        return "upright";
      }
      const flat = Math.abs(len - W) <= Math.max(25, W * 0.08) && wid >= D * 0.5;
      if (flat) {
        geometricRoles++;
        return "shelf";
      }
      if (len > H * 1.4 && wid > H * 1.4) {
        geometricRoles++;
        return "worktop";
      }
    }
    return "generic";
  });

  const verticalPanels: number[] = [];
  const horizontals: number[] = [];
  const shelves: number[] = [];
  const backs: number[] = [];
  const rails: number[] = [];
  const doors: number[] = [];
  const drawerFronts: number[] = [];
  const worktops: number[] = [];
  const plinths: number[] = [];
  const generics: number[] = [];

  roles.forEach((role, i) => {
    switch (role) {
      case "side-left":
      case "side-right":
      case "side":
      case "upright":
        verticalPanels.push(i);
        break;
      case "back":
        backs.push(i);
        break;
      case "bottom":
      case "top":
        horizontals.push(i);
        break;
      case "shelf":
        shelves.push(i);
        break;
      case "rail":
        rails.push(i);
        break;
      case "door":
        doors.push(i);
        break;
      case "drawer-front":
        drawerFronts.push(i);
        break;
      case "worktop":
        worktops.push(i);
        break;
      case "plinth":
        plinths.push(i);
        break;
      default:
        generics.push(i);
        break;
    }
  });

  const panel = (i: number) => {
    const part = parts[i];
    const thickness = Number(part.thickness) > 0 ? Number(part.thickness) : 18;
    const length = Number(part.length) > 0 ? Number(part.length) : H;
    const width = Number(part.width) > 0 ? Number(part.width) : D;
    return {
      length,
      width,
      thickness,
      // A physical panel can never be larger than the cabinet plus a little.
      size: {
        length: Math.min(length, Math.max(W, H, D) * 1.6),
        width: Math.min(width, Math.max(W, H, D) * 1.6),
        thickness: Math.min(thickness, 120),
      },
    };
  };

  const push = (
    index: number,
    role: PartRole,
    size: { length: number; width: number; thickness: number },
    center: Vec3,
    axisX: Vec3,
    axisY: Vec3,
    axisZ: Vec3,
    explode: Vec3,
  ) => {
    placements[index] = { role, size, center, axisX, axisY, axisZ, explode };
  };

  // --- Vertical carcass panels (sides, uprights, dividers) ------------------
  const leftIdx = verticalPanels.filter((i) => roles[i] === "side-left");
  const rightIdx = verticalPanels.filter((i) => roles[i] === "side-right");
  const middleIdx = verticalPanels.filter((i) => roles[i] !== "side-left" && roles[i] !== "side-right");

  const lefts = leftIdx.length > 0 ? leftIdx : middleIdx.splice(0, 1);
  const rights = rightIdx.length > 0 ? rightIdx : middleIdx.slice(-1);

  lefts.forEach((i, k) => {
    const { size } = panel(i);
    push(
      i,
      roles[i],
      size,
      { x: -W / 2 + size.thickness / 2 + k * size.thickness, y: 0, z: 0 },
      AXIS.y,
      AXIS.z,
      AXIS.x,
      { x: -1.2, y: 0, z: 0 },
    );
  });
  rights.forEach((i, k) => {
    const { size } = panel(i);
    push(
      i,
      roles[i],
      size,
      { x: W / 2 - size.thickness / 2 - k * size.thickness, y: 0, z: 0 },
      AXIS.y,
      AXIS.z,
      AXIS.x,
      { x: 1.2, y: 0, z: 0 },
    );
  });
  middleIdx.forEach((i, k) => {
    const { size } = panel(i);
    const x = -W / 2 + (W * (k + 1)) / (middleIdx.length + 1);
    push(i, roles[i], size, { x, y: 0, z: 0 }, AXIS.y, AXIS.z, AXIS.x, { x: 0.4, y: 0, z: 0 });
  });

  // --- Back panel ----------------------------------------------------------
  backs.forEach((i, k) => {
    const { size } = panel(i);
    push(
      i,
      "back",
      size,
      { x: 0, y: 0, z: -D / 2 + size.thickness / 2 - k * (size.thickness + 4) },
      AXIS.y,
      AXIS.negX,
      AXIS.z,
      { x: 0, y: 0, z: -1.5 },
    );
  });

  // --- Bottom / top / shelves ---------------------------------------------
  const bottoms = horizontals.filter((i) => roles[i] === "bottom");
  const topIdx = horizontals.filter((i) => roles[i] === "top");
  const others = horizontals.filter((i) => roles[i] !== "bottom" && roles[i] !== "top");
  const bottomSlots = bottoms.length > 0 ? bottoms : others.splice(0, 1);
  const topSlots = topIdx.length > 0 ? topIdx : others.splice(0, 1);

  bottomSlots.forEach((i, k) => {
    const { size } = panel(i);
    push(
      i,
      roles[i],
      size,
      { x: 0, y: -H / 2 + size.thickness / 2 + k * size.thickness, z: 0 },
      AXIS.x,
      AXIS.negZ,
      AXIS.y,
      { x: 0, y: -1.2, z: 0 },
    );
  });
  topSlots.forEach((i, k) => {
    const { size } = panel(i);
    push(
      i,
      roles[i],
      size,
      { x: 0, y: H / 2 - size.thickness / 2 - k * size.thickness, z: 0 },
      AXIS.x,
      AXIS.negZ,
      AXIS.y,
      { x: 0, y: 1.2, z: 0 },
    );
  });

  const interiorSlots = shelves.length + others.length + generics.length;
  let interiorCount = 0;
  const placeInterior = (i: number) => {
    const { size } = panel(i);
    interiorCount++;
    const usable = Math.max(H - size.thickness * 2, size.thickness * 2);
    const y = -H / 2 + size.thickness + (usable * interiorCount) / (interiorSlots + 1);
    const depthShift = (D - size.width) / 2; // centre deeper parts in the carcass
    push(i, roles[i], size, { x: 0, y, z: Math.max(0, depthShift) * 0.35 }, AXIS.x, AXIS.negZ, AXIS.y, { x: 0, y: 0.4, z: 0.5 });
  };
  shelves.forEach(placeInterior);
  others.forEach(placeInterior);
  generics.forEach(placeInterior);

  // --- Rails / stretchers --------------------------------------------------
  const railsTopDown = rails.slice().sort((a, b) => (Number(parts[b].width) || 0) - (Number(parts[a].width) || 0));
  railsTopDown.forEach((i, k) => {
    const { size } = panel(i);
    const atBottom = matchesAny(normalizeText(parts[i].name), BOTTOM_WORDS);
    const railH = size.width; // on a rail, "width" is its height in polyboard exports
    const y = atBottom ? -H / 2 + railH / 2 : H / 2 - railH / 2;
    const front = k % 2 === 0;
    const z = front ? D / 2 - size.thickness / 2 : -D / 2 + size.thickness / 2;
    push(i, "rail", size, { x: 0, y, z }, AXIS.x, AXIS.y, AXIS.z, { x: 0, y: atBottom ? -0.6 : 0.6, z: front ? 0.8 : -0.8 });
  });

  // --- Doors / drawer fronts (stacked from the top) ------------------------
  const fronts = [...drawerFronts, ...doors];
  const tallDoors = fronts.filter((i) => (Number(parts[i].length) || 0) >= H * 0.55);
  const stacked = fronts.filter((i) => !tallDoors.includes(i));

  let offset = 0;
  stacked.forEach((i) => {
    const { size } = panel(i);
    const y = H / 2 - offset - size.length / 2;
    offset += size.length;
    const isDrawer = roles[i] === "drawer-front";
    push(i, roles[i], size, { x: 0, y, z: D / 2 + size.thickness / 2 }, AXIS.x, AXIS.y, AXIS.z, {
      x: 0,
      y: 0.25,
      z: isDrawer ? 1.4 : 1.5,
    });
  });

  tallDoors.forEach((i, k) => {
    const { size } = panel(i);
    const count = tallDoors.length;
    let x = 0;
    if (count === 2) x = k === 0 ? -W / 4 : W / 4;
    else if (count > 2) x = -W / 2 + (W * (k + 0.5)) / count;
    else if (roles[i] === "side-left") x = -W / 4;
    else if (roles[i] === "side-right") x = W / 4;
    push(i, roles[i], size, { x, y: 0, z: D / 2 + size.thickness / 2 }, AXIS.x, AXIS.y, AXIS.z, { x: x === 0 ? 0 : Math.sign(x) * 0.4, y: 0, z: 1.5 });
  });

  // --- Worktops & plinths --------------------------------------------------
  worktops.forEach((i) => {
    const { size } = panel(i);
    push(i, "worktop", size, { x: 0, y: H / 2 + size.thickness / 2, z: 0 }, AXIS.x, AXIS.negZ, AXIS.y, { x: 0, y: 1.4, z: 0 });
  });
  plinths.forEach((i) => {
    const { size } = panel(i);
    push(i, "plinth", size, { x: 0, y: -H / 2 - size.thickness / 2, z: 0 }, AXIS.x, AXIS.y, AXIS.z, { x: 0, y: -1.4, z: 0 });
  });

  // Safety net: every part must have a placement, never a stack on the origin.
  parts.forEach((part, i) => {
    if (placements[i]) return;
    const { size } = panel(i);
    const y = -H / 2 + size.thickness / 2 + (i % 5) * (size.thickness + 40);
    push(i, roles[i], size, { x: 0, y, z: 0 }, AXIS.x, AXIS.negZ, AXIS.y, { x: 0, y: 0.5, z: 0.5 });
  });

  return { width: W, height: H, depth: D, placements, geometricRoles };
}
