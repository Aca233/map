import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { ProvinceStore, ProvinceData, StateData, StrategicRegionData } from '../data/ProvinceStore';
import { ProvincePicker } from '../interaction/ProvincePicker';
import { TerrainManager } from '../terrain/TerrainManager';
import type {
  CreateMapOptions,
  MapInstance,
  MapInteractionPayload,
  MapMode,
  MapProvinceInfo,
  MapStateInfo,
  MapStrategicRegionInfo,
} from './types';

const MAP_WORLD_WIDTH = 440;
const MAP_WORLD_HEIGHT = 160;
const HEIGHT_SCALE = 3.7;

const MAP_MODE_TO_INDEX: Record<MapMode, number> = {
  political: 0,
  terrain: 1,
  heightmap: 2,
  state: 3,
};

type ResolvedAssets = {
  heightmap: string;
  provinces: string;
  rivers: string;
  terrainColormap: string;
  waterColormap: string;
  cityLights: string;
  provincesJson: string;
  statesJson: string;
};

function resolveAssetUrl(path: string, assetBaseUrl?: string): string {
  if (/^(https?:)?\/\//i.test(path) || path.startsWith('/') || path.startsWith('data:')) {
    return path;
  }

  if (assetBaseUrl) {
    const base = assetBaseUrl.endsWith('/') ? assetBaseUrl : `${assetBaseUrl}/`;
    return new URL(path, base).toString();
  }

  return path;
}

function resolveAssets(options: CreateMapOptions): ResolvedAssets {
  const base = options.assetBaseUrl;
  return {
    heightmap: resolveAssetUrl(options.assets.heightmap, base),
    provinces: resolveAssetUrl(options.assets.provinces, base),
    rivers: resolveAssetUrl(options.assets.rivers, base),
    terrainColormap: resolveAssetUrl(options.assets.terrainColormap, base),
    waterColormap: resolveAssetUrl(options.assets.waterColormap, base),
    cityLights: resolveAssetUrl(options.assets.cityLights, base),
    provincesJson: resolveAssetUrl(options.assets.provincesJson, base),
    statesJson: resolveAssetUrl(options.assets.statesJson, base),
  };
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image);
    image.onerror = (error) => reject(new Error(`[Map] 图片加载失败: ${url} (${String(error)})`));
    image.src = url;
  });
}

function imageToCanvas(image: HTMLImageElement): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    throw new Error('[Map] 无法创建 2D Canvas 上下文');
  }
  ctx.drawImage(image, 0, 0);
  return canvas;
}

function setupCanvasTexture(
  canvas: HTMLCanvasElement,
  setup: (texture: THREE.CanvasTexture) => void
): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(canvas);
  texture.flipY = false;
  setup(texture);
  texture.needsUpdate = true;
  return texture;
}

function disposeMaterial(material: THREE.Material): void {
  const materialAsRecord = material as unknown as Record<string, unknown>;
  for (const value of Object.values(materialAsRecord)) {
    if (value instanceof THREE.Texture) {
      value.dispose();
    }
  }
  material.dispose();
}

function toProvinceInfo(province: ProvinceData): MapProvinceInfo {
  return {
    id: province.id,
    name: province.name,
    owner: province.owner,
    type: province.type,
    terrain: province.terrain,
    population: province.population,
    color: [...province.color] as [number, number, number],
    isCoastal: province.isCoastal,
    continent: province.continent,
    stateName: province.stateName,
    stateId: province.stateId,
    strategicRegionId: province.strategicRegionId,
    strategicRegionName: province.strategicRegionName,
  };
}

function toStateInfo(state: StateData): MapStateInfo {
  return {
    id: state.id,
    name: state.name,
    localName: state.localName,
    owner: state.owner,
    provinces: [...state.provinces],
    manpower: state.manpower,
    category: state.category,
    victoryPoints: { ...state.victoryPoints },
    cores: [...state.cores],
  };
}

function toStrategicRegionInfo(region: StrategicRegionData): MapStrategicRegionInfo {
  return {
    id: region.id,
    name: region.name,
    localName: region.localName,
    provinces: [...region.provinces],
    navalTerrain: region.navalTerrain,
    isSeaRegion: region.isSeaRegion,
  };
}

function toInteractionPayload(
  province: ProvinceData,
  state: StateData | null,
  region: StrategicRegionData | null
): MapInteractionPayload {
  return {
    province: toProvinceInfo(province),
    state: state ? toStateInfo(state) : null,
    strategicRegion: region ? toStrategicRegionInfo(region) : null,
  };
}

export async function createMap(options: CreateMapOptions): Promise<MapInstance> {
  if (!options?.container) {
    throw new Error('[Map] createMap 需要有效的 container');
  }

  const resolvedAssets = resolveAssets(options);
  const sceneTextures: THREE.Texture[] = [];

  try {
    const store = new ProvinceStore();
    await store.loadFromHOI4Data({
      provincesUrl: resolvedAssets.provincesJson,
      statesUrl: resolvedAssets.statesJson,
    });

    const [heightmapImg, provincesImg, riversImg, terrainColormapImg, waterColormapImg, cityLightsImg] = await Promise.all([
      loadImage(resolvedAssets.heightmap),
      loadImage(resolvedAssets.provinces),
      loadImage(resolvedAssets.rivers),
      loadImage(resolvedAssets.terrainColormap),
      loadImage(resolvedAssets.waterColormap),
      loadImage(resolvedAssets.cityLights),
    ]);

    const heightmapCanvas = imageToCanvas(heightmapImg);
    const provinceMapCanvas = imageToCanvas(provincesImg);
    const riversCanvas = imageToCanvas(riversImg);
    const terrainColormapCanvas = imageToCanvas(terrainColormapImg);
    const waterColormapCanvas = imageToCanvas(waterColormapImg);
    const cityLightsCanvas = imageToCanvas(cityLightsImg);

    const countryLutCanvas = store.generateCountryLUT(provinceMapCanvas);
    const stateLutCanvas = store.generateStateLUT(provinceMapCanvas);
    const strategicRegionLutCanvas = store.generateStrategicRegionLUT(provinceMapCanvas);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(options.backgroundColor ?? 0x0a0a1e);

    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 2000);
    camera.position.set(0, 180, 180);
    camera.lookAt(0, 0, 0);

    const renderer = new THREE.WebGLRenderer({
      antialias: options.antialias ?? true,
      powerPreference: 'high-performance',
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.35));

    options.container.appendChild(renderer.domElement);

    const resize = () => {
      const width = Math.max(1, options.container.clientWidth);
      const height = Math.max(1, options.container.clientHeight);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
    };
    resize();

    window.addEventListener('resize', resize);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.screenSpacePanning = true;
    controls.minDistance = 5;
    controls.maxDistance = 700;
    controls.minPolarAngle = 0.1;
    controls.maxPolarAngle = Math.PI / 2.2;
    controls.target.set(0, 0, 0);

    scene.add(new THREE.AmbientLight(0x404060, 0.5));
    const dirLight = new THREE.DirectionalLight(0xffeedd, 0.8);
    dirLight.position.set(50, 100, 30);
    scene.add(dirLight);

    const terrainManager = new TerrainManager(scene, MAP_WORLD_WIDTH, MAP_WORLD_HEIGHT, HEIGHT_SCALE);
    const maxAnisotropy = renderer.capabilities.getMaxAnisotropy();

    const heightmapTexture = setupCanvasTexture(heightmapCanvas, (texture) => {
      texture.wrapS = THREE.ClampToEdgeWrapping;
      texture.wrapT = THREE.ClampToEdgeWrapping;
      texture.minFilter = THREE.LinearFilter;
      texture.magFilter = THREE.LinearFilter;
    });

    const provinceMapTexture = setupCanvasTexture(provinceMapCanvas, (texture) => {
      texture.wrapS = THREE.ClampToEdgeWrapping;
      texture.wrapT = THREE.ClampToEdgeWrapping;
      texture.minFilter = THREE.LinearFilter;
      texture.magFilter = THREE.LinearFilter;
    });

    const countryLutTexture = setupCanvasTexture(countryLutCanvas, (texture) => {
      texture.wrapS = THREE.ClampToEdgeWrapping;
      texture.wrapT = THREE.ClampToEdgeWrapping;
      texture.minFilter = THREE.LinearFilter;
      texture.magFilter = THREE.LinearFilter;
    });

    const stateLutTexture = setupCanvasTexture(stateLutCanvas, (texture) => {
      texture.wrapS = THREE.ClampToEdgeWrapping;
      texture.wrapT = THREE.ClampToEdgeWrapping;
      texture.minFilter = THREE.LinearFilter;
      texture.magFilter = THREE.LinearFilter;
    });

    const strategicRegionLutTexture = setupCanvasTexture(strategicRegionLutCanvas, (texture) => {
      texture.wrapS = THREE.ClampToEdgeWrapping;
      texture.wrapT = THREE.ClampToEdgeWrapping;
      texture.minFilter = THREE.LinearFilter;
      texture.magFilter = THREE.LinearFilter;
    });

    const riversTexture = setupCanvasTexture(riversCanvas, (texture) => {
      texture.wrapS = THREE.ClampToEdgeWrapping;
      texture.wrapT = THREE.ClampToEdgeWrapping;
      texture.minFilter = THREE.NearestFilter;
      texture.magFilter = THREE.NearestFilter;
    });

    const terrainColormapTexture = setupCanvasTexture(terrainColormapCanvas, (texture) => {
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.ClampToEdgeWrapping;
      texture.minFilter = THREE.LinearMipmapLinearFilter;
      texture.magFilter = THREE.LinearFilter;
      texture.generateMipmaps = true;
      texture.anisotropy = maxAnisotropy;
    });

    const waterColormapTexture = setupCanvasTexture(waterColormapCanvas, (texture) => {
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.ClampToEdgeWrapping;
      texture.minFilter = THREE.LinearMipmapLinearFilter;
      texture.magFilter = THREE.LinearFilter;
      texture.generateMipmaps = true;
      texture.anisotropy = maxAnisotropy;
    });

    const cityLightsTexture = setupCanvasTexture(cityLightsCanvas, (texture) => {
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.ClampToEdgeWrapping;
      texture.minFilter = THREE.LinearMipmapLinearFilter;
      texture.magFilter = THREE.LinearFilter;
      texture.generateMipmaps = true;
      texture.anisotropy = maxAnisotropy;
    });

    sceneTextures.push(
      heightmapTexture,
      provinceMapTexture,
      countryLutTexture,
      stateLutTexture,
      strategicRegionLutTexture,
      riversTexture,
      terrainColormapTexture,
      waterColormapTexture,
      cityLightsTexture
    );

    terrainManager.createTerrainFromTextures(
      heightmapTexture,
      provinceMapTexture,
      countryLutTexture,
      stateLutTexture,
      strategicRegionLutTexture,
      riversTexture,
      terrainColormapTexture,
      waterColormapTexture,
      cityLightsTexture,
      provincesImg.width,
      provincesImg.height,
      heightmapCanvas
    );

    const picker = new ProvincePicker(
      camera,
      terrainManager,
      store,
      provinceMapCanvas,
      stateLutCanvas,
      strategicRegionLutCanvas,
      {
        viewportSize: () => {
          const rect = renderer.domElement.getBoundingClientRect();
          return {
            width: rect.width,
            height: rect.height,
          };
        },
      }
    );

    picker.onHover = (province, state, strategicRegion) => {
      if (!options.onHover) return;
      options.onHover(
        province ? toInteractionPayload(province, state, strategicRegion) : null
      );
    };

    picker.onSelect = (province, state, strategicRegion) => {
      if (!options.onSelect) return;
      options.onSelect(
        province ? toInteractionPayload(province, state, strategicRegion) : null
      );
    };

    const updateMouseFromEvent = (event: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      picker.updateMouse(x, y);
    };

    let pointerDown = false;
    let pointerDownX = 0;
    let pointerDownY = 0;
    let pointerDragging = false;

    const onPointerMove = (event: PointerEvent) => {
      updateMouseFromEvent(event);

      if (pointerDown) {
        const dx = event.clientX - pointerDownX;
        const dy = event.clientY - pointerDownY;
        if (Math.sqrt(dx * dx + dy * dy) > 5) {
          pointerDragging = true;
        }
      }
    };

    const onPointerDown = (event: PointerEvent) => {
      pointerDown = true;
      pointerDragging = false;
      pointerDownX = event.clientX;
      pointerDownY = event.clientY;
      updateMouseFromEvent(event);
    };

    const onPointerUp = (event: PointerEvent) => {
      updateMouseFromEvent(event);
      if (event.button === 0 && !pointerDragging) {
        picker.pick(performance.now(), true);
        picker.select();
      }
      pointerDown = false;
      pointerDragging = false;
    };

    const onPointerLeave = () => {
      picker.updateMouse(-9999, -9999);
      picker.pick(performance.now(), true);
    };

    renderer.domElement.addEventListener('pointermove', onPointerMove);
    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    renderer.domElement.addEventListener('pointerup', onPointerUp);
    renderer.domElement.addEventListener('pointerleave', onPointerLeave);

    const setMapMode = (mode: MapMode) => {
      terrainManager.setMapMode(MAP_MODE_TO_INDEX[mode]);
    };

    setMapMode(options.initialMapMode ?? 'political');

    const clock = new THREE.Clock();
    let disposed = false;
    let rafId = 0;

    const animate = () => {
      if (disposed) return;

      rafId = requestAnimationFrame(animate);

      const elapsed = clock.getElapsedTime();
      const delta = clock.getDelta();

      controls.update();
      picker.pick(performance.now());
      terrainManager.updateCameraPos(camera.position);
      terrainManager.updateTime(elapsed, delta);
      renderer.render(scene, camera);
    };

    animate();

    const dispose = () => {
      if (disposed) return;
      disposed = true;

      cancelAnimationFrame(rafId);

      renderer.domElement.removeEventListener('pointermove', onPointerMove);
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      renderer.domElement.removeEventListener('pointerup', onPointerUp);
      renderer.domElement.removeEventListener('pointerleave', onPointerLeave);
      window.removeEventListener('resize', resize);

      controls.dispose();

      scene.traverse((object) => {
        const mesh = object as THREE.Mesh;
        if (mesh.geometry) {
          mesh.geometry.dispose();
        }

        if (mesh.material) {
          if (Array.isArray(mesh.material)) {
            mesh.material.forEach((material) => disposeMaterial(material));
          } else {
            disposeMaterial(mesh.material);
          }
        }
      });

      sceneTextures.forEach((texture) => texture.dispose());
      renderer.dispose();
      renderer.forceContextLoss();

      if (renderer.domElement.parentElement === options.container) {
        options.container.removeChild(renderer.domElement);
      }
    };

    return {
      setMapMode,
      dispose,
    };
  } catch (error) {
    options.onError?.(error);
    throw error;
  }
}
