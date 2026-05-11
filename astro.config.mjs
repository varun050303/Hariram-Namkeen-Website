import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';

// https://astro.build/config
export default defineConfig({
    site: 'https://hariramnamkeen.com',
    integrations: [
        tailwind({
            applyBaseStyles: false,
        }),
    ],
    vite: {
        ssr: {
            noExternal: ['gsap'],
        },
    },
});
