import type { Config } from 'tailwindcss';

/**
 * Palette is deliberately utilitarian: a cool "steel counter" neutral ramp,
 * a petrol-teal primary (so that green/red stay reserved for the FSSAI
 * veg / non-veg marks), and marigold for held / pending states.
 */
const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: { DEFAULT: '#0F1417', soft: '#3C464C', mute: '#6B7780' },
        counter: { DEFAULT: '#EEF1F2', line: '#D6DCDF', card: '#FFFFFF', deep: '#DCE3E5' },
        primary: { DEFAULT: '#0E5C63', dark: '#0A464B', light: '#E3F0F1' },
        marigold: { DEFAULT: '#C97A0A', light: '#FDF1DC' },
        veg: '#1B7F3B',
        nonveg: '#B3261E',
      },
      fontFamily: {
        sans: ['system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'DejaVu Sans Mono', 'monospace'],
      },
      borderRadius: { sm: '3px', DEFAULT: '4px', md: '5px', lg: '6px' },
      boxShadow: { panel: '0 1px 0 rgba(15,20,23,0.06), 0 1px 3px rgba(15,20,23,0.08)' },
      gridTemplateColumns: {
        /**
         * The Orders list from `md` up: bill · type/customer · items · total ·
         * payment · status · actions. Below `md` the same rows stack into cards.
         *
         * Every track is content-independent — `minmax(0,Nfr)` and fixed widths,
         * never `auto` — because the header and each row are separate grid
         * containers. A track sized to its own content resolves differently in
         * each of them, which is exactly how the header ends up floating half a
         * column away from the values it labels.
         */
        orders: 'minmax(0,1.15fr) minmax(0,1.3fr) 3rem minmax(0,.9fr) 7rem 7rem 21.5rem',
        /**
         * The Menu items list from `md` up, same rules as `orders`:
         * code · item · category · price · tax · sizes · in stock · on menu · edit
         */
        menu: '4.5rem minmax(0,1.6fr) minmax(0,.9fr) 5.5rem 4rem minmax(0,.9fr) 6.5rem 5.5rem 4rem',
      },
    },
  },
  plugins: [],
};
export default config;
