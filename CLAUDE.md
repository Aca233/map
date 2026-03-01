# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概览

这是一个基于 **Three.js + Vite + TypeScript** 的 HOI4 风格 3D 交互地图项目。

- 运行时核心是浏览器端渲染与交互（`src/main.ts`）
- 数据来源是转换后的 HOI4 资产（`public/assets/*.json|png`）
- 预处理脚本位于 `scripts/`，用于把 HOI4 原始资源转换成前端可直接加载的数据

## 常用命令

### 开发与构建
- 安装依赖：`npm install`
- 启动开发服务器：`npm run dev`
- 生产构建（含 TypeScript 检查）：`npm run build`
- 预览构建结果：`npm run preview`

### 代码检查
- 类型检查（不打包）：`npx tsc --noEmit`

### 测试与 lint 现状
- 当前 `package.json` 未配置测试框架与 `test` 脚本。
- 当前未配置 lint 脚本。
- 因此当前仓库**不支持单测命令**（也没有“运行单个测试”的命令）。

### 数据转换脚本
- 运行 HOI4 数据转换：`node scripts/convert-hoi4-data.mjs`
- 该脚本内 `HOI4_DIR` 为硬编码路径（默认在脚本中指向 Steam 安装目录），在不同机器上需要先修改该常量。

## 高层架构（Big Picture）

## 1) 启动与装配层：`src/main.ts`

`main.ts` 是总装配点，职责包括：

- 初始化 Three.js 场景、相机、渲染器、后处理（FXAA）
- 加载并转换资源（高度图、province/state/strategic region 相关 JSON 与纹理）
- 创建并连接核心模块：
  - `ProvinceStore`（数据索引）
  - `TerrainManager`（地形渲染）
  - `ProvincePicker`（拾取与悬停/选中）
  - `UIManager`（DOM UI 与模式切换）
- 绑定交互事件（鼠标移动、点击）
- 动画循环中驱动：
  - 控件更新
  - picker 节流拾取
  - terrain uniforms 更新时间与相机参数
  - UI/FPS 更新

此外，`main.ts` 还承担城市/建筑实例化与“贴地”逻辑（地形法线采样、倾斜限制、重定位与诊断），是目前最重的业务文件。

## 2) 数据层：`src/data/ProvinceStore.ts`

`ProvinceStore` 负责把 `public/assets/provinces.json` 与 `public/assets/states.json` 加载为运行时索引结构：

- Province（地块）
- Country（国家）
- State（行政区）
- Strategic Region（海域战略区）

关键点：

- 维护颜色到 province ID 的映射（用于拾取）
- 维护 province→state / province→strategicRegion 映射
- 提供 UI 与拾取流程会反复调用的查询 API（按颜色、按 ID、按归属等）

## 3) 渲染层：`src/terrain/TerrainManager.ts` + shaders

`TerrainManager` 负责地形 mesh 与 shader uniform 生命周期管理：

- 使用分块地形（chunked mesh）+ 三份水平复制来处理地图横向循环
- CPU 端根据高度图对顶点进行位移，再交给 GPU 着色
- 向 shader 传入 province/country/state/strategic region LUT、河流、陆地/水体 colormap、城市灯光等纹理
- 管理悬停/选中强度平滑过渡与地图模式切换

Shader 分工：

- `terrain.vert.glsl`：使用 CPU 已位移几何，输出世界空间法线/视线信息
- `terrain.frag.glsl`：实现政治/行政区/地形/高度图模式、边界检测（province/country/state/strategic region）与高亮叠加

## 4) 交互层：`src/interaction/ProvincePicker.ts`

`ProvincePicker` 使用 Raycaster 命中地形后，通过 UV 回查 province 图像像素，完成：

- 悬停地块识别（含节流）
- 点击选中
- 从 Province 进一步解析对应 State 或 Strategic Region
- 调用 `TerrainManager` 更新 hover/select 颜色
- 通过回调将 hover/select 事件发给 UI

实现上使用缓存像素数组与步长采样来平衡准确性与性能；点击时会启用更精细采样路径。

## 5) UI 层：`src/ui/UIManager.ts` + `index.html`

- `index.html` 提供 HUD 与控制面板 DOM（信息面板、tooltip、FPS、地图模式按钮、图层开关）
- `UIManager` 负责：
  - 面板/tooltip 渲染
  - 地图模式按钮事件（政治/行政区/地形/高度）
  - 城市散布、建筑、城市灯光图层开关
  - FPS 文本更新

UI 层本身不做拾取，依赖 `ProvincePicker` 回调输入数据。

## 6) 资源与构建约定

- Vite 配置在 `vite.config.ts`，`base` 设为 `/map/`（部署路径相关）
- `vite-plugin-glsl` 允许直接导入 `.glsl`
- 自定义模块声明在 `vite-env.d.ts`（含 `*.obj?raw`）
- 运行时依赖大量 `public/assets/*` 预处理资源；若资源缺失，通常应先执行数据转换脚本

## 修改建议（给后续 Claude）

- 涉及地图显示异常时，优先按链路排查：
  1) `public/assets` 资源是否完整
  2) `ProvinceStore` 索引是否正确
  3) `ProvincePicker` UV→像素映射是否正确
  4) `TerrainManager` uniforms 与 shader 模式是否一致
- `main.ts` 体量大且耦合较高，做功能改动时尽量先定位所属层（数据/渲染/拾取/UI）再改，避免跨层回归。