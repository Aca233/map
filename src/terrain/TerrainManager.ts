/**
 * 地形管理器
 * 负责创建分块地形网格，设置自定义着色器材质
 * 包含悬停/选中的平滑过渡动画逻辑
 * 使用分块 (chunked) 系统实现视锥体剔除优化
 * 支持 State（一级行政区）和 Strategic Region（海域）LUT 纹理与交互
 */

import * as THREE from 'three';
import terrainVertShader from './shaders/terrain.vert.glsl';
import terrainFragShader from './shaders/terrain.frag.glsl';

/** 分块配置（帧率优先档） */
export const TERRAIN_CHUNKS_X = 6;   // 水平方向分块数
export const TERRAIN_CHUNKS_Z = 2;   // 垂直方向分块数
export const TERRAIN_SEGS_PER_CHUNK_X = 224; // 每个分块的水平段数
export const TERRAIN_SEGS_PER_CHUNK_Z = 224; // 每个分块的垂直段数
export const TERRAIN_TOTAL_SEGS_X = TERRAIN_CHUNKS_X * TERRAIN_SEGS_PER_CHUNK_X;
export const TERRAIN_TOTAL_SEGS_Z = TERRAIN_CHUNKS_Z * TERRAIN_SEGS_PER_CHUNK_Z;

export class TerrainManager {
  /** 地形 Mesh（用于 Raycaster） */
  public meshes: THREE.Mesh[] = [];
  /** 地形材质 */
  public material!: THREE.ShaderMaterial;
  /** 高度图纹理 */
  public heightmapTexture!: THREE.Texture;
  /** 地块颜色图纹理 */
  public provinceMapTexture!: THREE.Texture;
  /** 国家颜色 LUT 纹理 */
  public countryLutTexture!: THREE.Texture;
  /** State 颜色 LUT 纹理 */
  public stateLutTexture!: THREE.Texture;
  /** Strategic Region 颜色 LUT 纹理 */
  public strategicRegionLutTexture!: THREE.Texture;
  /** 河流纹理（HOI4 rivers.bmp 转换） */
  public riversTexture!: THREE.Texture;
  /** HOI4 原版陆地地形色图 */
  public terrainColormapTexture!: THREE.Texture;
  /** HOI4 原版水体地形色图 */
  public waterColormapTexture!: THREE.Texture;
  /** 城市灯光掩码纹理（来自 colormap alpha） */
  public cityLightsTexture!: THREE.Texture;

  private scene: THREE.Scene;
  private mapWidth: number;
  private mapHeight: number;
  private heightScale: number;

  /** 高度图画布（用于 CPU 端顶点位移） */
  private heightmapCanvas: HTMLCanvasElement | null = null;
  /** 高度图像素数据缓存 */
  private heightmapData: Uint8ClampedArray | null = null;
  private hmW = 0;
  private hmH = 0;

  /** 悬停/选中过渡动画 */
  private hoverTarget = 0;
  private hoverCurrent = 0;
  private selectTarget = 0;
  private selectCurrent = 0;
  private readonly FADE_SPEED = 8.0; // 每秒淡入速度

  constructor(scene: THREE.Scene, mapWidth: number, mapHeight: number, heightScale: number = 15) {
    this.scene = scene;
    this.mapWidth = mapWidth;
    this.mapHeight = mapHeight;
    this.heightScale = heightScale;
  }

  /** 根据外部纹理创建地形（HOI4 数据版本，含 State + Strategic Region LUT） */
  createTerrainFromTextures(
    heightmapTex: THREE.Texture,
    provinceMapTex: THREE.Texture,
    countryLutTex: THREE.Texture,
    stateLutTex: THREE.Texture,
    strategicRegionLutTex: THREE.Texture,
    riversTex: THREE.Texture,
    terrainColormapTex: THREE.Texture,
    waterColormapTex: THREE.Texture,
    cityLightsTex: THREE.Texture,
    texWidth: number,
    texHeight: number,
    heightmapCanvas: HTMLCanvasElement
  ): void {
    this.heightmapTexture = heightmapTex;
    this.provinceMapTexture = provinceMapTex;
    this.countryLutTexture = countryLutTex;
    this.stateLutTexture = stateLutTex;
    this.strategicRegionLutTexture = strategicRegionLutTex;
    this.riversTexture = riversTex;
    this.terrainColormapTexture = terrainColormapTex;
    this.waterColormapTexture = waterColormapTex;
    this.cityLightsTexture = cityLightsTex;
    this.heightmapCanvas = heightmapCanvas;

    // 预先读取高度图数据，避免每个 chunk 都重复 getImageData
    const ctx = heightmapCanvas.getContext('2d', { willReadFrequently: true })!;
    this.hmW = heightmapCanvas.width;
    this.hmH = heightmapCanvas.height;
    this.heightmapData = ctx.getImageData(0, 0, this.hmW, this.hmH).data;

    // 创建自定义着色器材质
    this.material = new THREE.ShaderMaterial({
      vertexShader: terrainVertShader,
      fragmentShader: terrainFragShader,
      uniforms: {
        u_heightmap: { value: this.heightmapTexture },
        u_heightScale: { value: this.heightScale },
        u_displacementBias: { value: 0.0 },
        u_provinceMap: { value: this.provinceMapTexture },
        u_countryLUT: { value: this.countryLutTexture },
        u_stateLUT: { value: this.stateLutTexture },
        u_strategicRegionLUT: { value: this.strategicRegionLutTexture },
        u_riversMap: { value: this.riversTexture },
        u_terrainColormap: { value: this.terrainColormapTexture },
        u_waterColormap: { value: this.waterColormapTexture },
        u_cityLightsMap: { value: this.cityLightsTexture },
        u_cityLightsIntensity: { value: 1.0 },
        u_mapSize: { value: new THREE.Vector2(texWidth, texHeight) },
        u_hoveredColor: { value: new THREE.Vector3(-1, -1, -1) },
        u_selectedColor: { value: new THREE.Vector3(-1, -1, -1) },
        u_hoveredStateColor: { value: new THREE.Vector3(-1, -1, -1) },
        u_selectedStateColor: { value: new THREE.Vector3(-1, -1, -1) },
        u_hoveredStrategicRegionColor: { value: new THREE.Vector3(-1, -1, -1) },
        u_selectedStrategicRegionColor: { value: new THREE.Vector3(-1, -1, -1) },
        u_mapMode: { value: 0 },
        u_time: { value: 0 },
        u_seaLevel: { value: 0.358 },
        u_texelSize: { value: new THREE.Vector2(1.0 / texWidth, 1.0 / texHeight) },
        u_cameraPos: { value: new THREE.Vector3(0, 120, 120) },
        u_hoverStrength: { value: 0.0 },
        u_selectStrength: { value: 0.0 },
      },
    });

    // 创建分块网格
    this._buildChunks();
  }

  /** 创建分块地形网格 */
  private _buildChunks(): void {
    const totalWidth = this.mapWidth;
    const totalHeight = this.mapHeight;
    const imgData = this.heightmapData;

    const chunkW = totalWidth / TERRAIN_CHUNKS_X;   // 每个 chunk 的世界宽度
    const chunkH = totalHeight / TERRAIN_CHUNKS_Z;  // 每个 chunk 的世界高度（深度方向）

    const totalSegsX = TERRAIN_TOTAL_SEGS_X;
    const totalSegsZ = TERRAIN_TOTAL_SEGS_Z;

    console.log(`[TerrainManager] 分块创建: ${TERRAIN_CHUNKS_X}x${TERRAIN_CHUNKS_Z} 块, 每块 ${TERRAIN_SEGS_PER_CHUNK_X}x${TERRAIN_SEGS_PER_CHUNK_Z} 段, 总计 ${totalSegsX}x${totalSegsZ} 段`);

    // 为每个 chunk 创建独立的 geometry
    for (let cz = 0; cz < TERRAIN_CHUNKS_Z; cz++) {
      for (let cx = 0; cx < TERRAIN_CHUNKS_X; cx++) {
        const geometry = new THREE.PlaneGeometry(chunkW, chunkH, TERRAIN_SEGS_PER_CHUNK_X, TERRAIN_SEGS_PER_CHUNK_Z);
        geometry.rotateX(-Math.PI / 2);

        // 计算此 chunk 的世界偏移（以地形中心为原点）
        const offsetX = -totalWidth / 2 + chunkW / 2 + cx * chunkW;
        const offsetZ = -totalHeight / 2 + chunkH / 2 + cz * chunkH;

        // 计算此 chunk 对应的 UV 范围
        const uvMinX = cx / TERRAIN_CHUNKS_X;
        const uvMaxX = (cx + 1) / TERRAIN_CHUNKS_X;
        // V 轴：cz=0 是 Z 最负（北方），对应图片顶部 V=0
        const uvMinV = cz / TERRAIN_CHUNKS_Z;
        const uvMaxV = (cz + 1) / TERRAIN_CHUNKS_Z;

        const uvAttr = geometry.getAttribute('uv');
        const posAttr = geometry.getAttribute('position');

        for (let i = 0; i < uvAttr.count; i++) {
          // PlaneGeometry 默认 UV 范围 [0,1] → 映射到全局 UV 子区域
          const localU = uvAttr.getX(i);
          const localV = 1.0 - uvAttr.getY(i); // 翻转 V

          const globalU = uvMinX + localU * (uvMaxX - uvMinX);
          const globalV = uvMinV + localV * (uvMaxV - uvMinV);

          uvAttr.setXY(i, globalU, globalV);

          // CPU 端高度位移
          if (imgData) {
            const px = Math.min(Math.floor(globalU * this.hmW), this.hmW - 1);
            const py = Math.min(Math.floor(globalV * this.hmH), this.hmH - 1);
            const idx = (py * this.hmW + px) * 4;
            const heightValue = imgData[idx] / 255.0;
            const y = posAttr.getY(i) + heightValue * this.heightScale;
            posAttr.setY(i, y);
          }
        }

        uvAttr.needsUpdate = true;
        posAttr.needsUpdate = true;
        geometry.computeVertexNormals();
        geometry.computeBoundingSphere();
        geometry.computeBoundingBox();

        // 创建 3 个副本（中间 + 左 + 右）用于水平循环
        const offsets = [0, -totalWidth, totalWidth];
        for (const wrapOffset of offsets) {
          const mesh = new THREE.Mesh(geometry, this.material);
          mesh.position.set(offsetX + wrapOffset, 0, offsetZ);
          mesh.frustumCulled = true;
          this.scene.add(mesh);
          this.meshes.push(mesh);
        }
      }
    }

    // 释放高度图数据缓存（不再需要）
    this.heightmapData = null;

    const totalMeshes = TERRAIN_CHUNKS_X * TERRAIN_CHUNKS_Z * 3;
    const verticesPerChunk = (TERRAIN_SEGS_PER_CHUNK_X + 1) * (TERRAIN_SEGS_PER_CHUNK_Z + 1);
    console.log(`[TerrainManager] 已创建 ${totalMeshes} 个分块网格（${TERRAIN_CHUNKS_X}x${TERRAIN_CHUNKS_Z}x3），每块 ${verticesPerChunk} 顶点，通过视锥体剔除优化渲染`);
  }

  /** 更新时间 uniform 和过渡动画 */
  updateTime(time: number, deltaTime?: number): void {
    if (!this.material) return;

    this.material.uniforms.u_time.value = time;

    // 平滑过渡动画
    const dt = deltaTime || 0.016; // 默认 ~60fps
    const speed = this.FADE_SPEED * dt;

    // Hover 过渡
    if (this.hoverCurrent < this.hoverTarget) {
      this.hoverCurrent = Math.min(this.hoverCurrent + speed, this.hoverTarget);
    } else if (this.hoverCurrent > this.hoverTarget) {
      this.hoverCurrent = Math.max(this.hoverCurrent - speed, this.hoverTarget);
    }
    this.material.uniforms.u_hoverStrength.value = this.hoverCurrent;

    // Select 过渡
    if (this.selectCurrent < this.selectTarget) {
      this.selectCurrent = Math.min(this.selectCurrent + speed, this.selectTarget);
    } else if (this.selectCurrent > this.selectTarget) {
      this.selectCurrent = Math.max(this.selectCurrent - speed, this.selectTarget);
    }
    this.material.uniforms.u_selectStrength.value = this.selectCurrent;
  }

  /** 更新相机位置 uniform */
  updateCameraPos(pos: THREE.Vector3): void {
    if (this.material) {
      this.material.uniforms.u_cameraPos.value.copy(pos);
    }
  }

  /** 设置悬停地块颜色 */
  setHoveredProvince(r: number, g: number, b: number): void {
    if (this.material) {
      this.material.uniforms.u_hoveredColor.value.set(r / 255, g / 255, b / 255);
      this.hoverTarget = 1.0;
    }
  }

  /** 清除悬停 */
  clearHoveredProvince(): void {
    if (this.material) {
      this.hoverTarget = 0.0;
      // 等淡出完成后再清除颜色（在 updateTime 中 hoverCurrent→0 后）
      if (this.hoverCurrent <= 0.01) {
        this.material.uniforms.u_hoveredColor.value.set(-1, -1, -1);
      }
    }
  }

  /** 设置选中地块颜色 */
  setSelectedProvince(r: number, g: number, b: number): void {
    if (this.material) {
      this.material.uniforms.u_selectedColor.value.set(r / 255, g / 255, b / 255);
      this.selectTarget = 1.0;
    }
  }

  /** 清除选中 */
  clearSelectedProvince(): void {
    if (this.material) {
      this.selectTarget = 0.0;
      if (this.selectCurrent <= 0.01) {
        this.material.uniforms.u_selectedColor.value.set(-1, -1, -1);
      }
    }
  }

  // ===== State 级别交互 =====

  /** 设置悬停 State 颜色（State LUT 中的颜色） */
  setHoveredState(r: number, g: number, b: number): void {
    if (this.material) {
      this.material.uniforms.u_hoveredStateColor.value.set(r / 255, g / 255, b / 255);
    }
  }

  /** 清除悬停 State */
  clearHoveredState(): void {
    if (this.material) {
      this.material.uniforms.u_hoveredStateColor.value.set(-1, -1, -1);
    }
  }

  /** 设置选中 State 颜色 */
  setSelectedState(r: number, g: number, b: number): void {
    if (this.material) {
      this.material.uniforms.u_selectedStateColor.value.set(r / 255, g / 255, b / 255);
    }
  }

  /** 清除选中 State */
  clearSelectedState(): void {
    if (this.material) {
      this.material.uniforms.u_selectedStateColor.value.set(-1, -1, -1);
    }
  }

  // ===== Strategic Region（海域）级别交互 =====

  /** 设置悬停 Strategic Region 颜色（LUT 中的颜色） */
  setHoveredStrategicRegion(r: number, g: number, b: number): void {
    if (this.material) {
      this.material.uniforms.u_hoveredStrategicRegionColor.value.set(r / 255, g / 255, b / 255);
    }
  }

  /** 清除悬停 Strategic Region */
  clearHoveredStrategicRegion(): void {
    if (this.material) {
      this.material.uniforms.u_hoveredStrategicRegionColor.value.set(-1, -1, -1);
    }
  }

  /** 设置选中 Strategic Region 颜色 */
  setSelectedStrategicRegion(r: number, g: number, b: number): void {
    if (this.material) {
      this.material.uniforms.u_selectedStrategicRegionColor.value.set(r / 255, g / 255, b / 255);
    }
  }

  /** 清除选中 Strategic Region */
  clearSelectedStrategicRegion(): void {
    if (this.material) {
      this.material.uniforms.u_selectedStrategicRegionColor.value.set(-1, -1, -1);
    }
  }

  /** 设置地图模式 */
  setMapMode(mode: number): void {
    if (this.material) {
      this.material.uniforms.u_mapMode.value = mode;
    }
  }

  /** 设置城市灯光强度（0=关闭） */
  setCityLightsIntensity(intensity: number): void {
    if (this.material) {
      this.material.uniforms.u_cityLightsIntensity.value = Math.max(0, intensity);
    }
  }

  /** 获取所有 chunk mesh（用于 raycaster） */
  getMeshes(): THREE.Mesh[] {
    return this.meshes;
  }
}
