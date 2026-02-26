/**
 * HOI4 风格 3D 交互式地图 - 主入口（HOI4 真实数据版本）
 * 支持 State（一级行政区）可视化和交互
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { FXAAShader } from 'three/examples/jsm/shaders/FXAAShader.js';
import { ProvinceStore } from './data/ProvinceStore';
import { TerrainManager } from './terrain/TerrainManager';
import { ProvincePicker } from './interaction/ProvincePicker';
import { UIManager } from './ui/UIManager';

// ===== 配置 =====
// HOI4 地图尺寸 5632x2048 → 世界空间比例 2.75:1
const MAP_WORLD_WIDTH = 275;
const MAP_WORLD_HEIGHT = 100;
// 降低地形起伏，避免政治视图中山脊过于夸张
const HEIGHT_SCALE = 4.2;

// ===== 资源路径与加载辅助函数 =====
function assetUrl(fileName: string): string {
  return `${import.meta.env.BASE_URL}assets/${fileName}`;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

function imageToCanvas(img: HTMLImageElement): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0);
  return canvas;
}

// ===== 主程序 =====
async function main() {
  console.log('[Map] 正在初始化...');

  // 1. 创建数据仓库并加载 HOI4 数据
  const store = new ProvinceStore();
  await store.loadFromHOI4Data();

  // 2. 加载纹理图片
  console.log('[Map] 正在加载纹理...');
  const [heightmapImg, provincesImg, riversImg] = await Promise.all([
    loadImage(assetUrl('heightmap.png')),
    loadImage(assetUrl('provinces.png')),
    loadImage(assetUrl('rivers.png')),
  ]);

  console.log(`[Map] heightmap: ${heightmapImg.width}x${heightmapImg.height}`);
  console.log(`[Map] provinces: ${provincesImg.width}x${provincesImg.height}`);
  console.log(`[Map] rivers: ${riversImg.width}x${riversImg.height}`);

  const heightmapCanvas = imageToCanvas(heightmapImg);
  const provinceMapCanvas = imageToCanvas(provincesImg);
  const riversCanvas = imageToCanvas(riversImg);

  // 3. 生成国家颜色 LUT 纹理
  console.log('[Map] 正在生成国家颜色 LUT...');
  const countryLutCanvas = store.generateCountryLUT(provinceMapCanvas);

  // 4. 生成 State LUT 纹理
  console.log('[Map] 正在生成 State LUT...');
  const stateLutCanvas = store.generateStateLUT(provinceMapCanvas);

  // 5. 生成 Strategic Region LUT 纹理
  console.log('[Map] 正在生成 Strategic Region LUT...');
  const strategicRegionLutCanvas = store.generateStrategicRegionLUT(provinceMapCanvas);

  // ===== 场景设置 =====
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a0a1e);

  const camera = new THREE.PerspectiveCamera(
    60,
    window.innerWidth / window.innerHeight,
    0.1,
    2000
  );
  camera.position.set(0, 120, 120);
  camera.lookAt(0, 0, 0);

  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    powerPreference: 'high-performance',
  });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2.5));
  document.getElementById('app')!.prepend(renderer.domElement);

  // 后处理：FXAA 可明显减轻边界“台阶锯齿”
  const composer = new EffectComposer(renderer);
  const renderPass = new RenderPass(scene, camera);
  composer.addPass(renderPass);

  const fxaaPass = new ShaderPass(FXAAShader);
  composer.addPass(fxaaPass);

  const updateFxaaResolution = () => {
    const pr = renderer.getPixelRatio();
    fxaaPass.material.uniforms['resolution'].value.set(
      1 / (window.innerWidth * pr),
      1 / (window.innerHeight * pr)
    );
  };
  updateFxaaResolution();

  // ===== 相机控制 =====
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.screenSpacePanning = true;
  controls.minDistance = 5;
  controls.maxDistance = 400;
  controls.minPolarAngle = 0.1;
  controls.maxPolarAngle = Math.PI / 2.2;
  controls.mouseButtons = {
    LEFT: THREE.MOUSE.PAN,       // 左键按住拖动 = 平移地图
    MIDDLE: THREE.MOUSE.ROTATE,  // 中键按住 = 自由旋转角度
    RIGHT: THREE.MOUSE.DOLLY,    // 右键 = 缩放（备用）
  };
  controls.touches = {
    ONE: THREE.TOUCH.PAN,
    TWO: THREE.TOUCH.DOLLY_ROTATE,
  };
  controls.target.set(0, 0, 0);

  // WASD 键盘移动控制
  const keysPressed = new Set<string>();
  const MOVE_SPEED_FACTOR = 0.012; // 移速系数（乘以相机距离）

  window.addEventListener('keydown', (e) => {
    keysPressed.add(e.key.toLowerCase());
  });
  window.addEventListener('keyup', (e) => {
    keysPressed.delete(e.key.toLowerCase());
  });

  // ===== 光照 =====
  scene.add(new THREE.AmbientLight(0x404060, 0.5));
  const dirLight = new THREE.DirectionalLight(0xffeedd, 0.8);
  dirLight.position.set(50, 100, 30);
  scene.add(dirLight);

  // ===== 地形 =====
  console.log('[Map] 正在创建地形...');
  const terrainManager = new TerrainManager(scene, MAP_WORLD_WIDTH, MAP_WORLD_HEIGHT, HEIGHT_SCALE);

  // 创建纹理对象
  // flipY=false: 确保 UV v=0 对应图片顶部（与 Canvas y=0 对应图片顶部一致）
  const heightmapTexture = new THREE.CanvasTexture(heightmapCanvas);
  heightmapTexture.flipY = false;
  heightmapTexture.wrapS = THREE.ClampToEdgeWrapping;
  heightmapTexture.wrapT = THREE.ClampToEdgeWrapping;
  heightmapTexture.minFilter = THREE.LinearFilter;
  heightmapTexture.magFilter = THREE.LinearFilter;

  const provinceMapTexture = new THREE.CanvasTexture(provinceMapCanvas);
  provinceMapTexture.flipY = false;
  provinceMapTexture.wrapS = THREE.ClampToEdgeWrapping;
  provinceMapTexture.wrapT = THREE.ClampToEdgeWrapping;
  // 视觉渲染使用线性过滤，降低放大后边界“像素块”锯齿感
  // 交互拾取仍走 CPU Canvas 逐像素读取，不受此处过滤影响
  provinceMapTexture.minFilter = THREE.LinearFilter;
  provinceMapTexture.magFilter = THREE.LinearFilter;

  const countryLutTexture = new THREE.CanvasTexture(countryLutCanvas);
  countryLutTexture.flipY = false;
  countryLutTexture.wrapS = THREE.ClampToEdgeWrapping;
  countryLutTexture.wrapT = THREE.ClampToEdgeWrapping;
  countryLutTexture.minFilter = THREE.LinearFilter;
  countryLutTexture.magFilter = THREE.LinearFilter;

  const stateLutTexture = new THREE.CanvasTexture(stateLutCanvas);
  stateLutTexture.flipY = false;
  stateLutTexture.wrapS = THREE.ClampToEdgeWrapping;
  stateLutTexture.wrapT = THREE.ClampToEdgeWrapping;
  stateLutTexture.minFilter = THREE.LinearFilter;
  stateLutTexture.magFilter = THREE.LinearFilter;

  const strategicRegionLutTexture = new THREE.CanvasTexture(strategicRegionLutCanvas);
  strategicRegionLutTexture.flipY = false;
  strategicRegionLutTexture.wrapS = THREE.ClampToEdgeWrapping;
  strategicRegionLutTexture.wrapT = THREE.ClampToEdgeWrapping;
  strategicRegionLutTexture.minFilter = THREE.LinearFilter;
  strategicRegionLutTexture.magFilter = THREE.LinearFilter;

  const riversTexture = new THREE.CanvasTexture(riversCanvas);
  riversTexture.flipY = false;
  riversTexture.wrapS = THREE.ClampToEdgeWrapping;
  riversTexture.wrapT = THREE.ClampToEdgeWrapping;
  riversTexture.minFilter = THREE.NearestFilter;
  riversTexture.magFilter = THREE.NearestFilter;

  terrainManager.createTerrainFromTextures(
    heightmapTexture,
    provinceMapTexture,
    countryLutTexture,
    stateLutTexture,
    strategicRegionLutTexture,
    riversTexture,
    provincesImg.width,
    provincesImg.height,
    heightmapCanvas
  );
  console.log('[Map] 地形创建完毕');

  // ===== 交互拾取 =====
  const picker = new ProvincePicker(
    camera,
    terrainManager,
    store,
    provinceMapCanvas,
    stateLutCanvas,
    strategicRegionLutCanvas
  );

  // ===== UI =====
  const ui = new UIManager(store);

  let lastMouseX = 0;
  let lastMouseY = 0;

  picker.onHover = (province, state, strategicRegion) => {
    if (province) {
      ui.showTooltip(province, state, strategicRegion, lastMouseX, lastMouseY);
      document.body.style.cursor = 'pointer';
    } else {
      ui.hideTooltip();
      document.body.style.cursor = 'default';
    }
  };

  picker.onSelect = (province, state, strategicRegion) => {
    if (province) {
      ui.showPanel(province, state, strategicRegion);
    } else {
      ui.hidePanel();
    }
  };

  ui.onMapModeChange = (mode) => {
    terrainManager.setMapMode(mode);
  };

  // ===== 事件 =====
  // 区分点击 vs 拖拽：只有鼠标移动距离 < 5px 时才算作点击选中
  let mouseDownPos = { x: 0, y: 0 };
  let isDragging = false;

  window.addEventListener('mousedown', (e) => {
    mouseDownPos.x = e.clientX;
    mouseDownPos.y = e.clientY;
    isDragging = false;
  });

  window.addEventListener('mousemove', (e) => {
    lastMouseX = e.clientX;
    lastMouseY = e.clientY;
    picker.updateMouse(e.clientX, e.clientY);

    // 检查是否拖拽
    const dx = e.clientX - mouseDownPos.x;
    const dy = e.clientY - mouseDownPos.y;
    if (Math.sqrt(dx * dx + dy * dy) > 5) {
      isDragging = true;
    }
  });

  window.addEventListener('mouseup', (e) => {
    if (!isDragging && e.button === 0) {
      const target = e.target as HTMLElement;
      if (target.closest('#province-panel') || target.closest('#map-mode-bar')) return;
      // 在 select 之前强制 pick 一次，确保 hoveredProvince 是最新的
      picker.updateMouse(e.clientX, e.clientY);
      picker.pick(performance.now(), true); // 强制 pick，跳过节流
      picker.select();
    }
  });

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();

    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2.5));
    renderer.setSize(window.innerWidth, window.innerHeight);
    composer.setSize(window.innerWidth, window.innerHeight);
    updateFxaaResolution();
  });

  // ===== 渲染循环 =====
  const clock = new THREE.Clock();
  let lastFrameTime = performance.now();

  function animate(): void {
    requestAnimationFrame(animate);
    const elapsed = clock.getElapsedTime();
    const timestamp = performance.now();
    const deltaTime = (timestamp - lastFrameTime) / 1000; // 秒
    lastFrameTime = timestamp;

    // WASD 键盘移动
    if (keysPressed.size > 0) {
      // 获取相机在 XZ 平面上的前方和右方方向
      const forward = new THREE.Vector3();
      camera.getWorldDirection(forward);
      forward.y = 0;
      forward.normalize();

      const right = new THREE.Vector3();
      right.crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();

      const moveVec = new THREE.Vector3();

      if (keysPressed.has('w')) moveVec.add(forward);
      if (keysPressed.has('s')) moveVec.sub(forward);
      if (keysPressed.has('a')) moveVec.sub(right);
      if (keysPressed.has('d')) moveVec.add(right);

      if (moveVec.length() > 0) {
        // 移速与相机到目标的距离成正比：近距离慢，远距离快
        const dist = camera.position.distanceTo(controls.target);
        const speed = dist * MOVE_SPEED_FACTOR;
        moveVec.normalize().multiplyScalar(speed);
        camera.position.add(moveVec);
        controls.target.add(moveVec);
      }
    }

    controls.update();

    // 水平循环卷轴：当相机超出地图边界时回绕
    const halfW = MAP_WORLD_WIDTH / 2;
    if (controls.target.x > halfW) {
      const shift = MAP_WORLD_WIDTH;
      controls.target.x -= shift;
      camera.position.x -= shift;
    } else if (controls.target.x < -halfW) {
      const shift = MAP_WORLD_WIDTH;
      controls.target.x += shift;
      camera.position.x += shift;
    }

    picker.pick(timestamp);

    // 更新地形管理器：时间、相机位置、过渡动画
    terrainManager.updateCameraPos(camera.position);
    terrainManager.updateTime(elapsed, deltaTime);

    ui.updateFPS(timestamp);
    composer.render();
  }

  animate();
  console.log('[Map] 应用启动完毕');
}

main().catch(console.error);
