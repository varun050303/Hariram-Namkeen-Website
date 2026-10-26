import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://hariramnamkeen.com',
  trailingSlash: 'always',
  vite: {
    plugins: [
      {
        name: 'dev-api-track-handler',
        configureServer(server) {
          server.middlewares.use((req, res, next) => {
            const url = req.url ? req.url.split('?')[0] : '';
            if (url === '/api/track') {
              res.statusCode = 204;
              res.setHeader('Access-Control-Allow-Origin', '*');
              res.end();
              return;
            }
            next();
          });
        },
      },
    ],
  },
});


