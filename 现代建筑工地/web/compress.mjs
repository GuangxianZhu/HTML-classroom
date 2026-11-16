// 把 ../blender/out 里的 glb 用 meshopt 压缩到 dist/，网页打包时塞进 index.html。
// 只量化 + 压缩，不合并、不删物体：每个物体的名字和 extras（stage / floor / kind）都要留着。
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { quantize, reorder, meshopt } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';
import fs from 'fs';

export async function compress(names = ['tower', 'zaoloji']) {
  await MeshoptEncoder.ready;
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
  fs.mkdirSync('dist', { recursive: true });
  for (const n of names) {
    const src = `../blender/out/${n}.glb`;
    const doc = await io.read(src);
    await doc.transform(
      reorder({ encoder: MeshoptEncoder }),
      quantize({ quantizePosition: 14, quantizeNormal: 8, quantizeTexcoord: 12 }),
      meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
    );
    const out = `dist/${n}.glb`;
    await io.write(out, doc);
    console.log(`${n}.glb ${(fs.statSync(src).size / 1048576).toFixed(2)} MB -> ${(fs.statSync(out).size / 1048576).toFixed(2)} MB`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) await compress();
