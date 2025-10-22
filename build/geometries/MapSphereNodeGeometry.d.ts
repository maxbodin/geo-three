import { BufferGeometry } from 'three';
export declare class MapSphereNodeGeometry extends BufferGeometry {
    private static readonly WEB_MERCATOR_RADIUS;
    constructor(radius: number, widthSegments: number, heightSegments: number, zoom: number, tileX: number, tileY: number);
}
