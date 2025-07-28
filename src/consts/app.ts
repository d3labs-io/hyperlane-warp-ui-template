import { Space_Grotesk as SpaceGrotesk } from 'next/font/google';
import { Color } from '../styles/Color';

export const MAIN_FONT = SpaceGrotesk({
  subsets: ['latin'],
  variable: '--font-main',
  preload: true,
  fallback: ['sans-serif'],
});
export const APP_NAME = 'Pruv Bridge';
export const APP_DESCRIPTION = 'A DApp for token bridge transfers';
export const APP_URL = 'hyperlane-warp-template.vercel.app';
export const BRAND_COLOR = Color.accent['500'];
export const BACKGROUND_COLOR = Color.accent['500'];
export const BACKGROUND_IMAGE = 'url(/backgrounds/main.svg)';
