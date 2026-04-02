
/**
 * Minimal PNG decoder that parses raw PNG bytes into RGBA ImageData without using canvas.
 * 
 * This is used to bypass the canvas fingerprinting protection in Firefox Enhanced Tracking Protection
 * (Private Browsing / Strict mode), which adds noise to canvas.getImageData() calls and breaks
 * Mapbox Terrain-RGB height tile decoding.
 *
 * Only supports 8-bit RGB (color type 2) and RGBA (color type 6) PNGs without interlacing,
 * which covers all Mapbox Terrain-RGB tiles.
 */
export class PNGDecoder
{
	/**
	 * PNG file signature bytes.
	 */
	private static readonly SIGNATURE: number[] = [137, 80, 78, 71, 13, 10, 26, 10];

	/**
	 * Decode a PNG ArrayBuffer into an ImageData object containing RGBA pixels.
	 *
	 * Uses the browser-native DecompressionStream API for zlib decompression, so no
	 * additional dependencies are required.
	 *
	 * @param buffer - ArrayBuffer containing the raw PNG file bytes.
	 * @returns Promise resolving to ImageData (RGBA, 8-bit per channel).
	 */
	public static async decode(buffer: ArrayBuffer): Promise<ImageData>
	{
		const view = new DataView(buffer);
		const bytes = new Uint8Array(buffer);

		// Verify PNG signature
		for (let i = 0; i < 8; i++)
		{
			if (bytes[i] !== PNGDecoder.SIGNATURE[i])
			{
				throw new Error('PNGDecoder: Invalid PNG signature.');
			}
		}

		let width = 0;
		let height = 0;
		let bitDepth = 0;
		let colorType = 0;
		const idatChunks: Uint8Array[] = [];

		let offset = 8;
		while (offset < buffer.byteLength)
		{
			const length = view.getUint32(offset);
			const type = String.fromCharCode(
				bytes[offset + 4],
				bytes[offset + 5],
				bytes[offset + 6],
				bytes[offset + 7]
			);

			if (type === 'IHDR')
			{
				width = view.getUint32(offset + 8);
				height = view.getUint32(offset + 12);
				bitDepth = bytes[offset + 16];
				colorType = bytes[offset + 17];
			}
			else if (type === 'IDAT')
			{
				idatChunks.push(new Uint8Array(buffer, offset + 8, length));
			}
			else if (type === 'IEND')
			{
				break;
			}

			// Each chunk: 4 bytes length + 4 bytes type + length bytes data + 4 bytes CRC
			offset += 12 + length;
		}

		if (bitDepth !== 8)
		{
			throw new Error('PNGDecoder: Only 8-bit PNG images are supported.');
		}

		// Determine input channels based on PNG color type
		let channels: number;
		if (colorType === 2)
		{
			channels = 3; // RGB
		}
		else if (colorType === 6)
		{
			channels = 4; // RGBA
		}
		else
		{
			throw new Error('PNGDecoder: Only RGB (type 2) and RGBA (type 6) PNG images are supported.');
		}

		// Concatenate all IDAT chunks
		const totalLength = idatChunks.reduce((sum, chunk) => {return sum + chunk.length;}, 0);
		const compressedData = new Uint8Array(totalLength);
		let pos = 0;
		for (const chunk of idatChunks)
		{
			compressedData.set(chunk, pos);
			pos += chunk.length;
		}

		// Decompress PNG data (zlib/deflate format)
		const decompressed = await PNGDecoder.decompress(compressedData);

		// Reconstruct filtered rows and convert to RGBA
		return PNGDecoder.reconstruct(decompressed, width, height, channels);
	}

	/**
	 * Decompress zlib-compressed data using the browser-native DecompressionStream API.
	 *
	 * @param data - Compressed data bytes (zlib format as used in PNG IDAT chunks).
	 * @returns Promise resolving to decompressed bytes.
	 */
	private static async decompress(data: Uint8Array): Promise<Uint8Array>
	{
		// @ts-ignore - DecompressionStream is available in modern browsers
		const ds = new DecompressionStream('deflate');
		const writer = ds.writable.getWriter();
		const reader = ds.readable.getReader();

		writer.write(data);
		writer.close();

		const chunks: Uint8Array[] = [];
		let done = false;
		while (!done)
		{
			const result = await reader.read();
			done = result.done;
			if (!done)
			{
				chunks.push(result.value);
			}
		}

		const totalLength = chunks.reduce((sum, chunk) => {return sum + chunk.length;}, 0);
		const result = new Uint8Array(totalLength);
		let pos = 0;
		for (const chunk of chunks)
		{
			result.set(chunk, pos);
			pos += chunk.length;
		}

		return result;
	}

	/**
	 * Apply PNG filter reconstruction to the raw decompressed scanline data and
	 * output a width*height RGBA Uint8ClampedArray wrapped in an ImageData.
	 *
	 * @param data - Decompressed PNG data (filter byte + pixel bytes per scanline).
	 * @param width - Image width in pixels.
	 * @param height - Image height in pixels.
	 * @param channels - Number of input channels (3 for RGB, 4 for RGBA).
	 * @returns ImageData with RGBA pixels.
	 */
	private static reconstruct(data: Uint8Array, width: number, height: number, channels: number): ImageData
	{
		const bytesPerRow = width * channels;
		const stride = bytesPerRow + 1; // +1 for the per-row filter byte
		const output = new Uint8ClampedArray(width * height * 4);

		const prevRow = new Uint8Array(bytesPerRow);
		const currRow = new Uint8Array(bytesPerRow);

		for (let y = 0; y < height; y++)
		{
			const filterType = data[y * stride];
			const rowStart = y * stride + 1;

			// Apply PNG filter to reconstruct the original pixel values
			for (let x = 0; x < bytesPerRow; x++)
			{
				const raw = data[rowStart + x];
				const a = x >= channels ? currRow[x - channels] : 0; // left pixel, same channel
				const b = y > 0 ? prevRow[x] : 0; // pixel above, same channel
				const c = x >= channels && y > 0 ? prevRow[x - channels] : 0; // above-left

				let value: number;
				switch (filterType)
				{
				case 0: value = raw; break; // None
				case 1: value = raw + a & 0xFF; break; // Sub
				case 2: value = raw + b & 0xFF; break; // Up
				case 3: value = raw + Math.floor((a + b) / 2) & 0xFF; break; // Average
				case 4: value = raw + PNGDecoder.paeth(a, b, c) & 0xFF; break; // Paeth
				default: value = raw; break;
				}
				currRow[x] = value;
			}

			// Convert to RGBA output (adding alpha=255 for RGB images)
			const dstBase = y * width * 4;
			for (let x = 0; x < width; x++)
			{
				const srcIdx = x * channels;
				const dstIdx = dstBase + x * 4;
				output[dstIdx + 0] = currRow[srcIdx + 0]; // R
				output[dstIdx + 1] = currRow[srcIdx + 1]; // G
				output[dstIdx + 2] = currRow[srcIdx + 2]; // B
				output[dstIdx + 3] = channels === 4 ? currRow[srcIdx + 3] : 255; // A
			}

			prevRow.set(currRow);
		}

		return new ImageData(output, width, height);
	}

	/**
	 * Paeth predictor function used by PNG filter type 4.
	 *
	 * @param a - Left byte value.
	 * @param b - Above byte value.
	 * @param c - Above-left byte value.
	 * @returns Predictor value.
	 */
	private static paeth(a: number, b: number, c: number): number
	{
		const p = a + b - c;
		const pa = Math.abs(p - a);
		const pb = Math.abs(p - b);
		const pc = Math.abs(p - c);
		if (pa <= pb && pa <= pc)
		{
			return a;
		}
		if (pb <= pc)
		{
			return b;
		}
		return c;
	}

	/**
	 * Scale ImageData to a new size using nearest-neighbor interpolation.
	 * 
	 * Used to resize a decoded tile (e.g. 256×256) to the geometry grid size
	 * (e.g. 17×17) without going through a canvas.
	 *
	 * @param src - Source ImageData.
	 * @param dstWidth - Destination width in pixels.
	 * @param dstHeight - Destination height in pixels.
	 * @returns New ImageData scaled to the requested dimensions.
	 */
	public static scaleImageData(src: ImageData, dstWidth: number, dstHeight: number): ImageData
	{
		const srcData = src.data;
		const srcWidth = src.width;
		const srcHeight = src.height;
		const dst = new Uint8ClampedArray(dstWidth * dstHeight * 4);

		const xScale = srcWidth / dstWidth;
		const yScale = srcHeight / dstHeight;

		for (let y = 0; y < dstHeight; y++)
		{
			const srcY = Math.floor(y * yScale);
			for (let x = 0; x < dstWidth; x++)
			{
				const srcX = Math.floor(x * xScale);
				const srcIdx = (srcY * srcWidth + srcX) * 4;
				const dstIdx = (y * dstWidth + x) * 4;
				dst[dstIdx + 0] = srcData[srcIdx + 0];
				dst[dstIdx + 1] = srcData[srcIdx + 1];
				dst[dstIdx + 2] = srcData[srcIdx + 2];
				dst[dstIdx + 3] = srcData[srcIdx + 3];
			}
		}

		return new ImageData(dst, dstWidth, dstHeight);
	}
}
