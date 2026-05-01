import {LODControl} from './LODControl';
import {Camera, Object3D, Vector3, WebGLRenderer} from 'three';
import {MapView} from '../MapView';

// Reusable vectors to avoid per-frame allocations during LOD evaluation.
const pov = new Vector3();
const position = new Vector3();
const scale = new Vector3();

/**
 * If a tile's XZ scale exceeds its Y scale by this ratio, it is treated as a
 * planar (flat map) tile rather than a spherical one. This changes the distance
 * calculation to use axis-aligned bounding-box distance instead of center-to-center.
 */
const PLANAR_SCALE_RATIO = 1000;

/**
 * Distance-based LOD controller for the quad-tree tile hierarchy.
 *
 * Each frame, every tile node's distance to the camera is computed and compared
 * against two thresholds:
 * - `subdivideDistance` - tiles closer than this are split into 4 children (higher detail).
 * - `simplifyDistance` - tiles farther than this are merged back into their parent (lower detail).
 *
 * Distance is scaled by `2^(maxZoom - nodeLevel)` so that deeper (smaller) tiles
 * are effectively compared at the same metric as shallower (larger) ones, producing
 * uniform detail across zoom levels.
 *
 * For planar (flat-map) tiles the distance is measured from the camera to the
 * nearest point on the tile's axis-aligned bounding box, giving more accurate
 * results than a simple center-to-center distance for large rectangular tiles.
 */
export class LODRadial implements LODControl 
{
	/**
	 * Tiles closer than this distance (after zoom-level scaling) are subdivided
	 * into four children to increase detail.
	 */
	public subdivideDistance: number;

	/**
	 * Tiles farther than this distance (after zoom-level scaling) are simplified,
	 * the parent node merges its children back to reduce draw calls and memory.
	 * Should be significantly larger than `subdivideDistance` to create hysteresis
	 * and prevent rapid subdivide/simplify oscillation at the boundary.
	 */
	public simplifyDistance: number;

	public constructor(subdivideDistance: number = 50, simplifyDistance: number = 300) 
	{
		this.subdivideDistance = subdivideDistance;
		this.simplifyDistance = simplifyDistance;
	}

	/**
	 * Called once per frame by the renderer. Evaluates every tile in the quad-tree
	 * and triggers subdivide/simplify as needed.
	 */
	public updateLOD(view: MapView, camera: Camera, renderer: WebGLRenderer, scene: Object3D): void
	{
		const root = view.children[0];
		if (root === undefined)
		{
			return;
		}

		// Cache the camera world position for reuse in distanceToNode().
		camera.getWorldPosition(pov);

		// Snapshot all nodes into a flat array before mutating the tree.
		// traverse() would visit newly-created children or skip removed ones
		// if the tree were modified during iteration.
		const nodes: Object3D[] = [];
		root.traverse((node: any) =>
		{
			nodes.push(node);
		});

		for (let i = 0; i < nodes.length; i++)
		{
			const node = nodes[i] as any;
			let distance = this.distanceToNode(node);

			// Scale distance by the remaining zoom headroom so that a deep tile
			// (small on screen) is compared at an equivalent metric to a shallow
			// tile (large on screen). Without this, only the shallowest tiles
			// near the camera would ever subdivide.
			const zoomDelta = Math.max(view.provider.maxZoom - node.level, 0);
			distance /= Math.pow(2, zoomDelta);

			if (distance < this.subdivideDistance) 
			{
				node.subdivide();
			}
			else if (distance > this.simplifyDistance && node.parentNode) 
			{
				// Simplify is called on the parent, which merges all its children.
				node.parentNode.simplify();
			}
		}
	}

	/**
	 * Computes the distance from the camera (`pov`) to a tile node.
	 *
	 * For planar tiles (detected via `isPlanarTileScale`), the distance is
	 * measured to the nearest point on the tile's axis-aligned bounding box.
	 * This prevents large flat tiles from being simplified too aggressively
	 * when the camera is near their edge but far from their center.
	 *
	 * For spherical tiles, a simple center-to-center distance suffices because
	 * tiles are roughly equidistant from the camera at the same zoom level.
	 */
	private distanceToNode(node: Object3D): number
	{
		node.getWorldPosition(position);
		node.getWorldScale(scale);

		if (this.isPlanarTileScale(scale))
		{
			// Compute the signed distance from the camera to the tile's AABB
			// on each axis, clamped to 0 when the camera is inside the bounds.
			const halfWidth = Math.abs(scale.x) * 0.5;
			const halfDepth = Math.abs(scale.z) * 0.5;
			const dx = Math.max(Math.abs(pov.x - position.x) - halfWidth, 0);
			const dy = Math.abs(pov.y - position.y);
			const dz = Math.max(Math.abs(pov.z - position.z) - halfDepth, 0);

			return Math.sqrt(dx * dx + dy * dy + dz * dz);
		}

		// Spherical tiles: center-to-center Euclidean distance.
		return pov.distanceTo(position);
	}

	/**
	 * Heuristic to distinguish planar (flat-map) tiles from spherical tiles.
	 *
	 * Planar tiles are very wide/deep relative to their height (Y scale ≈ 1),
	 * so the X/Y and Z/Y ratios exceed `PLANAR_SCALE_RATIO`. Spherical tiles
	 * have roughly equal scales on all axes.
	 */
	private isPlanarTileScale(nodeScale: Vector3): boolean
	{
		const yScale = Math.max(Math.abs(nodeScale.y), 1);
		return Math.abs(nodeScale.x) / yScale > PLANAR_SCALE_RATIO && Math.abs(nodeScale.z) / yScale > PLANAR_SCALE_RATIO;
	}
}
