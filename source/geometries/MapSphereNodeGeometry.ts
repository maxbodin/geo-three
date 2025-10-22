import {BufferGeometry, Float32BufferAttribute, Vector3} from 'three';
import {UnitsUtils} from '../utils/UnitsUtils';

/**
 * Map node geometry is a geometry used to represent the spherical map nodes.
 */
export class MapSphereNodeGeometry extends BufferGeometry
{
        /**
         * Radius used for web mercator conversions in meters.
         */
        private static readonly WEB_MERCATOR_RADIUS: number = UnitsUtils.WEB_MERCATOR_MAX_EXTENT / Math.PI;

        /**
         * Map sphere geometry constructor.
         *
         * @param radius - Radius of the node sphere.
         * @param widthSegments - Number of subdivisions along the width.
         * @param heightSegments - Number of subdivisions along the height.
         * @param zoom - Zoom level of the tile represented by the geometry.
         * @param tileX - Tile column index.
         * @param tileY - Tile row index.
         */
        public constructor(radius: number, widthSegments: number, heightSegments: number, zoom: number, tileX: number, tileY: number)
        {
                super();

                const bounds = UnitsUtils.tileBounds(zoom, tileX, tileY);
                const tileRange = Math.pow(2, zoom);
                const isTopTile = tileY === 0;
                const isBottomTile = tileY === tileRange - 1;

                let index = 0;
                const grid = [];
                const vertex = new Vector3();
                const normal = new Vector3();

                // Buffers
                const indices = [];
                const vertices = [];
                const normals = [];
                const uvs = [];

                for (let iy = 0; iy <= heightSegments; iy++)
                {
                        const verticesRow = [];
                        const v = iy / heightSegments;
                        const mercatorY = bounds[2] + (1 - v) * bounds[3];

                        let latitude: number;
                        if (isTopTile && iy === 0)
                        {
                                latitude = Math.PI / 2;
                        }
                        else if (isBottomTile && iy === heightSegments)
                        {
                                latitude = -Math.PI / 2;
                        }
                        else
                        {
                                latitude = Math.atan(Math.sinh(mercatorY / MapSphereNodeGeometry.WEB_MERCATOR_RADIUS));
                        }

                        const sinLat = Math.sin(latitude);
                        const cosLat = Math.cos(latitude);

                        for (let ix = 0; ix <= widthSegments; ix++)
                        {
                                const u = ix / widthSegments;
                                const mercatorX = bounds[0] + u * bounds[1];
                                const longitude = mercatorX / MapSphereNodeGeometry.WEB_MERCATOR_RADIUS;

                                const sinLon = Math.sin(longitude);
                                const cosLon = Math.cos(longitude);

                                // Vertex
                                vertex.x = radius * cosLon * cosLat;
                                vertex.y = radius * sinLat;
                                vertex.z = -radius * sinLon * cosLat;
                                vertices.push(vertex.x, vertex.y, vertex.z);

                                // Normal
                                normal.set(cosLon * cosLat, sinLat, -sinLon * cosLat).normalize();
                                normals.push(normal.x, normal.y, normal.z);

                                // UV
                                uvs.push(u, 1 - v);
                                verticesRow.push(index++);
                        }

                        grid.push(verticesRow);
                }

                for (let iy = 0; iy < heightSegments; iy++)
                {
                        for (let ix = 0; ix < widthSegments; ix++)
                        {
                                const a = grid[iy][ix + 1];
                                const b = grid[iy][ix];
                                const c = grid[iy + 1][ix];
                                const d = grid[iy + 1][ix + 1];

                                if (!(isTopTile && iy === 0))
                                {
                                        indices.push(a, b, d);
                                }

                                if (!(isBottomTile && iy === heightSegments - 1))
                                {
                                        indices.push(b, c, d);
                                }
                        }
                }

                this.setIndex(indices);
                this.setAttribute('position', new Float32BufferAttribute(vertices, 3));
                this.setAttribute('normal', new Float32BufferAttribute(normals, 3));
                this.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
        }
}
