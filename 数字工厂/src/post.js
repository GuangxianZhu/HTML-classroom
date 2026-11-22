// 70-post：4× MSAA → bloom → ACES 输出 → 移轴 / 暗角 / 静态亮度遮罩颗粒
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';

const FinalShader = {
  uniforms: { tDiffuse: { value: null }, uRes: { value: new THREE.Vector2(1, 1) }, uTilt: { value: 1 }, uVig: { value: 1 }, uGrain: { value: 1 }, uPR: { value: 1 } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
  fragmentShader: `uniform sampler2D tDiffuse; uniform vec2 uRes; uniform float uTilt; uniform float uVig; uniform float uGrain; uniform float uPR; varying vec2 vUv;
    float h(vec2 p){ vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      // 轻微移轴：上下边缘模糊
      float t = smoothstep(0.22, 0.5, abs(vUv.y - 0.52)) * uTilt;
      if (t > 0.01) {
        vec2 px = 1.0 / uRes * uPR * 1.6 * t;
        vec4 acc = c;
        acc += texture2D(tDiffuse, vUv + vec2( 1.0, 0.0)*px); acc += texture2D(tDiffuse, vUv + vec2(-1.0, 0.0)*px);
        acc += texture2D(tDiffuse, vUv + vec2( 0.0, 1.0)*px); acc += texture2D(tDiffuse, vUv + vec2( 0.0,-1.0)*px);
        acc += texture2D(tDiffuse, vUv + vec2( 0.7, 0.7)*px*1.6); acc += texture2D(tDiffuse, vUv + vec2(-0.7, 0.7)*px*1.6);
        acc += texture2D(tDiffuse, vUv + vec2( 0.7,-0.7)*px*1.6); acc += texture2D(tDiffuse, vUv + vec2(-0.7,-0.7)*px*1.6);
        c = acc / 9.0;
      }
      // 暗角
      vec2 d = (vUv - 0.5) * vec2(uRes.x / uRes.y, 1.0);
      float v = smoothstep(1.05, 0.25, length(d));
      c.rgb *= mix(1.0, mix(0.52, 1.0, v), uVig);
      // 静态颗粒：只按像素坐标取值（不随时间变），并按亮度遮罩，暗背景不撒
      float lum = dot(c.rgb, vec3(0.299, 0.587, 0.114));
      float g = h(floor(gl_FragCoord.xy / max(1.0, uPR * 0.75))) - 0.5;
      c.rgb += g * 0.05 * uGrain * smoothstep(0.06, 0.32, lum) * (1.0 - smoothstep(0.75, 1.0, lum));
      gl_FragColor = vec4(c.rgb, 1.0);
    }`,
};

export function createPost(renderer, scene, camera, opt) {
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: opt.lq ? 0 : 4 });
  const composer = new EffectComposer(renderer, rt);
  composer.setPixelRatio(renderer.getPixelRatio());
  composer.setSize(window.innerWidth, window.innerHeight);
  const rp = new RenderPass(scene, camera);
  composer.addPass(rp);
  const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.55, 0.55, 1.0);
  composer.addPass(bloom);
  // 截掉 bloom 的超远低电平尾巴：暗背景不因画面别处的火花/信标变化而在 1 LSB 上来回跳
  bloom.compositeMaterial.fragmentShader = bloom.compositeMaterial.fragmentShader.replace(/texture2D\(blurTexture5, vUv\) \);\s*\}/, 'texture2D(blurTexture5, vUv) );\n gl_FragColor.rgb = max(gl_FragColor.rgb - vec3(0.0022), vec3(0.0));\n}');
  bloom.compositeMaterial.needsUpdate = true;
  composer.addPass(new OutputPass());
  const fin = new ShaderPass(FinalShader);
  composer.addPass(fin);
  const resize = () => {
    composer.setPixelRatio(renderer.getPixelRatio());
    composer.setSize(window.innerWidth, window.innerHeight);
    const s = renderer.getDrawingBufferSize(new THREE.Vector2());
    fin.uniforms.uRes.value.set(s.x, s.y); fin.uniforms.uPR.value = renderer.getPixelRatio();
  };
  resize();
  return { composer, bloom, fin, resize, render: () => composer.render() };
}
