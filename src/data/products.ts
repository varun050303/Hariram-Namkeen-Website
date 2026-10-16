// products.ts — Single source of truth for Hariram Namkeen products
// Used by:
//   • /products/[slug].astro (Dedicated product pages)
//   • QuickViewModal.astro (1-Click Nutrition modal & global WhatsApp order hook)
//   • InteractiveHero.astro (Homepage Hero builder & 2x2 Bento Grid)
//   • sitemap.xml.ts (SEO sitemap)

export interface NutritionPer100g {
  energyKcal: number;
  proteinG: number;
  carbsG: number;
  sugarsG: number;
  totalFatG: number;
  saturatedFatG: number;
  mufaFatG: number;
  transFatG: number;
  cholesterolMg: number;
  sodiumMg: number;
}

export interface Product {
  slug: string;
  id: string;
  /** Full display name (H1, Quick-View title) */
  name: string;
  /** Short everyday name (badges, buttons, WhatsApp message) */
  shortName: string;
  hindiName: string;
  tagline: string;
  badge?: string;
  image: string;
  weightSingle: string;
  priceSingle: number;
  shortDesc: string;
  longDesc: string;
  tasteProfile: string;
  ingredients: {
    base: string;
    oil: string;
    spices: string;
    noNasties: string[];
  };
  trustHighlights: string[];
  nutritionPer100g: NutritionPer100g;
  /** true = signature variety inside The Special 4 Tasting Box */
  inBox: boolean;
}

export const BOX_OFFER = {
  name: 'The Special 4 Tasting Box',
  weight: '800g',
  packs: '4 × 200g',
  price: 499,
  shipping: 0,
  /** Standard shipping charged on a single pack */
  singleShipping: 50,
} as const;

/** 4 Clean-Label Trust Badges on every product */
export const TRUST_HIGHLIGHTS: string[] = [
  '100% Satvik (No Onion / No Garlic)',
  'Real Hing & Rock Salt (Sendha/Kala Namak)',
  '0% Palm Oil & 0% Commercial Pre-Mix Masala',
  'Small-Batch Hand-Fried in Heavy Iron Kadhais (FSSAI Licensed)',
];

const OIL = '100% Cold-Pressed Yellow Mustard Oil (Peeli Sarson Ka Tel)';

const NO_NASTIES = [
  'Palm Oil',
  'Commercial Pre-Mix Masala',
  'Onion & Garlic',
  'TBHQ & Chemical Preservatives',
  'Artificial Colours & Flavours',
];

export const products: Product[] = [
  {
    slug: 'dal-biji',
    id: 'dal-biji',
    name: 'Muzaffarnagar Signature Dal Biji',
    shortName: 'Dal Biji',
    hindiName: 'दाल बीजी',
    tagline: 'Traditional slow-fried moong dal with besan and magaz, made the Western UP way.',
    badge: 'Muzaffarnagar Signature',
    image: '/images/dal-bhiji.webp',
    weightSingle: '200g',
    priceSingle: 125,
    shortDesc: 'Crisp split-moong, besan and magaz fried in yellow mustard oil.',
    longDesc:
      "A staple of Muzaffarnagar and Western UP kitchens, Dal Biji takes patience and a halwai's feel for the oil. We soak split moong, drain it well and fry it with besan and muskmelon seeds (magaz) in 100% cold-pressed yellow mustard oil, then season it with roasted cumin, hing, and rock salt. The result is a deep, nutty crunch with no waxy aftertaste.",
    tasteProfile: 'Super-crisp lentil crunch, earthy roasted cumin, a golden mustard-oil finish.',
    ingredients: {
      base: 'Split Moong Lentils (Moong Dal), Besan (Gram Flour), Muskmelon Seeds (Magaz)',
      oil: OIL,
      spices: 'Roasted cumin, hing (asafoetida), turmeric, rock salt (sendha namak)',
      noNasties: NO_NASTIES,
    },
    trustHighlights: TRUST_HIGHLIGHTS,
    nutritionPer100g: {
      energyKcal: 528,
      proteinG: 15.8,
      carbsG: 42.4,
      sugarsG: 1.2,
      totalFatG: 32.8,
      saturatedFatG: 4.8,
      mufaFatG: 21.5,
      transFatG: 0.0,
      cholesterolMg: 0.0,
      sodiumMg: 480,
    },
    inBox: true,
  },
  {
    slug: 'aloo-bhujia',
    id: 'aloo-bhujia',
    name: 'Kadhai Crisp Aloo Bhujia',
    shortName: 'Aloo Bhujia',
    hindiName: 'आलू भुजिया',
    tagline: 'Melt-in-mouth potato and besan sev, fried fresh in yellow mustard oil.',
    badge: 'Kadhai Crisp',
    image: '/images/aloo_bhujia.webp',
    weightSingle: '200g',
    priceSingle: 125,
    shortDesc: 'Light, crackling potato-besan sev with ajwain and sun-dried pudina.',
    longDesc:
      'Commercial aloo bhujia is almost universally fried in industrial palm oil and stockpiled in godowns for months. Ours is crafted from freshly boiled potato mash, wholesome besan, and moth flour, lifted with digestive ajwain and fragrant sun-dried pudina, and hand-fried in small batches in heavy iron kadhais with 100% yellow mustard oil. It melts in your mouth and leaves zero heaviness.',
    tasteProfile: 'Delicate melt-in-mouth crunch, a warm hint of ajwain, cool pudina, balanced rock salt.',
    ingredients: {
      base: 'Boiled Potato Mash, Besan (Gram Flour) & Moth Flour, Sun-Dried Mint (Pudina)',
      oil: OIL,
      spices: 'Ajwain (carom seeds), roasted jeera, turmeric, Kashmiri red chilli, rock salt (sendha namak)',
      noNasties: NO_NASTIES,
    },
    trustHighlights: TRUST_HIGHLIGHTS,
    nutritionPer100g: {
      energyKcal: 535,
      proteinG: 11.4,
      carbsG: 44.2,
      sugarsG: 1.5,
      totalFatG: 34.6,
      saturatedFatG: 5.2,
      mufaFatG: 22.1,
      transFatG: 0.0,
      cholesterolMg: 0.0,
      sodiumMg: 620,
    },
    inBox: true,
  },
  {
    slug: 'chana-dal',
    id: 'chana-dal',
    name: 'Tangy Amchur Chana Dal',
    shortName: 'Chana Dal',
    hindiName: 'मसाला चना दाल',
    tagline: 'Bold, crunchy Bengal gram with tangy amchur and roasted jeera.',
    badge: 'Teatime Favorite',
    image: '/images/masala_chana_dal.webp',
    weightSingle: '200g',
    priceSingle: 125,
    shortDesc: 'Bold split Bengal gram with tangy hand-ground amchur and roasted jeera.',
    longDesc:
      'Masala Chana Dal is the quintessential North Indian teatime crunch. Bold split Bengal gram is fried in 100% yellow mustard oil until deeply resonant and crisp, then immediately dusted while hot in in-house stone-ground amchur, slow-roasted jeera, Kashmiri red chilli, and digestive black salt (kala namak). Tangy up front, wonderfully savoury throughout.',
    tasteProfile: 'Firm, toothsome crunch, tangy dry mango burst, warming jeera finish that pairs with masala chai.',
    ingredients: {
      base: 'Bold Split Bengal Gram (Chana Dal)',
      oil: OIL,
      spices: 'Hand-ground amchur (sun-dried raw mango), roasted jeera, Kashmiri red chilli, coriander, black salt (kala namak)',
      noNasties: NO_NASTIES,
    },
    trustHighlights: TRUST_HIGHLIGHTS,
    nutritionPer100g: {
      energyKcal: 495,
      proteinG: 16.5,
      carbsG: 51.2,
      sugarsG: 2.1,
      totalFatG: 24.5,
      saturatedFatG: 3.8,
      mufaFatG: 17.8,
      transFatG: 0.0,
      cholesterolMg: 0.0,
      sodiumMg: 560,
    },
    inBox: true,
  },
  {
    slug: 'spicy-malka',
    id: 'spicy-malka',
    name: 'Slow-Roasted Spicy Malka Masoor',
    shortName: 'Spicy Malka',
    hindiName: 'स्पाइसी मलका',
    tagline: 'Airy, crackling whole red lentils with Kashmiri lal mirch, clove, and kala namak.',
    badge: 'High Protein',
    image: '/images/masala_malka.webp',
    weightSingle: '200g',
    priceSingle: 125,
    shortDesc: 'Whole crimson lentils cooked airy and dusted with lal mirch, clove and kala namak.',
    longDesc:
      'Whole crimson masoor lentils are delicate yet packed with plant protein. We gently crisp them in 100% pure yellow mustard oil to achieve an extraordinarily light, airy puff, then toss them in real Kashmiri lal mirch, aromatic clove, roasted cumin, and digestive kala namak. Robust spice without any burning aftertaste.',
    tasteProfile: 'Light, airy, crackling lentil crunch, zesty spice bouquet with a distinct warming clove note.',
    ingredients: {
      base: 'Whole Crimson Lentils (Malka Masoor)',
      oil: OIL,
      spices: 'Kashmiri lal mirch, clove (laung), kala namak (black salt), roasted cumin, amchur',
      noNasties: NO_NASTIES,
    },
    trustHighlights: TRUST_HIGHLIGHTS,
    nutritionPer100g: {
      energyKcal: 488,
      proteinG: 17.2,
      carbsG: 52.0,
      sugarsG: 1.8,
      totalFatG: 23.4,
      saturatedFatG: 3.5,
      mufaFatG: 16.9,
      transFatG: 0.0,
      cholesterolMg: 0.0,
      sodiumMg: 540,
    },
    inBox: true,
  },
  {
    slug: 'shahi-dal-biji',
    id: 'shahi-dal-biji',
    name: 'Shahi Dal Biji',
    shortName: 'Shahi Dal Biji',
    hindiName: 'शाही दाल बीजी',
    tagline: 'A royal mix of crisp moong dal, fine sev, whole cashews and coconut slivers.',
    badge: 'Royal Gourmet',
    image: '/images/premium.webp',
    weightSingle: '250g',
    priceSingle: 200,
    shortDesc: 'Moong dal, fine sev, cashews, raisins and coconut slivers in mustard oil.',
    longDesc:
      'Shahi Dal Biji is hand-crafted for festive celebrations and special hospitality. Crisp slow-fried moong dal and delicate besan sev are gently tossed with whole roasted cashews, golden raisins, and toasted dry coconut slivers in 100% yellow mustard oil. Decadent crunch paired with subtle festive sweetness.',
    tasteProfile: 'Layered texture, buttery cashews, mild fruit sweetness, and authentic kadhai warmth.',
    ingredients: {
      base: 'Split Moong Dal, Fine Besan Sev, Whole Cashews (Kaju), Raisins (Kishmish), Dry Coconut (Kopra)',
      oil: OIL,
      spices: 'Heritage royal spice blend, rock salt (sendha namak)',
      noNasties: NO_NASTIES,
    },
    trustHighlights: TRUST_HIGHLIGHTS,
    nutritionPer100g: {
      energyKcal: 542,
      proteinG: 14.2,
      carbsG: 46.5,
      sugarsG: 6.8,
      totalFatG: 33.1,
      saturatedFatG: 6.1,
      mufaFatG: 19.8,
      transFatG: 0.0,
      cholesterolMg: 0.0,
      sodiumMg: 420,
    },
    inBox: false,
  },
  {
    slug: 'masala-peanuts',
    id: 'masala-peanuts',
    name: 'Masala Peanuts',
    shortName: 'Masala Peanuts',
    hindiName: 'मसाला मूंगफली',
    tagline: 'Bold crunchy peanuts with hing, black salt and Kashmiri chilli.',
    badge: 'Crunchy Special',
    image: '/images/masala_moongfali.webp',
    weightSingle: '250g',
    priceSingle: 100,
    shortDesc: 'Whole groundnuts fried crisp in mustard oil with hing and black salt.',
    longDesc:
      'Whole selected groundnuts slow-fried in 100% yellow mustard oil for an intense, earthy nutty crunch. Coated generously in real hing, Kashmiri chilli, black salt, and dry mango powder. Pure energy and satisfaction with zero palm-oil coating on the palate.',
    tasteProfile: 'Hearty roasted groundnut crunch, aromatic hing, and punchy black salt tang.',
    ingredients: {
      base: 'Select Indian Groundnuts (Peanuts)',
      oil: OIL,
      spices: 'Hing (asafoetida), Kashmiri chilli, black salt (kala namak), amchur',
      noNasties: NO_NASTIES,
    },
    trustHighlights: TRUST_HIGHLIGHTS,
    nutritionPer100g: {
      energyKcal: 567,
      proteinG: 22.4,
      carbsG: 21.0,
      sugarsG: 4.2,
      totalFatG: 44.5,
      saturatedFatG: 6.8,
      mufaFatG: 24.2,
      transFatG: 0.0,
      cholesterolMg: 0.0,
      sodiumMg: 510,
    },
    inBox: false,
  },
];

/** The four signature packs inside The Special 4 Tasting Box */
export const boxProducts: Product[] = products.filter((p) => p.inBox);

/** Helper to find product by slug or alias */
export function getProductBySlug(slug: string): Product | undefined {
  if (slug === 'dal-bhiji') slug = 'dal-biji';
  if (slug === 'masala-chana-dal') slug = 'chana-dal';
  if (slug === 'shahi-dal-bhiji') slug = 'shahi-dal-biji';
  return products.find((p) => p.slug === slug || p.id === slug);
}
