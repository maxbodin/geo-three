import {LODRaycast} from './LODRaycast';

/**
 * LODRaycast configured for spherical geometry
 */
export class LODRaycastSpherical extends LODRaycast 
{
	public constructor() 
	{
		super();

		this.scaleDistance = false;
		
	}
}
