// 地形顶点着色器
uniform sampler2D u_heightmap;
uniform float u_heightScale;
uniform float u_displacementBias;
uniform vec2 u_texelSize;
uniform vec3 u_cameraPos;

varying vec2 v_uv;
varying float v_height;
varying vec3 v_worldPos;
varying vec3 v_normal;
varying vec3 v_viewDir;

void main() {
    v_uv = uv;

    // 高度值仍然从纹理读取（用于 fragment shader 的地形着色）
    float heightValue = texture2D(u_heightmap, uv).r;
    v_height = heightValue;

    // CPU 端已经完成了顶点 Y 位移，这里直接使用 position
    vec3 newPosition = position;

    v_worldPos = (modelMatrix * vec4(newPosition, 1.0)).xyz;

    // 视线方向（从顶点指向相机）
    v_viewDir = normalize(u_cameraPos - v_worldPos);

    // 计算法线（通过采样相邻高度值）
    float hL = texture2D(u_heightmap, uv + vec2(-u_texelSize.x, 0.0)).r * u_heightScale;
    float hR = texture2D(u_heightmap, uv + vec2(u_texelSize.x, 0.0)).r * u_heightScale;
    float hD = texture2D(u_heightmap, uv + vec2(0.0, -u_texelSize.y)).r * u_heightScale;
    float hU = texture2D(u_heightmap, uv + vec2(0.0, u_texelSize.y)).r * u_heightScale;

    vec3 calcNormal = normalize(vec3(hL - hR, 2.0, hD - hU));

    // 关键：输出世界空间法线，避免 normalMatrix(含 view) 导致相机角度改变时颜色漂移
    // 这里使用 modelMatrix 的 3x3 部分将局部法线变换到世界空间
    v_normal = normalize(mat3(modelMatrix) * calcNormal);

    gl_Position = projectionMatrix * modelViewMatrix * vec4(newPosition, 1.0);
}
