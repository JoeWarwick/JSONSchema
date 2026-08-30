import { reactRouter } from "@react-router/dev/vite";
import { defineConfig, loadEnv } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const apiProxyTarget = env.VITE_API_PROXY_TARGET || 'http://localhost:5080';
  const proxyTargetLogger = {
    name: 'dev-api-proxy-target-logger',
    configureServer() {
      console.info(`[vite] /api proxy target: ${apiProxyTarget}`);
    },
  };

  return {
    plugins: [reactRouter(), tsconfigPaths(), proxyTargetLogger],
    build: {
      sourcemap: true,
    },
    server: {
      proxy: {
        '/api': {
          target: apiProxyTarget,
          changeOrigin: true,
        },
      },
    },
  };
});
