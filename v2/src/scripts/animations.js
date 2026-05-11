// ── Hariram Namkeen — GSAP Animations
// Runs client-side only. Called from index.astro <script>
// Requires GSAP + ScrollTrigger loaded via CDN in BaseLayout.

export function initAnimations() {
gsap.registerPlugin(ScrollTrigger);

// ── CURSOR (quickTo for performance) ─────────────────────────
(function() {
  if (window.innerWidth <= 768) return;
  const dot  = document.getElementById('cursor-dot');
  const ring = document.getElementById('cursor-ring');
  if (!dot || !ring) return;

  // quickTo is the fastest way to update position
  const moveDot  = gsap.quickTo(dot,  'x', {duration:.08, ease:'none'});
  const moveDotY = gsap.quickTo(dot,  'y', {duration:.08, ease:'none'});
  const moveRing  = gsap.quickTo(ring, 'x', {duration:.22, ease:'power2.out'});
  const moveRingY = gsap.quickTo(ring, 'y', {duration:.22, ease:'power2.out'});

  window.addEventListener('mousemove', e => {
    moveDot(e.clientX);
    moveDotY(e.clientY);
    moveRing(e.clientX);
    moveRingY(e.clientY);
  });

  // cursor states
  const hoverEls = document.querySelectorAll('a, button, [data-tilt], [data-magnetic]');
  hoverEls.forEach(el => {
    el.addEventListener('mouseenter', () => document.body.classList.add('cursor-hover'));
    el.addEventListener('mouseleave', () => document.body.classList.remove('cursor-hover'));
  });

  // dark section cursor
  const darkSections = document.querySelectorAll('#oil-truth, .platforms-section, .process-section, footer');
  darkSections.forEach(sec => {
    ScrollTrigger.create({
      trigger: sec,
      start: 'top center',
      end: 'bottom center',
      onEnter: () => document.body.classList.add('cursor-dark'),
      onLeave: () => document.body.classList.remove('cursor-dark'),
      onEnterBack: () => document.body.classList.add('cursor-dark'),
      onLeaveBack: () => document.body.classList.remove('cursor-dark'),
    });
  });

  // hide when leaving window
  document.addEventListener('mouseleave', () => {
    gsap.to([dot, ring], {opacity:0, duration:.2});
  });
  document.addEventListener('mouseenter', () => {
    gsap.to([dot, ring], {opacity:1, duration:.2});
  });
})();

// ── SCROLL PROGRESS BAR ───────────────────────────────────────
(function() {
  const bar = document.getElementById('scroll-progress');
  ScrollTrigger.create({
    start: 'top top',
    end: 'bottom bottom',
    onUpdate: self => {
      gsap.set(bar, {width: (self.progress * 100) + '%'});
    }
  });
})();

// ── HEADER TRANSPARENT → FROSTED GLASS ───────────────────────
ScrollTrigger.create({
  start: 80,                // 80px from top
  onEnter:    () => document.getElementById('header').classList.add('scrolled'),
  onLeaveBack: () => document.getElementById('header').classList.remove('scrolled'),
});

// ── HERO ENTRANCE ─────────────────────────────────────────────
gsap.set(['#h-origin','#h-sub','#h-pill','#h-btns','#h-trust',
          '#hl1','#hl2','#hl3'], {opacity:0});
gsap.set(['#hl1','#hl2','#hl3'], {y:'110%'});
gsap.set(['#h-origin','#h-sub','#h-pill','#h-btns','#h-trust'], {y:24});

gsap.set('.hero-stat', {opacity:0, y:20});

const heroTl = gsap.timeline({
  defaults:{ ease:'power3.out' },
  delay:.15
});
heroTl
  .to('#h-origin',     {opacity:1, y:0, duration:.6})
  .to(['#hl1','#hl2','#hl3'], {y:'0%', opacity:1, duration:1.1, stagger:.12, ease:'expo.out'}, '-=.3')
  .to('#h-sub',        {opacity:1, y:0, duration:.8}, '-=.6')
  .to('#h-pill',       {opacity:1, y:0, duration:.6}, '-=.5')
  .to('#h-btns',       {opacity:1, y:0, duration:.6}, '-=.5')
  .to('#h-trust',      {opacity:1, y:0, duration:.6}, '-=.4')
  .to('.hero-stat',    {opacity:1, y:0, duration:.5, stagger:.08}, '-=.6');

// ── HERO PARALLAX (scrub = true is most reliable) ─────────────
gsap.to('#hero-parallax', {
  yPercent: 20,
  ease: 'none',
  scrollTrigger: {
    trigger: '.hero',
    start: 'top top',
    end: 'bottom top',
    scrub: true
  }
});

// ── MARQUEE SPEED REACTS TO SCROLL ───────────────────────────
const mq = document.querySelector('.marquee-track');
let lastVel = 0;
ScrollTrigger.create({
  trigger: '.marquee',
  start: 'top bottom', end: 'bottom top',
  onUpdate(self) {
    const vel = self.getVelocity();
    const dur = Math.max(6, 22 - Math.abs(vel) * 0.012);
    mq.style.animationDuration = dur + 's';
  }
});

// ── PINNED OIL TRUTH + COMPARE ROWS STAGGER IN ───────────────
// The compare rows animate in as you scroll through the pinned section
const rows = gsap.utils.toArray('[data-row]');
const rowsTl = gsap.timeline({ paused:true });
rows.forEach((row, i) => {
  rowsTl.fromTo(row,
    { opacity:0, x:28 },
    { opacity:1, x:0, duration:.45, ease:'power2.out' },
    i * .12
  );
});

ScrollTrigger.create({
  trigger: '#oil-truth',
  start: 'top top',
  end: '+=200%',
  pin: true,
  anticipatePin: 1,
  scrub: .5,
  animation: rowsTl,
  onUpdate: self => {
    // animate oil counter
    const count = (self.progress * 3).toFixed(1);
    document.getElementById('omega-count').textContent = count + 'x';
  }
});

// ── OIL LEFT CONTENT REVEAL ───────────────────────────────────
gsap.fromTo('.oil-left > *',
  { opacity:0, y:32 },
  { opacity:1, y:0, duration:.8, stagger:.15, ease:'power2.out',
    scrollTrigger:{ trigger:'#oil-truth', start:'top 70%', once:true } }
);

// ── PRODUCT CARDS: STAGGER + 3D TILT ─────────────────────────
const pcards = gsap.utils.toArray('[data-tilt]');
gsap.fromTo(pcards,
  { opacity:0, y:60, scale:.95 },
  { opacity:1, y:0, scale:1, duration:.7, stagger:.1, ease:'expo.out',
    scrollTrigger:{ trigger:'.products-grid', start:'top 80%', once:true } }
);

pcards.forEach(card => {
  card.addEventListener('mousemove', e => {
    const r = card.getBoundingClientRect();
    const x = (e.clientX - r.left - r.width/2)  / r.width;
    const y = (e.clientY - r.top  - r.height/2) / r.height;
    gsap.to(card, {
      rotateY: x * 12, rotateX: -y * 12,
      transformPerspective: 900, scale:1.03,
      boxShadow: `${x*14}px ${y*14}px 36px rgba(107,19,19,.14)`,
      duration:.35, ease:'power2.out'
    });
  });
  card.addEventListener('mouseleave', () => {
    gsap.to(card, {
      rotateY:0, rotateX:0, scale:1,
      boxShadow:'0 4px 8px rgba(0,0,0,.05)',
      duration:.6, ease:'elastic.out(1,.7)'
    });
  });
});

// ── MAGNETIC BUTTONS ──────────────────────────────────────────
document.querySelectorAll('[data-magnetic]').forEach(el => {
  el.addEventListener('mousemove', e => {
    const r = el.getBoundingClientRect();
    const x = e.clientX - r.left - r.width/2;
    const y = e.clientY - r.top  - r.height/2;
    gsap.to(el, { x: x*.32, y: y*.32, duration:.3, ease:'power2.out' });
  });
  el.addEventListener('mouseleave', () => {
    gsap.to(el, { x:0, y:0, duration:.7, ease:'elastic.out(1,.5)' });
  });
});

// ── PLATFORM CARDS ENTRANCE ───────────────────────────────────
gsap.fromTo('.platform-card',
  { opacity:0, y:32 },
  { opacity:1, y:0, duration:.6, stagger:.08, ease:'back.out(1.5)',
    scrollTrigger:{ trigger:'.platforms-grid', start:'top 80%', once:true } }
);

// ── STORY SECTION ─────────────────────────────────────────────
gsap.fromTo('.story-img-main',
  { opacity:0, scale:.92, y:40 },
  { opacity:1, scale:1, y:0, duration:1, ease:'expo.out',
    scrollTrigger:{ trigger:'#story', start:'top 75%', once:true } }
);
gsap.fromTo('.story-quote-card',
  { opacity:0, x:24, y:24 },
  { opacity:1, x:0, y:0, duration:.8, ease:'back.out(1.7)',
    scrollTrigger:{ trigger:'#story', start:'top 65%', once:true } }
);
gsap.fromTo('.story-content > *',
  { opacity:0, x:32 },
  { opacity:1, x:0, duration:.7, stagger:.15, ease:'power2.out',
    scrollTrigger:{ trigger:'.story-content', start:'top 75%', once:true } }
);
gsap.fromTo('.milestone',
  { opacity:0, y:20 },
  { opacity:1, y:0, duration:.5, stagger:.1, ease:'back.out(1.5)',
    scrollTrigger:{ trigger:'.story-milestones', start:'top 85%', once:true } }
);

// Text highlight marks
document.querySelectorAll('.hl-mark').forEach(mark => {
  ScrollTrigger.create({
    trigger: mark, start:'top 80%', once:true,
    onEnter: () => mark.classList.add('lit')
  });
});

// ── PROCESS LINE DRAW ON SCROLL ───────────────────────────────
const steps = document.querySelectorAll('[data-step]');
gsap.to('#proc-line', {
  width:'100%', ease:'none',
  scrollTrigger:{
    trigger:'#proc-steps',
    start:'top 65%', end:'top 20%',
    scrub:.8,
    onUpdate(self) {
      steps.forEach((s, i) => {
        s.classList.toggle('lit', self.progress >= (i+1)/steps.length * .9);
      });
    }
  }
});
gsap.fromTo('[data-step]',
  { opacity:0, y:36 },
  { opacity:1, y:0, duration:.7, stagger:.15, ease:'power2.out',
    scrollTrigger:{ trigger:'#proc-steps', start:'top 80%', once:true } }
);

// ── SECTION HEADINGS FADE UP ──────────────────────────────────
document.querySelectorAll('.sec-title,.platforms-hl,.oil-hl').forEach(el => {
  gsap.fromTo(el,
    { opacity:0, y:28 },
    { opacity:1, y:0, duration:.8, ease:'power3.out',
      scrollTrigger:{ trigger:el, start:'top 88%', once:true } }
  );
});

// ── SMOOTH ANCHOR SCROLL ──────────────────────────────────────
document.querySelectorAll('a[href^="#"]').forEach(a => {
  a.addEventListener('click', e => {
    const t = document.querySelector(a.getAttribute('href'));
    if (t) { e.preventDefault(); t.scrollIntoView({behavior:'smooth', block:'start'}); }
  });
});

// ── REDUCED MOTION RESPECT ────────────────────────────────────
if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
  gsap.globalTimeline.timeScale(10);
  ScrollTrigger.getAll().forEach(st => st.kill());
}

}
