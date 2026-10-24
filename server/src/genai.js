// GenAI creative assistant — MOCK provider behind a pluggable interface.
// A real provider (LLM API) can be dropped in by implementing generate(brief, lang).
const TEMPLATES = [
  { match: ['coffee', 'cafe', 'espresso'], template: 'food', headline: (b) => 'Fresh Coffee, Zero Queue', sub: 'Order ahead and skip the line at the counter' },
  { match: ['perfume', 'fragrance', 'scent'], template: 'promo', headline: () => 'A Scent Worth Travelling For', sub: 'Duty-free exclusives with today-only savings' },
  { match: ['toy', 'kids', 'children', 'family'], template: 'promo', headline: () => 'Little Travellers, Big Smiles', sub: 'Family favourites with bundle savings today' },
  { match: ['lounge', 'relax', 'shower'], template: 'brand', headline: () => 'Your Quiet Corner Awaits', sub: 'Showers, fast Wi-Fi and calm before you fly' },
  { match: ['beach', 'holiday', 'maldives', 'island'], template: 'travel', headline: () => 'The Holiday Starts Here', sub: 'Inspiration and offers for your destination' },
  { match: ['headphone', 'tech', 'charger', 'gadget'], template: 'tech', headline: () => 'Travel Tech, Sorted', sub: 'Everything your journey needs, in one stop' },
];
const AR = { headline: 'عطر يستحق السفر من أجله', sub: 'عروض اليوم في السوق الحرة', cta: 'تسوق الآن' };
export class MockGenAiProvider {
  constructor() { this.name = 'mock-local'; }
  async generate(brief, lang = 'en') {
    const b = (brief || '').toLowerCase();
    const t = TEMPLATES.find(x => x.match.some(k => b.includes(k))) || { template: 'brand', headline: () => 'Made For Your Journey', sub: 'A partner offer selected for travellers like you' };
    const creative = lang === 'ar'
      ? { headline: AR.headline, sub: AR.sub, cta: AR.cta, template: t.template, lang: 'ar' }
      : { headline: t.headline(b), sub: t.sub, cta: 'Learn more', template: t.template, lang: 'en' };
    return { creative, provider: this.name, rationale: `Matched brief keywords to the "${t.template}" template; copy generated locally by the mock provider (pluggable interface). Inputs validated against trusted feed data before use.` };
  }
}
export const genAi = new MockGenAiProvider();
