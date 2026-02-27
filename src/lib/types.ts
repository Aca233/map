export type MapMode = 'political' | 'state' | 'terrain' | 'heightmap';

export interface MapAssetManifest {
  heightmap: string;
  provinces: string;
  rivers: string;
  terrainColormap: string;
  waterColormap: string;
  cityLights: string;
  provincesJson: string;
  statesJson: string;
}

export interface MapProvinceInfo {
  id: number;
  name: string;
  owner: string;
  type: 'land' | 'sea' | 'lake';
  terrain: string;
  population: number;
  color: [number, number, number];
  isCoastal: boolean;
  continent: number;
  stateName?: string;
  stateId?: number;
  strategicRegionId?: number;
  strategicRegionName?: string;
}

export interface MapStateInfo {
  id: number;
  name: string;
  localName: string;
  owner: string;
  provinces: number[];
  manpower: number;
  category: string;
  victoryPoints: Record<number, number>;
  cores: string[];
}

export interface MapStrategicRegionInfo {
  id: number;
  name: string;
  localName: string;
  provinces: number[];
  navalTerrain: string | null;
  isSeaRegion: boolean;
}

export interface MapInteractionPayload {
  province: MapProvinceInfo;
  state: MapStateInfo | null;
  strategicRegion: MapStrategicRegionInfo | null;
}

export interface CreateMapOptions {
  container: HTMLElement;
  assets: MapAssetManifest;
  assetBaseUrl?: string;
  initialMapMode?: MapMode;
  onHover?: (payload: MapInteractionPayload | null) => void;
  onSelect?: (payload: MapInteractionPayload | null) => void;
  onError?: (error: unknown) => void;
  backgroundColor?: number;
  antialias?: boolean;
}

export interface MapInstance {
  setMapMode(mode: MapMode): void;
  dispose(): void;
}
