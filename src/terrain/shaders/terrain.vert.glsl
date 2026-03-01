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

    // CPU 端已经完成了顶点 Y 位移，这里直接使用 position
    vec3 newPosition = position;

    // 由位移后高度反推归一化高度值，避免重复采样高度图
    v_height = clamp((newPosition.y - u_displacementBias) / max(u_heightScale, 0.0001), 0.0, 1.0);

    v_worldPos = (modelMatrix * vec4(newPosition, 1.0)).xyz;

    // 视线方向（从顶点指向相机）
    v_viewDir = normalize(u_cameraPos - v_worldPos);

    // 使用 CPU 预计算几何法线，避免每顶点 4 邻域高度采样
    // 输出世界空间法线，避免 normalMatrix(含 view) 导致相机角度改变时颜色漂移
    v_normal = normalize(mat3(modelMatrix) * normal);

    gl_Position = projectionMatrix * modelViewMatrix * vec4(newPosition, 1.0);
}
