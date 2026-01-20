import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';
import sitemap from '@astrojs/sitemap';

// https://astro.build/config
export default defineConfig({
    site: 'https://hariramnamkeen.com', // Update with actual domain
    integrations: [
        tailwind({
            applyBaseStyles: false,
        }),
        sitemap(),
    ],
    vite: {
        ssr: {
            noExternal: ['gsap'],
        },
    },
});
