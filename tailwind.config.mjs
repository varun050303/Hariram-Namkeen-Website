/** @type {import('tailwindcss').Config} */
export default {
    content: ['./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}'],
    darkMode: 'class',
    theme: {
        extend: {
            colors: {
                primary: '#ec9213',
                'background-light': '#f8f7f6',
                'background-dark': '#221a10',
                'text-main': '#1b160d',
                'text-muted': '#9a794c',
            },
            fontFamily: {
                display: ['Epilogue', 'sans-serif'],
            },
            borderRadius: {
                DEFAULT: '0.5rem',
                lg: '1rem',
                xl: '1.5rem',
                full: '9999px',
            },
        },
    },
    plugins: [],
};
