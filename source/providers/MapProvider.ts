

/**
 * A map provider is a object that handles the access to map tiles of a specific service.
 *
 * They contain the access configuration and are responsible for handling the map theme size etc.
 *
 * MapProvider should be used as a base for all the providers.
 */
export abstract class MapProvider 
{
	/**
	 * Maximum number of resolved tile images kept in memory.
	 */
	public tileCacheMaxSize: number = 512;

	/**
	 * If true resolved tile images are shared through a small LRU cache.
	 */
	public tileCacheEnabled: boolean = true;

	private tileCache: Map<string, any> = new Map<string, any>();

	private pendingTileRequests: Map<string, {promise: Promise<any>; controller: AbortController; consumers: number}> = new Map<string, {promise: Promise<any>; controller: AbortController; consumers: number}>();

	/**
	 * Name of the map provider
	 */
	public name: string = '';

	/**
	 * Minimum tile level.
	 */
	public minZoom: number = 0;

	/**
	 * Maximum tile level.
	 */
	public maxZoom: number = 20;

	/**
	 * Map bounds.
	 */
	public bounds: number[] = [];

	/**
	 * Map center point.
	 */
	public center: number[] = [];

	/**
	 * Get a tile for the x, y, zoom based on the provider configuration.
	 *
	 * The tile should be returned as a image object, compatible with canvas context 2D drawImage() and with webgl texImage2D() method.
	 *
	 * @param zoom - Zoom level.
	 * @param x - Tile x.
	 * @param y - Tile y.
	 * @returns Promise with the image obtained for the tile ready to use.
	 */
	public fetchTile(zoom: number, x: number, y: number, signal?: AbortSignal): Promise<any> 
	{
		return Promise.reject(new Error('MapProvider.fetchTile() must be implemented by subclasses.'));
	}

	/**
	 * Get a tile image using the provider level LRU cache.
	 *
	 * In-flight requests are shared by tile coordinate and are aborted only after all consumers abort.
	 */
	public fetchCachedTile(zoom: number, x: number, y: number, signal?: AbortSignal): Promise<any>
	{
		if (!this.tileCacheEnabled || this.tileCacheMaxSize <= 0)
		{
			return this.fetchTile(zoom, x, y, signal);
		}

		const key = this.createTileCacheKey(zoom, x, y);
		const cachedTile = this.tileCache.get(key);
		if (cachedTile !== undefined)
		{
			this.tileCache.delete(key);
			this.tileCache.set(key, cachedTile);
			return signal?.aborted ? Promise.reject(this.createAbortError()) : Promise.resolve(cachedTile);
		}

		let pending = this.pendingTileRequests.get(key);
		if (pending === undefined)
		{
			const controller = new AbortController();
			const promise = this.fetchTile(zoom, x, y, controller.signal)
				.then((tile) =>
				{
					this.pendingTileRequests.delete(key);
					this.setCachedTile(key, tile);
					return tile;
				})
				.catch((error) =>
				{
					this.pendingTileRequests.delete(key);
					throw error;
				});

			pending = {promise, controller, consumers: 0};
			this.pendingTileRequests.set(key, pending);
			promise.catch(() => undefined);
		}

		return this.consumePendingTile(key, pending, signal);
	}

	/**
	 * Empty all resolved and in-flight cached tile requests.
	 */
	public clearTileCache(): void
	{
		this.tileCache.clear();
		this.pendingTileRequests.forEach((request) => request.controller.abort());
		this.pendingTileRequests.clear();
	}

	/**
	 * Load an image element with optional abort support.
	 */
	protected loadImage(source: string, signal?: AbortSignal, crossOrigin: string = 'Anonymous'): Promise<HTMLImageElement>
	{
		return new Promise<HTMLImageElement>((resolve, reject) =>
		{
			if (signal?.aborted)
			{
				reject(this.createAbortError());
				return;
			}

			const image = document.createElement('img');

			const cleanup = (): void =>
			{
				image.onload = null;
				image.onerror = null;
				signal?.removeEventListener('abort', abort);
			};

			const abort = (): void =>
			{
				cleanup();
				image.src = '';
				reject(this.createAbortError());
			};

			image.onload = (): void =>
			{
				cleanup();
				resolve(image);
			};

			image.onerror = (): void =>
			{
				cleanup();
				reject(new Error('Failed to load tile image: ' + source));
			};

			image.crossOrigin = crossOrigin;
			signal?.addEventListener('abort', abort, {once: true});
			image.src = source;
		});
	}

	protected createTileCacheKey(zoom: number, x: number, y: number): string
	{
		return `${zoom}/${x}/${y}`;
	}

	protected createAbortError(): Error
	{
		if (typeof DOMException !== 'undefined')
		{
			return new DOMException('Tile request aborted.', 'AbortError');
		}

		const error = new Error('Tile request aborted.');
		error.name = 'AbortError';
		return error;
	}

	private consumePendingTile(key: string, pending: {promise: Promise<any>; controller: AbortController; consumers: number}, signal?: AbortSignal): Promise<any>
	{
		if (signal?.aborted)
		{
			return Promise.reject(this.createAbortError());
		}

		pending.consumers++;

		return new Promise((resolve, reject) =>
		{
			let settled = false;

			const release = (): void =>
			{
				if (settled)
				{
					return;
				}

				settled = true;
				signal?.removeEventListener('abort', abort);
				pending.consumers = Math.max(0, pending.consumers - 1);

				if (pending.consumers === 0 && this.pendingTileRequests.get(key) === pending)
				{
					pending.controller.abort();
				}
			};

			const abort = (): void =>
			{
				release();
				reject(this.createAbortError());
			};

			signal?.addEventListener('abort', abort, {once: true});

			pending.promise.then((tile) =>
			{
				if (settled)
				{
					return;
				}

				release();
				resolve(tile);
			}, (error) =>
			{
				if (settled)
				{
					return;
				}

				release();
				reject(error);
			});
		});
	}

	private setCachedTile(key: string, tile: any): void
	{
		this.tileCache.delete(key);
		this.tileCache.set(key, tile);

		while (this.tileCache.size > this.tileCacheMaxSize)
		{
			const oldestKey = this.tileCache.keys().next().value;
			this.tileCache.delete(oldestKey);
		}
	}

	/**
	 * Get map meta data from server if supported.
	 *
	 * Usually map server have API method to retrieve TileJSON metadata.
	 */
	public async getMetaData(): Promise<void> {}
}
