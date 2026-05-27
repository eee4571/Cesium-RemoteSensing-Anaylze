import { copyFileSync, cpSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

const rootDir = dirname(fileURLToPath(import.meta.url));
const cesiumBuildDir = join(rootDir, 'node_modules', 'cesium', 'Build', 'Cesium');
const cesiumPublicDir = join(rootDir, 'public', 'cesium');

function copyCesiumStaticAssets(): Plugin {
  return {
    name: 'copy-cesium-static-assets',
    buildStart() {
      rmSync(cesiumPublicDir, { recursive: true, force: true });
      mkdirSync(cesiumPublicDir, { recursive: true });
      for (const item of ['Assets', 'ThirdParty', 'Widgets', 'Workers']) {
        cpSync(join(cesiumBuildDir, item), join(cesiumPublicDir, item), { recursive: true });
      }
      copyFileSync(join(cesiumBuildDir, 'Cesium.js'), join(cesiumPublicDir, 'Cesium.js'));
    },
  };
}

export default defineConfig({
  plugins: [react(), copyCesiumStaticAssets()],
});
