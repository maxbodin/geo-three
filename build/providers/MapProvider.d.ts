export declare abstract class MapProvider {
    tileCacheMaxSize: number;
    tileCacheEnabled: boolean;
    private tileCache;
    private pendingTileRequests;
    name: string;
    minZoom: number;
    maxZoom: number;
    bounds: number[];
    center: number[];
    fetchTile(zoom: number, x: number, y: number, signal?: AbortSignal): Promise<any>;
    fetchCachedTile(zoom: number, x: number, y: number, signal?: AbortSignal): Promise<any>;
    clearTileCache(): void;
    protected loadImage(source: string, signal?: AbortSignal, crossOrigin?: string): Promise<HTMLImageElement>;
    protected createTileCacheKey(zoom: number, x: number, y: number): string;
    protected createAbortError(): Error;
    private consumePendingTile;
    private setCachedTile;
    getMetaData(): Promise<void>;
}
