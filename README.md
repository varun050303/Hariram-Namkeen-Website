# Hariram Namkeen - Astro Migration

This is the Astro-based version of the Hariram Namkeen website, featuring SEO optimization, JSON-based content management, and modern best practices.

## 🚀 Project Structure

```
/
├── public/
│   ├── images/          # Product and content images
│   └── robots.txt       # SEO robots file
├── src/
│   ├── components/      # Reusable Astro components
│   ├── layouts/         # Page layouts with SEO
│   ├── pages/           # Astro pages
│   ├── data/            # JSON content files
│   └── styles/          # Global CSS
├── astro.config.mjs     # Astro configuration
├── tailwind.config.mjs  # Tailwind CSS configuration
└── package.json
```

## 📦 Installation

**Note:** This project requires Node.js and npm to be installed.

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview
```

## 🎨 Features

- **SEO Optimized**: Comprehensive meta tags, Open Graph, Twitter Cards, structured data (JSON-LD)
- **JSON-Based Content**: All content managed through JSON files in `src/data/`
- **Component Architecture**: Reusable Astro components for maintainability
- **Responsive Design**: Mobile-first design with Tailwind CSS
- **GSAP Animations**: Smooth scroll-triggered animations
- **Sitemap**: Auto-generated sitemap for search engines
- **Type Safety**: TypeScript configuration for better development experience

## 📝 Content Management

All website content is managed through JSON files in the `src/data/` directory:

- `site.json` - Site metadata, SEO settings, business information
- `navigation.json` - Navigation menu and footer links
- `products.json` - Product catalog with descriptions and pricing
- `features.json` - Features and benefits content
- `content.json` - Page sections content (hero, story, kitchen, etc.)

## 🔧 Configuration

### Update Site URL

Edit `astro.config.mjs` and `src/data/site.json` to set your actual domain:

```javascript
// astro.config.mjs
export default defineConfig({
  site: 'https://yourdomain.com',
  // ...
});
```

### Customize Design

The design system is configured in `tailwind.config.mjs`:

- Colors: Primary, background, text colors
- Fonts: Typography settings
- Border radius: Rounded corners

## 📄 License

© 2024 Hariram Foods. All rights reserved.
