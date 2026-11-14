// 八个单页的文件名（相对 气体调压阀/ 目录）。文件名用 ASCII，链接和 bat 里都不会乱码。
import { MODELS } from './data.js';
export const pageFile = (k) => `pages/${MODELS[k].tag}-${k}.html`;
