// ============================================================
// 地形片段着色器 — 美化版 + 行政区支持
// 包含：海洋动画、Blinn-Phong 光照、大气散射、
//       噪声地形着色、改进边界线、平滑过渡、
//       State（一级行政区）边界线和地图模式
// ============================================================

uniform sampler2D u_provinceMap;       // 地块颜色图 (Nearest filter!)
uniform sampler2D u_countryLUT;        // 国家颜色纹理 (与 province map 同尺寸)
uniform sampler2D u_stateLUT;          // State 颜色纹理 (与 province map 同尺寸)
uniform sampler2D u_strategicRegionLUT; // Strategic Region 颜色纹理 (与 province map 同尺寸)
uniform sampler2D u_riversMap;         // 河流纹理（HOI4 rivers.bmp 转换）
uniform sampler2D u_terrainColormap;   // HOI4 原版陆地地形色图
uniform sampler2D u_waterColormap;     // HOI4 原版水体地形色图
uniform sampler2D u_cityLightsMap;     // 城市灯光掩码（HOI4 colormap alpha）
uniform float u_cityLightsIntensity;   // 城市灯光强度（0=关闭）
uniform sampler2D u_heightmap;         // 高度图纹理
uniform vec2 u_mapSize;                // 地图纹理尺寸 (像素)
uniform vec3 u_hoveredColor;           // 当前悬停地块的颜色 (归一化 0-1)
uniform vec3 u_selectedColor;          // 当前选中地块的颜色 (归一化 0-1)
uniform vec3 u_hoveredStateColor;      // 当前悬停 State 的颜色 (State LUT 颜色)
uniform vec3 u_selectedStateColor;     // 当前选中 State 的颜色 (State LUT 颜色)
uniform vec3 u_hoveredStrategicRegionColor; // 当前悬停 Strategic Region 的颜色 (LUT 颜色)
uniform vec3 u_selectedStrategicRegionColor; // 当前选中 Strategic Region 的颜色 (LUT 颜色)
uniform int u_mapMode;                 // 地图模式: 0=政治, 1=地形, 2=高度图, 3=行政区
uniform float u_time;                  // 动画时间
uniform float u_seaLevel;              // 海平面高度
uniform vec2 u_texelSize;              // 纹理像素大小
uniform vec3 u_cameraPos;              // 相机世界坐标
uniform float u_hoverStrength;         // 悬停过渡强度 (0-1)
uniform float u_selectStrength;        // 选中过渡强度 (0-1)

varying vec2 v_uv;
varying float v_height;
varying vec3 v_worldPos;
varying vec3 v_normal;
varying vec3 v_viewDir;

// ============================================================
// 工具函数
// ============================================================

// 简单 2D hash（用于程序化噪声）
float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
}

// 2D value noise
float noise2D(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f); // smoothstep

    float a = hash21(i);
    float b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0));
    float d = hash21(i + vec2(1.0, 1.0));

    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

// FBM（分形噪声）
float fbm(vec2 p, int octaves) {
    float value = 0.0;
    float amplitude = 0.5;
    float frequency = 1.0;
    for (int i = 0; i < 4; i++) {
        if (i >= octaves) break;
        value += amplitude * noise2D(p * frequency);
        frequency *= 2.0;
        amplitude *= 0.5;
    }
    return value;
}

// ============================================================
// 边界线检测（屏幕空间超采样 + fwidth 软化）
// ============================================================

// 省份边界检测（Sobel 梯度：避免“横平竖直”，并保持略粗于当前版本）
float getBorder(vec2 uv) {
    vec2 texel = 1.0 / u_mapSize;

    // 半 texel 采样构造 3x3 梯度，方向更自然
    vec3 tl = texture2D(u_provinceMap, uv + texel * vec2(-0.5, -0.5)).rgb;
    vec3  t = texture2D(u_provinceMap, uv + texel * vec2( 0.0, -0.5)).rgb;
    vec3 tr = texture2D(u_provinceMap, uv + texel * vec2( 0.5, -0.5)).rgb;
    vec3  l = texture2D(u_provinceMap, uv + texel * vec2(-0.5,  0.0)).rgb;
    vec3  r = texture2D(u_provinceMap, uv + texel * vec2( 0.5,  0.0)).rgb;
    vec3 bl = texture2D(u_provinceMap, uv + texel * vec2(-0.5,  0.5)).rgb;
    vec3  b = texture2D(u_provinceMap, uv + texel * vec2( 0.0,  0.5)).rgb;
    vec3 br = texture2D(u_provinceMap, uv + texel * vec2( 0.5,  0.5)).rgb;

    vec3 gx = (tr + 2.0 * r + br) - (tl + 2.0 * l + bl);
    vec3 gy = (bl + 2.0 * b + br) - (tl + 2.0 * t + tr);
    float edge = length(gx) + length(gy);

    // 距离淡出（缩远时减少噪点与闪烁）
    vec2 dUV = fwidth(uv);
    float screenTexelRatio = max(dUV.x * u_mapSize.x, dUV.y * u_mapSize.y);
    float distFade = smoothstep(5.0, 1.8, screenTexelRatio);
    if (distFade < 0.01) return 0.0;

    // 相比上一版略放宽阈值，恢复“看得见但不粗”的线宽
    // 放大视角下适当放宽软化带，减轻台阶锯齿
    float fw = max(fwidth(edge), 0.0045);
    float border = smoothstep(0.11 - fw, 0.11 + fw, edge);
    border = pow(border, 0.92);

    return border * distFade;
}

// 省份 ID 采样：按 texel 中心读取，避免线性过滤导致的颜色插值误判
vec3 sampleProvinceCell(vec2 cell) {
    vec2 clampedCell = clamp(cell, vec2(0.0), u_mapSize - vec2(1.0));
    vec2 centerUv = (clampedCell + vec2(0.5)) / u_mapSize;
    return texture2D(u_provinceMap, centerUv).rgb;
}

// 将 Province 颜色解码为稳定 key（R/G/B 24bit）
float decodeProvinceKey(vec3 rgb) {
    float r = floor(rgb.r * 255.0 + 0.5);
    float g = floor(rgb.g * 255.0 + 0.5);
    float b = floor(rgb.b * 255.0 + 0.5);
    return r * 65536.0 + g * 256.0 + b;
}

// 省份边界核心检测（ID 比较，不依赖颜色差大小，适合海域低对比色）
float provinceBorderCore(vec2 uv) {
    vec2 cell = floor(uv * u_mapSize);
    vec2 o = vec2(1.0);

    float centerKey = decodeProvinceKey(sampleProvinceCell(cell));

    float diff = 0.0;
    float maxDiff = 0.0;

    float rightKey = decodeProvinceKey(sampleProvinceCell(cell + vec2( o.x,  0.0)));
    float leftKey  = decodeProvinceKey(sampleProvinceCell(cell + vec2(-o.x,  0.0)));
    float upKey    = decodeProvinceKey(sampleProvinceCell(cell + vec2( 0.0,  o.y)));
    float downKey  = decodeProvinceKey(sampleProvinceCell(cell + vec2( 0.0, -o.y)));
    float urKey    = decodeProvinceKey(sampleProvinceCell(cell + vec2( o.x,  o.y)));
    float ulKey    = decodeProvinceKey(sampleProvinceCell(cell + vec2(-o.x,  o.y)));
    float drKey    = decodeProvinceKey(sampleProvinceCell(cell + vec2( o.x, -o.y)));
    float dlKey    = decodeProvinceKey(sampleProvinceCell(cell + vec2(-o.x, -o.y)));

    float dRight = step(0.5, abs(centerKey - rightKey));
    float dLeft  = step(0.5, abs(centerKey - leftKey));
    float dUp    = step(0.5, abs(centerKey - upKey));
    float dDown  = step(0.5, abs(centerKey - downKey));
    float dUR    = step(0.5, abs(centerKey - urKey));
    float dUL    = step(0.5, abs(centerKey - ulKey));
    float dDR    = step(0.5, abs(centerKey - drKey));
    float dDL    = step(0.5, abs(centerKey - dlKey));

    diff += dRight;
    diff += dLeft;
    diff += dUp;
    diff += dDown;
    diff += dUR;
    diff += dUL;
    diff += dDR;
    diff += dDL;

    maxDiff = max(maxDiff, dRight);
    maxDiff = max(maxDiff, dLeft);
    maxDiff = max(maxDiff, dUp);
    maxDiff = max(maxDiff, dDown);
    maxDiff = max(maxDiff, dUR);
    maxDiff = max(maxDiff, dUL);
    maxDiff = max(maxDiff, dDR);
    maxDiff = max(maxDiff, dDL);

    // avgDiff 体现周围变化密度，maxDiff 保证单侧边界也能被完整画出
    float avgDiff = diff * 0.125;
    return max(avgDiff, maxDiff * 0.80);
}

// 稳定省份边界检测（屏幕空间 5 点超采样）
float getProvinceBorderStable(vec2 uv) {
    vec2 dUV = fwidth(uv);
    vec2 aaOffset = max(dUV * 0.5, (1.0 / u_mapSize) * 0.2);

    float b0 = provinceBorderCore(uv);
    float b1 = provinceBorderCore(uv + vec2( aaOffset.x, 0.0));
    float b2 = provinceBorderCore(uv + vec2(-aaOffset.x, 0.0));
    float b3 = provinceBorderCore(uv + vec2(0.0,  aaOffset.y));
    float b4 = provinceBorderCore(uv + vec2(0.0, -aaOffset.y));

    float borderMax = max(max(max(b0, b1), max(b2, b3)), b4);
    float borderAvg = (b0 + b1 + b2 + b3 + b4) * 0.2;
    float border = max(borderMax, borderAvg * 0.85);

    border = pow(border, 0.78);
    float aa = max(fwidth(border), 0.018);
    return smoothstep(0.05 - aa, 0.82 + aa, border);
}

// 国家边界核心检测（8 邻域，硬检测后再做屏幕空间平滑）
float countryBorderCore(vec2 uv, float sampleScale) {
    vec2 texel = 1.0 / u_mapSize;
    vec2 offset = texel * sampleScale;
    vec3 center = texture2D(u_countryLUT, uv).rgb;

    float diff = 0.0;
    diff += step(0.0015, length(center - texture2D(u_countryLUT, uv + vec2( offset.x, 0.0)).rgb));
    diff += step(0.0015, length(center - texture2D(u_countryLUT, uv + vec2(-offset.x, 0.0)).rgb));
    diff += step(0.0015, length(center - texture2D(u_countryLUT, uv + vec2(0.0,  offset.y)).rgb));
    diff += step(0.0015, length(center - texture2D(u_countryLUT, uv + vec2(0.0, -offset.y)).rgb));
    diff += step(0.0015, length(center - texture2D(u_countryLUT, uv + vec2( offset.x,  offset.y)).rgb));
    diff += step(0.0015, length(center - texture2D(u_countryLUT, uv + vec2(-offset.x,  offset.y)).rgb));
    diff += step(0.0015, length(center - texture2D(u_countryLUT, uv + vec2( offset.x, -offset.y)).rgb));
    diff += step(0.0015, length(center - texture2D(u_countryLUT, uv + vec2(-offset.x, -offset.y)).rgb));

    return diff * 0.125;
}

// 国家边界检测（性能档：单次采样）
float getCountryBorder(vec2 uv) {
    vec2 dUV = fwidth(uv);
    float screenTexelRatio = max(dUV.x * u_mapSize.x, dUV.y * u_mapSize.y);
    float sampleScale = clamp(0.90 + screenTexelRatio * 0.25, 1.0, 2.6);

    float border = countryBorderCore(uv, sampleScale);
    border = pow(border, 0.88);
    float aa = max(fwidth(border), 0.014);
    return smoothstep(0.08 - aa, 0.82 + aa, border);
}

// State ID 采样：按 texel 中心读取，避免线性过滤导致交界处发淡
vec3 sampleStateCell(vec2 cell) {
    vec2 clampedCell = clamp(cell, vec2(0.0), u_mapSize - vec2(1.0));
    vec2 centerUv = (clampedCell + vec2(0.5)) / u_mapSize;
    return texture2D(u_stateLUT, centerUv).rgb;
}

// 将 State LUT 颜色解码为稳定 ID（R 高字节 + G 低字节）
float decodeStateId(vec3 rgb) {
    float r = floor(rgb.r * 255.0 + 0.5);
    float g = floor(rgb.g * 255.0 + 0.5);
    return r * 256.0 + g;
}

// State（行政区）边界核心检测（ID 比较，避免颜色差阈值造成断续/发淡）
float stateBorderCore(vec2 uv, float sampleScale) {
    vec2 cell = floor(uv * u_mapSize);
    // 固定 1 像素邻域，避免大 sampleScale 在交界处造成断续/发虚
    float stepPx = 1.0;
    vec2 o = vec2(stepPx);

    float centerId = decodeStateId(sampleStateCell(cell));
    if (centerId < 0.5) return 0.0;

    float diff = 0.0;
    float count = 0.0;

    float rightId = decodeStateId(sampleStateCell(cell + vec2( o.x,  0.0)));
    float leftId  = decodeStateId(sampleStateCell(cell + vec2(-o.x,  0.0)));
    float upId    = decodeStateId(sampleStateCell(cell + vec2( 0.0,  o.y)));
    float downId  = decodeStateId(sampleStateCell(cell + vec2( 0.0, -o.y)));
    float urId    = decodeStateId(sampleStateCell(cell + vec2( o.x,  o.y)));
    float ulId    = decodeStateId(sampleStateCell(cell + vec2(-o.x,  o.y)));
    float drId    = decodeStateId(sampleStateCell(cell + vec2( o.x, -o.y)));
    float dlId    = decodeStateId(sampleStateCell(cell + vec2(-o.x, -o.y)));

    if (rightId > 0.5) { diff += step(0.5, abs(centerId - rightId)); count += 1.0; }
    if (leftId  > 0.5) { diff += step(0.5, abs(centerId - leftId));  count += 1.0; }
    if (upId    > 0.5) { diff += step(0.5, abs(centerId - upId));    count += 1.0; }
    if (downId  > 0.5) { diff += step(0.5, abs(centerId - downId));  count += 1.0; }
    if (urId    > 0.5) { diff += step(0.5, abs(centerId - urId));    count += 1.0; }
    if (ulId    > 0.5) { diff += step(0.5, abs(centerId - ulId));    count += 1.0; }
    if (drId    > 0.5) { diff += step(0.5, abs(centerId - drId));    count += 1.0; }
    if (dlId    > 0.5) { diff += step(0.5, abs(centerId - dlId));    count += 1.0; }

    if (count < 0.5) return 0.0;
    return diff / count;
}

// State（行政区）边界检测（性能档：单次采样）
float getStateBorder(vec2 uv) {
    vec2 dUV = fwidth(uv);
    float screenTexelRatio = max(dUV.x * u_mapSize.x, dUV.y * u_mapSize.y);
    float sampleScale = clamp(0.90 + screenTexelRatio * 0.30, 1.0, 2.6);

    float border = stateBorderCore(uv, sampleScale);
    border = pow(border, 0.84);
    float aa = max(fwidth(border), 0.017);
    return smoothstep(0.02 - aa, 0.52 + aa, border);
}

// Strategic Region（海域）ID 采样：按 texel 中心读取，避免线性过滤导致交界处发淡
vec3 sampleStrategicRegionCell(vec2 cell) {
    vec2 clampedCell = clamp(cell, vec2(0.0), u_mapSize - vec2(1.0));
    vec2 centerUv = (clampedCell + vec2(0.5)) / u_mapSize;
    return texture2D(u_strategicRegionLUT, centerUv).rgb;
}

// 将 Strategic Region LUT 颜色解码为稳定 ID（R 高字节 + G 低字节）
float decodeStrategicRegionId(vec3 rgb) {
    float r = floor(rgb.r * 255.0 + 0.5);
    float g = floor(rgb.g * 255.0 + 0.5);
    return r * 256.0 + g;
}

// Strategic Region（海域）边界核心检测
float strategicRegionBorderCore(vec2 uv) {
    vec2 cell = floor(uv * u_mapSize);
    vec2 o = vec2(1.0);

    float centerId = decodeStrategicRegionId(sampleStrategicRegionCell(cell));
    if (centerId < 0.5) return 0.0;

    float diff = 0.0;
    float count = 0.0;

    float rightId = decodeStrategicRegionId(sampleStrategicRegionCell(cell + vec2( o.x,  0.0)));
    float leftId  = decodeStrategicRegionId(sampleStrategicRegionCell(cell + vec2(-o.x,  0.0)));
    float upId    = decodeStrategicRegionId(sampleStrategicRegionCell(cell + vec2( 0.0,  o.y)));
    float downId  = decodeStrategicRegionId(sampleStrategicRegionCell(cell + vec2( 0.0, -o.y)));
    float urId    = decodeStrategicRegionId(sampleStrategicRegionCell(cell + vec2( o.x,  o.y)));
    float ulId    = decodeStrategicRegionId(sampleStrategicRegionCell(cell + vec2(-o.x,  o.y)));
    float drId    = decodeStrategicRegionId(sampleStrategicRegionCell(cell + vec2( o.x, -o.y)));
    float dlId    = decodeStrategicRegionId(sampleStrategicRegionCell(cell + vec2(-o.x, -o.y)));

    if (rightId > 0.5) { diff += step(0.5, abs(centerId - rightId)); count += 1.0; }
    if (leftId  > 0.5) { diff += step(0.5, abs(centerId - leftId));  count += 1.0; }
    if (upId    > 0.5) { diff += step(0.5, abs(centerId - upId));    count += 1.0; }
    if (downId  > 0.5) { diff += step(0.5, abs(centerId - downId));  count += 1.0; }
    if (urId    > 0.5) { diff += step(0.5, abs(centerId - urId));    count += 1.0; }
    if (ulId    > 0.5) { diff += step(0.5, abs(centerId - ulId));    count += 1.0; }
    if (drId    > 0.5) { diff += step(0.5, abs(centerId - drId));    count += 1.0; }
    if (dlId    > 0.5) { diff += step(0.5, abs(centerId - dlId));    count += 1.0; }

    if (count < 0.5) return 0.0;
    return diff / count;
}

// Strategic Region（海域）边界检测（屏幕空间 5 点超采样）
float getStrategicRegionBorder(vec2 uv) {
    vec2 dUV = fwidth(uv);
    vec2 aaOffset = max(dUV * 0.5, (1.0 / u_mapSize) * 0.2);

    float b0 = strategicRegionBorderCore(uv);
    float b1 = strategicRegionBorderCore(uv + vec2( aaOffset.x, 0.0));
    float b2 = strategicRegionBorderCore(uv + vec2(-aaOffset.x, 0.0));
    float b3 = strategicRegionBorderCore(uv + vec2(0.0,  aaOffset.y));
    float b4 = strategicRegionBorderCore(uv + vec2(0.0, -aaOffset.y));

    float border = max(max(max(b0, b1), max(b2, b3)), b4);
    border = pow(border, 0.82);
    float aa = max(fwidth(border), 0.015);
    return smoothstep(0.02 - aa, 0.50 + aa, border);
}

// 国家边界外发光（性能档：复用核心检测，禁用高成本 5x5 邻域）
float getCountryBorderGlow(vec2 uv) {
    float core = countryBorderCore(uv, 1.8);
    float glow = pow(core, 1.15);
    return smoothstep(0.10, 0.65, glow) * 0.55;
}

// 海岸线检测（陆地与海洋的交界）
float getCoastline(vec2 uv, float height) {
    if (height > u_seaLevel + 0.05 || height < u_seaLevel - 0.05) return 0.0;

    vec2 texel = u_texelSize;
    float hR = texture2D(u_provinceMap, uv + vec2(texel.x, 0.0)).r;
    float hL = texture2D(u_provinceMap, uv - vec2(texel.x, 0.0)).r;
    float hU = texture2D(u_provinceMap, uv + vec2(0.0, texel.y)).r;
    float hD = texture2D(u_provinceMap, uv - vec2(0.0, texel.y)).r;

    // 简单梯度检测
    float grad = abs(hR - hL) + abs(hU - hD);
    return smoothstep(0.0, 0.1, grad);
}

// ============================================================
// HOI4 原版地形贴图采样
// ============================================================
vec2 getHoi4TerrainUv(vec2 uv) {
    // HOI4 colormap 分辨率是主地图的一半（2816x1024 vs 5632x2048）
    // 但 UV 空间一致，只需在 X 方向做循环以适配水平无缝卷轴。
    return vec2(fract(uv.x), clamp(uv.y, 0.0, 1.0));
}

vec3 getHoi4LandColor(vec2 uv, float height, vec3 normal) {
    vec2 tuv = getHoi4TerrainUv(uv);
    vec3 base = texture2D(u_terrainColormap, tuv).rgb;

    // 轻微地形调制，保留原版色图同时强化立体感
    float slope = 1.0 - clamp(normal.y, 0.0, 1.0);
    float ridgeShade = 1.0 - smoothstep(0.15, 0.80, slope) * 0.12;
    float highland = smoothstep(0.62, 0.95, height);
    vec3 highlandTint = mix(vec3(1.0), vec3(0.92, 0.95, 1.03), highland * 0.22);

    vec3 color = base * ridgeShade * highlandTint;

    // 低强度细节噪声，避免放大后过于平滑
    float detail = (noise2D(v_worldPos.xz * 8.0) - 0.5) * 0.03;
    color += vec3(detail);

    return color;
}

vec3 getHoi4WaterColor(vec2 uv) {
    vec2 tuv = getHoi4TerrainUv(uv);
    vec3 water = texture2D(u_waterColormap, tuv).rgb;

    // 保持 HOI4 水面主色，仅做轻微增益以适配当前光照与后处理
    return mix(water, water * 1.06, 0.35);
}

// ============================================================
// State 颜色生成（从 State LUT 颜色生成可视化颜色）
// ============================================================
vec3 stateColorToVisual(vec3 stateRgb) {
    // 新编码: R=高字节, G=低字节, B=0.502(128/255)
    // 从 R+G 还原 State ID 的归一化值，然后用黄金比例生成均匀色相
    float stateIdNorm = stateRgb.r + stateRgb.g / 256.0; // 0~1 范围的 ID
    float goldenRatio = 0.618033988749895;
    float hue = fract(stateIdNorm * 256.0 * goldenRatio); // 用黄金比例散列
    float sat = 0.35 + fract(stateIdNorm * 137.0) * 0.25;
    float val = 0.55 + fract(stateIdNorm * 89.0) * 0.30;

    // 简单 HSV 转 RGB
    vec3 c = vec3(hue * 6.0, sat, val);
    vec3 rgb = clamp(
        abs(mod(c.x + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0,
        0.0, 1.0
    );
    return c.z * mix(vec3(1.0), rgb, c.y);
}

// ============================================================
// HOI4 河流渲染（基于 rivers.bmp 调色板颜色）
// ============================================================
float isRgb8(vec3 rgb255, vec3 target255) {
    vec3 d = abs(rgb255 - target255);
    return 1.0 - step(0.5, d.x + d.y + d.z);
}

// 将 rivers.png 的像素颜色解码为河流强度（0=非河流）
float decodeRiverStrength(vec3 rgb) {
    vec3 c = floor(rgb * 255.0 + 0.5);

    // 背景色（非河流）
    float bg = 0.0;
    bg = max(bg, isRgb8(c, vec3(122.0, 122.0, 122.0)));
    bg = max(bg, isRgb8(c, vec3(255.0, 255.0, 255.0)));
    if (bg > 0.5) return 0.0;

    // 主干河流（深蓝）
    float major = 0.0;
    major = max(major, isRgb8(c, vec3(0.0, 0.0, 255.0)));
    major = max(major, isRgb8(c, vec3(0.0, 0.0, 200.0)));
    major = max(major, isRgb8(c, vec3(0.0, 0.0, 150.0)));
    major = max(major, isRgb8(c, vec3(0.0, 0.0, 100.0)));
    if (major > 0.5) return 1.0;

    // 支流（青蓝）
    float minor = 0.0;
    minor = max(minor, isRgb8(c, vec3(0.0, 225.0, 255.0)));
    minor = max(minor, isRgb8(c, vec3(0.0, 200.0, 255.0)));
    minor = max(minor, isRgb8(c, vec3(0.0, 100.0, 255.0)));
    if (minor > 0.5) return 0.62;

    // 少量标记色（河口/连接点）
    float marker = 0.0;
    marker = max(marker, isRgb8(c, vec3(0.0, 255.0, 0.0)));
    marker = max(marker, isRgb8(c, vec3(255.0, 0.0, 0.0)));
    marker = max(marker, isRgb8(c, vec3(255.0, 252.0, 0.0)));
    if (marker > 0.5) return 0.34;

    return 0.0;
}

float getRiverMask(vec2 uv) {
    vec2 texel = 1.0 / u_mapSize;

    // 中心采样：默认保持 1px 河道
    float center = decodeRiverStrength(texture2D(u_riversMap, uv).rgb);

    // 邻域采样：仅给“主干河流”极轻微扩展，形成主/支流粗细差
    float n  = decodeRiverStrength(texture2D(u_riversMap, uv + vec2(0.0, texel.y)).rgb);
    float s  = decodeRiverStrength(texture2D(u_riversMap, uv - vec2(0.0, texel.y)).rgb);
    float e  = decodeRiverStrength(texture2D(u_riversMap, uv + vec2(texel.x, 0.0)).rgb);
    float w  = decodeRiverStrength(texture2D(u_riversMap, uv - vec2(texel.x, 0.0)).rgb);
    float ne = decodeRiverStrength(texture2D(u_riversMap, uv + vec2(texel.x, texel.y)).rgb);
    float nw = decodeRiverStrength(texture2D(u_riversMap, uv + vec2(-texel.x, texel.y)).rgb);
    float se = decodeRiverStrength(texture2D(u_riversMap, uv + vec2(texel.x, -texel.y)).rgb);
    float sw = decodeRiverStrength(texture2D(u_riversMap, uv + vec2(-texel.x, -texel.y)).rgb);

    float majorCenter = step(0.95, center);
    float majorRing = max(
        max(step(0.95, n), step(0.95, s)),
        max(step(0.95, e), step(0.95, w))
    );
    float majorDiag = max(
        max(step(0.95, ne), step(0.95, nw)),
        max(step(0.95, se), step(0.95, sw))
    );

    float mask = center;
    // 保持细线前提下，让主干略有存在感
    mask = max(mask, majorRing * 0.20);
    mask = max(mask, majorDiag * 0.08);

    // 支流按中心像素可见性映射；主干使用扩展后 mask
    float aa = max(fwidth(mask), 0.0015);
    float minorMask = smoothstep(0.22 - aa, 0.64 + aa, center);
    float majorMask = smoothstep(0.34 - aa, 0.90 + aa, mask);

    // 主干权重更高，确保低对比地形（如法国内陆）也能看清河流
    float majorWeight = mix(0.22, 1.0, majorCenter);
    float riverMask = mix(minorMask, majorMask, majorWeight);
    return clamp(riverMask * 1.08, 0.0, 1.0);
}

vec3 applyRivers(vec3 baseColor, bool isSea, vec2 uv) {
    if (isSea) return baseColor;

    float riverMask = getRiverMask(uv);
    if (riverMask <= 0.001) return baseColor;

    // HOI4 风格：偏青蓝，主干更深
    vec3 riverDeep = vec3(0.04, 0.25, 0.50);
    vec3 riverLight = vec3(0.20, 0.60, 0.86);
    vec3 riverColor = mix(riverDeep, riverLight, riverMask);

    // 政治/行政模式下略增强河流对比（法国等低对比地形更明显）
    float modeBoost = 1.0;
    if (u_mapMode == 0) {
        modeBoost = 1.22;
    } else if (u_mapMode == 3) {
        modeBoost = 1.12;
    }
    float boostedMask = clamp(riverMask * modeBoost, 0.0, 1.0);

    // 提升可见性（不增加几何粗细）
    vec3 carved = baseColor * (1.0 - 0.20 * boostedMask);
    float blend = clamp(0.60 * boostedMask + 0.10 * boostedMask * boostedMask, 0.0, 0.88);
    vec3 mixed = mix(carved, riverColor, blend);

    // 轻微反光
    mixed += vec3(0.05, 0.10, 0.14) * (0.11 * boostedMask);
    return mixed;
}

// ============================================================
// 城市灯光（夜侧 + 掠射角增强）
// ============================================================
vec3 applyCityLights(vec3 baseColor, vec2 uv, vec3 normal, vec3 viewDir) {
    float cityMask = texture2D(u_cityLightsMap, getHoi4TerrainUv(uv)).r;
    cityMask = smoothstep(0.06, 0.92, cityMask);

    vec3 lightDir = normalize(vec3(0.5, 1.0, 0.3));
    float ndotl = clamp(dot(normalize(normal), lightDir), 0.0, 1.0);
    float nightFactor = 1.0 - ndotl;

    float viewGrazing = 1.0 - clamp(abs(normalize(viewDir).y), 0.0, 1.0);
    float intensity = cityMask * (0.18 + 0.82 * nightFactor) * (0.70 + 0.30 * viewGrazing);
    intensity *= u_cityLightsIntensity;

    vec3 cityGlow = vec3(1.00, 0.74, 0.42) * intensity;
    return baseColor + cityGlow;
}

// ============================================================
// 主函数
// ============================================================
void main() {
    // 读取当前像素所属 Province cell（按 texel 中心采样，避免线性过滤导致的颜色漂移）
    vec2 provinceCell = floor(v_uv * u_mapSize);
    vec2 provinceCenterUv = (clamp(provinceCell, vec2(0.0), u_mapSize - vec2(1.0)) + vec2(0.5)) / u_mapSize;

    // 获取 Province / Country / State / Strategic Region 颜色（统一使用 cell center）
    vec3 provinceRgb = sampleProvinceCell(provinceCell);
    vec3 countryColor = texture2D(u_countryLUT, provinceCenterUv).rgb;
    vec3 stateRgb = sampleStateCell(provinceCell);
    vec3 strategicRegionRgb = sampleStrategicRegionCell(provinceCell);

    // 判断是否海洋：使用顶点着色器插值的高度（与 3D 几何体完全一致）
    bool isSea = v_height < u_seaLevel;

    // 视线方向（从 varying 获取，已在顶点着色器中计算）
    vec3 viewDir = normalize(v_viewDir);

    // ==================== 基础颜色 ====================
    vec3 baseColor;

    if (u_mapMode == 0) {
        // === 政治模式 ===
        if (isSea) {
            baseColor = getHoi4WaterColor(v_uv);
        } else {
            vec3 terrainColor = getHoi4LandColor(v_uv, v_height, v_normal);
            float terrainLuma = dot(terrainColor, vec3(0.299, 0.587, 0.114));
            float slope = 1.0 - clamp(v_normal.y, 0.0, 1.0);

            // 政治模式仍保留国家着色，但以 HOI4 原版地形色图为底
            vec3 colorized = countryColor * mix(0.86, 1.18, terrainLuma);

            float sunTerm = clamp(dot(normalize(v_normal), normalize(vec3(0.5, 1.0, 0.3))), 0.0, 1.0);
            float reliefShade = mix(0.86, 1.10, sunTerm);
            float slopeDarken = smoothstep(0.18, 0.75, slope);
            reliefShade *= (1.0 - slopeDarken * 0.10);

            vec3 politicalColor = colorized * reliefShade;
            baseColor = mix(terrainColor, politicalColor, 0.62);

            float terrainDetail = (noise2D(v_worldPos.xz * 8.0) - 0.5) * 0.03;
            baseColor += vec3(terrainDetail);
        }
    } else if (u_mapMode == 1) {
        // === 地形模式 ===
        if (isSea) {
            baseColor = getHoi4WaterColor(v_uv);
        } else {
            baseColor = getHoi4LandColor(v_uv, v_height, v_normal);
        }
    } else if (u_mapMode == 2) {
        // === 高度图模式 ===
        // 用伪彩色代替纯灰度
        float h = v_height;
        if (h < u_seaLevel) {
            float t = h / u_seaLevel;
            baseColor = mix(vec3(0.0, 0.0, 0.2), vec3(0.1, 0.3, 0.6), t);
        } else {
            float t = (h - u_seaLevel) / (1.0 - u_seaLevel);
            if (t < 0.5) {
                baseColor = mix(vec3(0.2, 0.5, 0.1), vec3(0.8, 0.7, 0.2), t * 2.0);
            } else {
                baseColor = mix(vec3(0.8, 0.7, 0.2), vec3(1.0, 1.0, 1.0), (t - 0.5) * 2.0);
            }
        }
    } else {
        // === 行政区模式 (u_mapMode == 3) ===
        if (isSea) {
            baseColor = getHoi4WaterColor(v_uv);
        } else {
            vec3 terrainColor = getHoi4LandColor(v_uv, v_height, v_normal);
            // 从 State LUT 颜色生成视觉颜色
            vec3 stateVisualColor = stateColorToVisual(stateRgb);
            // State 颜色与地形混合
            baseColor = mix(terrainColor, stateVisualColor, 0.55);
            // 微妙的纹理保留
            float terrainDetail = noise2D(v_worldPos.xz * 8.0) * 0.03;
            baseColor += vec3(terrainDetail);
        }
    }

    // ==================== 河流叠加（仅陆地生效） ====================
    baseColor = applyRivers(baseColor, isSea, v_uv);

    // ==================== Blinn-Phong 光照（仅陆地） ====================
    if (!isSea) {
        vec3 lightDir = normalize(vec3(0.5, 1.0, 0.3));
        vec3 halfVec = normalize(lightDir + viewDir);

        // 环境光 / 漫反射（政治模式提高明暗对比，增强立体感）
        float ambient = 0.45;
        float diffuseStrength = 0.55;
        if (u_mapMode == 0) {
            ambient = 0.36;
            diffuseStrength = 0.66;
        } else if (u_mapMode == 3) {
            ambient = 0.40;
            diffuseStrength = 0.60;
        }

        float ndotl = max(dot(v_normal, lightDir), 0.0);
        float diffuse = ndotl * diffuseStrength;

        // 高光（仅雪山区域有明显高光）
        float shininess = 0.0;
        if (v_height > 0.85) {
            shininess = 32.0 * smoothstep(0.85, 0.95, v_height);
        }
        float specular = 0.0;
        if (shininess > 0.0) {
            specular = pow(max(dot(v_normal, halfVec), 0.0), shininess) * 0.25;
        }

        float lighting = ambient + diffuse;
        baseColor = baseColor * lighting + vec3(1.0, 0.98, 0.9) * specular;

        // 改进的 AO（基于法线 Y 分量和高度）
        float ao = mix(0.80, 1.0, smoothstep(-0.2, 0.6, v_normal.y));
        ao *= smoothstep(0.0, 0.15, v_height) * 0.15 + 0.85;
        if (u_mapMode == 0) {
            // 政治模式下额外增加坡面遮蔽，避免颜色“贴图感”
            float slope = 1.0 - clamp(v_normal.y, 0.0, 1.0);
            float reliefOcclusion = smoothstep(0.18, 0.72, slope);
            ao *= (1.0 - reliefOcclusion * 0.10);
        }
        baseColor *= ao;

        // Rim Lighting（边缘光，增强地形轮廓）
        float rim = pow(1.0 - max(dot(viewDir, v_normal), 0.0), 4.0);
        baseColor += vec3(0.10, 0.12, 0.18) * rim * 0.2;
    }

    // ==================== Strategic Region 级别高亮（最低优先级，海域限定） ====================
    if (isSea && u_hoveredStrategicRegionColor.r >= 0.0) {
        vec3 srHovDiff = abs(strategicRegionRgb - u_hoveredStrategicRegionColor);
        bool isStrategicRegionHovered = srHovDiff.r < 0.002 && srHovDiff.g < 0.002 && srHovDiff.b < 0.002;
        if (isStrategicRegionHovered && length(strategicRegionRgb) > 0.01) {
            float pulse = 0.5 + 0.5 * sin(u_time * 3.5);
            float strength = u_hoverStrength;
            float hoverIntensity = 0.14 + 0.06 * pulse;
            float srBdr = getStrategicRegionBorder(v_uv);
            if (srBdr > 0.0) {
                hoverIntensity += 0.10;
            }
            baseColor = mix(baseColor, vec3(0.85, 0.95, 1.0), hoverIntensity * strength);
        }
    }

    if (isSea && u_selectedStrategicRegionColor.r >= 0.0) {
        vec3 srSelDiff = abs(strategicRegionRgb - u_selectedStrategicRegionColor);
        bool isStrategicRegionSelected = srSelDiff.r < 0.002 && srSelDiff.g < 0.002 && srSelDiff.b < 0.002;
        if (isStrategicRegionSelected && length(strategicRegionRgb) > 0.01) {
            float strength = u_selectStrength;
            baseColor = mix(baseColor, vec3(0.55, 0.75, 1.0), 0.28 * strength);
            float srBdr = getStrategicRegionBorder(v_uv);
            if (srBdr > 0.0) {
                baseColor = mix(baseColor, vec3(0.70, 0.85, 1.0), 0.58 * strength);
            }
        }
    }

    // ==================== State 级别高亮（中优先级，陆地限定） ====================
    if (!isSea && u_hoveredStateColor.r >= 0.0) {
        vec3 stHovDiff = abs(stateRgb - u_hoveredStateColor);
        bool isStateHovered = stHovDiff.r < 0.002 && stHovDiff.g < 0.002 && stHovDiff.b < 0.002;
        if (isStateHovered && length(stateRgb) > 0.01) {
            float pulse = 0.5 + 0.5 * sin(u_time * 3.5);
            float strength = u_hoverStrength;
            float hoverIntensity = 0.18 + 0.08 * pulse;
            float stateBdr = getStateBorder(v_uv);
            if (stateBdr > 0.0) {
                hoverIntensity += 0.12;
            }
            baseColor = mix(baseColor, vec3(1.0, 1.0, 0.85), hoverIntensity * strength);
        }
    }

    if (!isSea && u_selectedStateColor.r >= 0.0) {
        vec3 stSelDiff = abs(stateRgb - u_selectedStateColor);
        bool isStateSelected = stSelDiff.r < 0.002 && stSelDiff.g < 0.002 && stSelDiff.b < 0.002;
        if (isStateSelected && length(stateRgb) > 0.01) {
            float strength = u_selectStrength;
            baseColor = mix(baseColor, vec3(1.0, 0.88, 0.30), 0.30 * strength);
            float stateBdr = getStateBorder(v_uv);
            if (stateBdr > 0.0) {
                baseColor = mix(baseColor, vec3(1.0, 0.92, 0.40), 0.60 * strength);
            }
        }
    }

    // ==================== Province 级别高亮（最高优先级） ====================
    if (u_hoveredColor.r >= 0.0) {
        vec3 provHovDiff = abs(provinceRgb - u_hoveredColor);
        bool isProvHovered = provHovDiff.r < 0.002 && provHovDiff.g < 0.002 && provHovDiff.b < 0.002;
        if (isProvHovered && length(provinceRgb) > 0.01) {
            float pulse = 0.5 + 0.5 * sin(u_time * 5.0);
            float strength = u_hoverStrength;
            baseColor = mix(baseColor, vec3(1.0, 1.0, 1.0), (0.15 + 0.1 * pulse) * strength);
        }
    }

    if (u_selectedColor.r >= 0.0) {
        vec3 provSelDiff = abs(provinceRgb - u_selectedColor);
        bool isProvSelected = provSelDiff.r < 0.002 && provSelDiff.g < 0.002 && provSelDiff.b < 0.002;
        if (isProvSelected && length(provinceRgb) > 0.01) {
            float strength = u_selectStrength;
            baseColor = mix(baseColor, vec3(1.0, 1.0, 1.0), 0.45 * strength);
        }
    }

    // ==================== 边界线渲染 ====================
    if (u_mapMode == 0) {
        // 政治模式边界线：国家 > State > 省份（三层优先级渲染）
        float countryBdr = getCountryBorder(v_uv);
        float countryGlow = getCountryBorderGlow(v_uv);
        float stateBdr = getStateBorder(v_uv);
        float strategicRegionBdr = getStrategicRegionBorder(v_uv);
        // 海域内改用 ID 稳定边界检测，避免低对比省份色导致断线
        float provinceBdr = isSea ? getProvinceBorderStable(v_uv) : getBorder(v_uv);

        // 国家边界：深色主线 + 柔和外发光（最高优先级）
        if (countryBdr > 0.0) {
            baseColor = mix(baseColor, vec3(0.08, 0.05, 0.03), 0.85 * countryBdr);
        } else if (countryGlow > 0.0) {
            baseColor = mix(baseColor, vec3(0.15, 0.10, 0.05), 0.15 * countryGlow);
        }

        // State 边界：细实线（不与国家边界重叠）
        float stateInkPol = pow(stateBdr, 0.84);
        if (stateInkPol > 0.0 && countryBdr < 0.35) {
            baseColor = mix(baseColor, vec3(0.09, 0.062, 0.036), 0.72 * stateInkPol);
        }

        // 国家与 State 交界增强：避免交界处“发灰/发淡”
        if (countryBdr > 0.14 && stateInkPol > 0.14) {
            float junction = min(countryBdr, stateInkPol);
            baseColor = mix(baseColor, vec3(0.03, 0.018, 0.012), 0.56 * junction);
        }

        // 省份边界：海域内增强完整性与可见性，陆地保持原有风格
        if (provinceBdr > 0.0 && (isSea || (countryBdr < 0.3 && stateBdr < 0.3))) {
            float provinceInk = isSea ? pow(provinceBdr, 0.84) : provinceBdr;
            vec3 provinceColor = isSea ? vec3(0.05, 0.08, 0.13) : vec3(0.07, 0.06, 0.05);
            float provinceStrength = isSea ? 0.58 : 0.24;
            baseColor = mix(baseColor, provinceColor, provinceStrength * provinceInk);
        }

        // 海域 Strategic Region 边界：只在海面绘制，避免污染陆地行政线
        if (isSea) {
            float srInk = pow(strategicRegionBdr, 0.78);
            if (srInk > 0.0) {
                // 整体加深主线，降低亮线占比，避免海域边界被冲淡
                baseColor = mix(baseColor, vec3(0.03, 0.055, 0.10), 0.74 * srInk);
                baseColor = mix(baseColor, vec3(0.40, 0.52, 0.66), 0.08 * srInk);
            }
        }
    } else if (u_mapMode == 1) {
        // 地形模式：省份细线 + 海域 Strategic Region 弱线
        float provinceBdr = isSea ? getProvinceBorderStable(v_uv) : getBorder(v_uv);
        if (provinceBdr > 0.0) {
            float provinceInk = isSea ? pow(provinceBdr, 0.84) : provinceBdr;
            float provinceStrength = isSea ? 0.30 : 0.11;
            baseColor = mix(baseColor, vec3(0.0), provinceStrength * provinceInk);
        }

        if (isSea) {
            float srBdr = getStrategicRegionBorder(v_uv);
            float srInk = pow(srBdr, 0.78);
            if (srInk > 0.0) {
                baseColor = mix(baseColor, vec3(0.10, 0.18, 0.28), 0.30 * srInk);
            }
        }
    } else if (u_mapMode == 2) {
        // 高度图模式：省份细线 + 海域 Strategic Region 弱线
        float provinceBdr = isSea ? getProvinceBorderStable(v_uv) : getBorder(v_uv);
        if (provinceBdr > 0.0) {
            float provinceInk = isSea ? pow(provinceBdr, 0.84) : provinceBdr;
            float provinceStrength = isSea ? 0.34 : 0.13;
            baseColor = mix(baseColor, vec3(0.0), provinceStrength * provinceInk);
        }

        if (isSea) {
            float srBdr = getStrategicRegionBorder(v_uv);
            float srInk = pow(srBdr, 0.78);
            if (srInk > 0.0) {
                baseColor = mix(baseColor, vec3(0.16, 0.24, 0.36), 0.34 * srInk);
            }
        }
    } else {
        // 行政区模式边界线：陆地国家 > State；海域 Strategic Region + 省份细线
        if (isSea) {
            float srBdr = getStrategicRegionBorder(v_uv);
            float srInk = pow(srBdr, 0.80);
            if (srInk > 0.0) {
                baseColor = mix(baseColor, vec3(0.03, 0.06, 0.11), 0.78 * srInk);
                baseColor = mix(baseColor, vec3(0.42, 0.55, 0.70), 0.08 * srInk);
            }

            float provinceBdr = getProvinceBorderStable(v_uv);
            if (provinceBdr > 0.0) {
                float provinceInk = pow(provinceBdr, 0.84);
                baseColor = mix(baseColor, vec3(0.05, 0.08, 0.13), 0.40 * provinceInk);
            }
        } else {
            float countryBdr = getCountryBorder(v_uv);
            float countryGlow = getCountryBorderGlow(v_uv);
            float stateBdr = getStateBorder(v_uv);

            // 国家边界（最粗）
            if (countryBdr > 0.0) {
                baseColor = mix(baseColor, vec3(0.05, 0.03, 0.02), 0.90 * countryBdr);
            } else if (countryGlow > 0.0) {
                baseColor = mix(baseColor, vec3(0.12, 0.08, 0.04), 0.25 * countryGlow);
            }

            // State 边界（实线，较粗）
            float stateInk = pow(stateBdr, 0.80);
            if (stateInk > 0.0 && countryBdr < 0.45) {
                baseColor = mix(baseColor, vec3(0.06, 0.04, 0.024), 0.95 * stateInk);
            }

            // 行政区模式下国家/State 交界处强对比压暗，确保远近都清晰
            if (countryBdr > 0.08 && stateInk > 0.08) {
                float junction = min(countryBdr, stateInk);
                baseColor = mix(baseColor, vec3(0.0, 0.0, 0.0), 0.82 * junction);
            }
        }
    }

    // ==================== 海岸线高亮 ====================
    if (u_mapMode == 0 || u_mapMode == 1 || u_mapMode == 3) {
        float coastDist = abs(v_height - u_seaLevel);
        if (coastDist < 0.015) {
            float coastLine = 1.0 - coastDist / 0.015;
            coastLine *= coastLine;
            baseColor = mix(baseColor, vec3(0.55, 0.60, 0.65), coastLine * 0.3);
        }
    }

    // ==================== 城市灯光（仅陆地，叠加在边界/高亮之后） ====================
    if (!isSea && (u_mapMode == 0 || u_mapMode == 1 || u_mapMode == 3)) {
        baseColor = applyCityLights(baseColor, v_uv, v_normal, viewDir);
    }

    // ==================== 大气散射 & 雾效 ====================
    vec3 lightDir = normalize(vec3(0.5, 1.0, 0.3));
    float fogDist = length(v_worldPos.xz - u_cameraPos.xz);

    // 视角因子：垂直俯视（viewDir.y≈1）时减弱雾效，倾斜视角时正常
    float viewAngleFactor = 1.0 - pow(abs(viewDir.y), 2.0); // 垂直时≈0，水平时≈1

    // 距离雾（受视角影响）
    float distFog = 1.0 - exp(-fogDist * fogDist * 0.000005);
    distFog = clamp(distFog * viewAngleFactor, 0.0, 0.50);

    // Rayleigh 散射近似：面向光源方向偏暖，背离偏蓝
    float sunDot = dot(normalize(v_worldPos - u_cameraPos), lightDir);
    vec3 fogColorWarm = vec3(0.35, 0.33, 0.38);
    vec3 fogColorCool = vec3(0.20, 0.25, 0.38);
    vec3 fogColor = mix(fogColorCool, fogColorWarm, max(sunDot * 0.5 + 0.5, 0.0));

    // 地平线雾（仅在倾斜视角时有效）
    float horizonFog = pow(1.0 - abs(viewDir.y), 10.0) * 0.25;

    float totalFog = clamp(distFog + horizonFog, 0.0, 0.55);
    baseColor = mix(baseColor, fogColor, totalFog);

    gl_FragColor = vec4(baseColor, 1.0);
}
