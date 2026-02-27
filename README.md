# @hoi4/map-core

Three.js 驱动的 HOI4 风格地图核心渲染库（无内置 UI）。

当前版本提供框架无关 API，可在任意前端项目中通过 `import` 调用。

## 特性

- 外部资源驱动：纹理与 JSON 通过 URL 或 CDN 加载
- 交互能力：省份 hover / select 回调
- 地图模式：政治 / 行政区 / 地形 / 高度
- 生命周期控制：创建后可显式销毁并释放 WebGL 资源

## 安装

```bash
npm install @hoi4/map-core three
```

> `three` 被声明为 peer dependency，请在宿主项目自行安装。

## 快速开始

```ts
import { createMap, type MapMode } from '@hoi4/map-core';

const container = document.getElementById('map')!;

const map = await createMap({
  container,
  assetBaseUrl: 'https://cdn.example.com/hoi4-assets/v1/',
  assets: {
    heightmap: 'heightmap.png',
    provinces: 'provinces.png',
    rivers: 'rivers.png',
    terrainColormap: 'terrain_colormap.png',
    waterColormap: 'terrain_water.png',
    cityLights: 'city_lights.png',
    provincesJson: 'provinces.json',
    statesJson: 'states.json',
  },
  initialMapMode: 'political',
  onHover(payload) {
    if (!payload) return;
    console.log('hover province:', payload.province.id, payload.province.name);
  },
  onSelect(payload) {
    if (!payload) return;
    console.log('select province:', payload.province.id, payload.province.name);
  },
});

const switchMode = (mode: MapMode) => {
  map.setMapMode(mode);
};

window.addEventListener('beforeunload', () => {
  map.dispose();
});
```

## API

### createMap(options)

入口函数，异步初始化地图。

`options` 字段：

- `container: HTMLElement` 渲染容器
- `assets` 资源清单（见下文）
- `assetBaseUrl?: string` 可选基础 URL，`assets` 中相对路径会基于它解析
- `initialMapMode?: 'political' | 'state' | 'terrain' | 'heightmap'`
- `onHover?: (payload | null) => void`
- `onSelect?: (payload | null) => void`
- `onError?: (error) => void`
- `backgroundColor?: number` 场景背景色（默认 `0x0a0a1e`）
- `antialias?: boolean` 是否启用抗锯齿（默认 `true`）

返回 `Promise<MapInstance>`。

### MapInstance

- `setMapMode(mode)` 切换地图模式
- `dispose()` 销毁地图并释放资源

## 资源清单

`assets` 必填字段：

- `heightmap`
- `provinces`
- `rivers`
- `terrainColormap`
- `waterColormap`
- `cityLights`
- `provincesJson`
- `statesJson`

可以传完整 URL，也可以配合 `assetBaseUrl` 传相对路径。

## 交互回调载荷

`onHover` / `onSelect` 的 `payload` 结构：

- `province`: 省份数据（id、name、owner、terrain、stateId 等）
- `state`: 行政区数据（可能为 `null`）
- `strategicRegion`: 海域数据（可能为 `null`）

## 本地开发

```bash
npm install
npm run dev
```

## 构建库产物

```bash
npm run build:lib
```

输出目录：`dist-lib/`

## 与旧入口的关系

- 历史应用入口仍是 `src/main.ts`（用于当前 demo）
- npm 对外入口为 `src/lib/index.ts`

## 发布前检查建议

1. 确认 CDN 资源可访问（含 CORS）
2. 宿主项目已安装兼容版本 `three`
3. 页面卸载场景已调用 `dispose()`
4. `onError` 已接入日志系统
