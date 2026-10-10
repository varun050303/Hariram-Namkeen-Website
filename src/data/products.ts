export interface Product {
  slug: string;
  name: string;
  hindiName: string;
  tagline: string;
  price: number;
  weight: string;
  image: string;
  badge?: string;
  description: string;
  longDescription: string;
  ingredients: string[];
  healthBenefits: string[];
  tasteProfile: string;
  whatsappMessage: string;
}

export const products: Product[] = [
  {
    slug: 'aloo-bhujia',
    name: 'Aloo Bhujia',
    hindiName: 'आलू भुजिया',
    tagline: 'Melt-in-mouth potato & besan sev cooked in pure yellow mustard oil.',
    price: 100,
    weight: '250g',
    image: '/images/aloo_bhujia.webp',
    badge: 'New Launch',
    description: 'Crispy, light, golden aloo bhujia with subtle carom (ajwain) warmth and zero greasy mouthfeel. Hand-crafted in pure yellow mustard oil without palm oil or chemical preservatives.',
    longDescription: 'Unlike industrial factory aloo bhujia that relies on palm oil, artificial colors, and TBHQ preservatives, Hariram Aloo Bhujia is cooked fresh in small iron kadhais using cold-pressed yellow mustard oil. We combine high-grade potato flakes with pure Bengal gram besan, authentic rock salt, and freshly ground ajwain for a clean, non-acidic crunch that digests effortlessly.',
    ingredients: [
      'Potato Flakes',
      'Besan (Gram Flour)',
      'Pure Yellow Mustard Oil',
      'Turmeric & Kashmiri Red Chilli',
      'Ajwain (Carom Seeds) & Cumin',
      'Natural Rock Salt',
    ],
    healthBenefits: [
      'Zero Palm Oil & Zero Trans Fat',
      'Cooked in heart-friendly yellow mustard oil (rich in Omega-3)',
      'No artificial flavor enhancers or preservatives',
      'Made fresh this week in small batches',
    ],
    tasteProfile: 'Delicate crunch, warming hint of ajwain, subtle nutty aroma of mustard oil, balanced saltiness.',
    whatsappMessage: 'Hi Hariram Namkeen, I want to order Aloo Bhujia (250g - Rs 100). Please share payment and delivery details.',
  },
  {
    slug: 'dal-bhiji',
    name: 'Dal Bhiji',
    hindiName: 'दाल भीजी',
    tagline: 'Traditional slow-fried moong dal infused with kachi ghani mustard oil and heritage spices.',
    price: 125,
    weight: '250g',
    image: '/images/dal-bhiji.jpg',
    description: 'Heritage Uttar Pradesh style moong dal snack. Slow-roasted in pure yellow mustard oil for maximum crunch and natural protein richness.',
    longDescription: 'A timeless staple of Muzaffarnagar and Western UP households, Dal Bhiji requires patience and master halwai intuition. We soak select Grade-A moong dal, drain it thoroughly, and flash-fry it in pure yellow mustard oil at exact temperature curves. Lightly seasoned with hand-crushed roasted cumin, whole bay leaves, and Himalayan rock salt.',
    ingredients: [
      'Grade-A Moong Dal',
      'Pure Yellow Mustard Oil',
      'Roasted Cumin',
      'Turmeric Powder',
      'Himalayan Rock Salt',
      'Aromatic Bay Leaf',
    ],
    healthBenefits: [
      'High in plant-based protein & dietary fibre',
      'Zero palm oil, zero chemical bleaching',
      'Naturally light on digestion with roasted cumin',
      '100% preservative-free',
    ],
    tasteProfile: 'Super crisp lentil crunch, earthy aroma of bay leaf and cumin, golden mustard oil finish.',
    whatsappMessage: 'Hi Hariram Namkeen, I want to order Dal Bhiji (250g - Rs 125). Please share payment and delivery details.',
  },
  {
    slug: 'shahi-dal-bhiji',
    name: 'Shahi Dal Bhiji',
    hindiName: 'शाही दाल भीजी',
    tagline: 'Royal gourmet blend of crispy moong dal, fine sev, whole cashews, and coconut slices.',
    price: 200,
    weight: '250g',
    image: '/images/premium.jpg',
    badge: 'Royal Gourmet',
    description: 'Our most celebratory creation. Crisp moong dal and fine besan sev tossed with buttery whole cashews, raisins, dried coconut slivers, and royal spices.',
    longDescription: 'Shahi Dal Bhiji is crafted for festive gatherings and discerning namkeen connoisseurs. We fold slow-fried moong dal and fine artisanal besan sev together with premium whole roasted cashews, sun-dried raisins, and thinly sliced dry coconut. Cooked entirely in cold-pressed yellow mustard oil, it offers an aristocratic interplay of savory crunch and delicate fruit sweetness without cloying heaviness.',
    ingredients: [
      'Moong Dal & Handcrafted Besan Sev',
      'Pure Yellow Mustard Oil',
      'Premium Whole Cashews (Kaju)',
      'Seedless Raisins (Kishmish)',
      'Dry Sliced Coconut (Kopra)',
      'Royal Heritage Spice Blend',
      'Rock Salt',
    ],
    healthBenefits: [
      'Wholesome energy from premium nuts and dried fruits',
      'Rich in monounsaturated fats from yellow mustard oil & cashews',
      'Zero refined palm fat or chemical anti-caking agents',
      'Prepared in small artisanal batches',
    ],
    tasteProfile: 'Layered royal crunch, buttery richness from whole cashews, subtle sweetness of raisins, aromatic spices.',
    whatsappMessage: 'Hi Hariram Namkeen, I want to order Shahi Dal Bhiji (250g - Rs 200). Please share payment and delivery details.',
  },
  {
    slug: 'masala-chana-dal',
    name: 'Masala Chana Dal',
    hindiName: 'मसाला चना दाल',
    tagline: 'Crunchy Bengal gram seasoned with tangy amchur, cumin, and UP chaat spices.',
    price: 100,
    weight: '250g',
    image: '/images/masala_chana_dal.webp',
    badge: 'Best Seller',
    description: 'Protein-dense roasted Bengal gram tossed in tangy amchur and hand-ground spices in yellow mustard oil. Bold, crunchy, and irresistibly zesty.',
    longDescription: 'Masala Chana Dal is the quintessential North Indian teatime companion. We select plump chana dal grains, crisp-fry them in yellow mustard oil until intensely crunchy, and immediately toss them in a vibrant dry spice melange featuring tart raw mango powder (amchur), coriander seed, Kashmiri red chilli, and chat masala.',
    ingredients: [
      'Bengal Gram (Chana Dal)',
      'Pure Yellow Mustard Oil',
      'Kashmiri Chilli & Coriander',
      'Amchur (Dry Mango Powder)',
      'Handcrafted Chat Masala',
      'Black Salt & Rock Salt',
    ],
    healthBenefits: [
      'High protein & slow-digesting complex carbs',
      'Tangy spices stimulate digestive enzymes',
      'Zero palm oil, zero chemical food colors',
      'No stale warehouse storage',
    ],
    tasteProfile: 'Substantial firm crunch, tangy chaat burst, mild spice heat that pairs perfectly with hot masala chai.',
    whatsappMessage: 'Hi Hariram Namkeen, I want to order Masala Chana Dal (250g - Rs 100). Please share payment and delivery details.',
  },
  {
    slug: 'masala-peanuts',
    name: 'Masala Peanuts',
    hindiName: 'मसाला मूंगफली',
    tagline: 'Bold roasted peanuts spiked with aromatic hing, black salt, and Kashmiri chilli.',
    price: 100,
    weight: '250g',
    image: '/images/masala_moongfali.webp',
    badge: 'Crunchy Special',
    description: 'Selected whole groundnuts roasted crisp in yellow mustard oil and coated in hing, black salt, and hand-ground spices. The ultimate crunch.',
    longDescription: 'Peanuts fried in stale commercial palm oil often smell rancid and feel heavy on the throat. Hariram Masala Peanuts are prepared entirely differently: whole select groundnuts are slow-fried in pure yellow mustard oil, creating a nuttiness enhanced by pure compounded asafoetida (hing) and mineral-rich black salt.',
    ingredients: [
      'Select Indian Groundnuts (Peanuts)',
      'Pure Yellow Mustard Oil',
      'Pure Hing (Asafoetida)',
      'Kashmiri Chilli Powder',
      'Black Salt & Dry Mango Powder',
      'Hand-Ground Heritage Spices',
    ],
    healthBenefits: [
      'Naturally rich in plant protein and good monounsaturated fats',
      'Hing aids digestion and prevents bloating',
      'Free from chemical stabilizers, TBHQ, and artificial glaze',
      'Freshly roasted in small batches',
    ],
    tasteProfile: 'Deeply nutty crunch, pungent hing aroma, tangy black salt kick with lingering warmth.',
    whatsappMessage: 'Hi Hariram Namkeen, I want to order Masala Peanuts (250g - Rs 100). Please share payment and delivery details.',
  },
  {
    slug: 'spicy-malka',
    name: 'Spicy Malka',
    hindiName: 'स्पाइसी मलका',
    tagline: 'Crispy whole red lentils tossed in tangy UP chaat spices and yellow mustard oil.',
    price: 100,
    weight: '250g',
    image: '/images/masala_malka.webp',
    badge: 'New Launch',
    description: 'Whole masoor dal (malka) fried to a featherlight, ultra-crisp texture in mustard oil. Tossed in tangy secret UP street chaat seasoning.',
    longDescription: 'Spicy Malka takes whole red masoor lentils and elevates them into a crackling, addictive snack. Fried in hot yellow mustard oil until micro-puffed and light, then dusted with roasted cumin, amchur, black salt, and hand-blended chaat spices.',
    ingredients: [
      'Whole Red Lentils (Masoor Dal / Malka)',
      'Pure Yellow Mustard Oil',
      'Kashmiri Chilli & Roasted Cumin',
      'Amchur (Dry Mango Powder)',
      'Black Salt & Rock Salt',
      'Secret UP Chaat Spice Blend',
    ],
    healthBenefits: [
      'Rich in dietary fiber and plant protein',
      'Light, airy texture with lower oil absorption',
      'Zero palm oil or hydrogenated fats',
      'Fresh small-batch cooking',
    ],
    tasteProfile: 'Light, crackling crunch, tangy and zesty chaat punch, perfectly balanced spice heat.',
    whatsappMessage: 'Hi Hariram Namkeen, I want to order Spicy Malka (250g - Rs 100). Please share payment and delivery details.',
  },
];
