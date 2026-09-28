// Modules du site chargés par <script> (IIFE qui s'attachent à window).
declare const Noise: any;
declare const Utils: any;
declare const Terrain: any;
declare const Icons: any;
declare const Backgrounds: any;
declare const Store: any;
declare const CloudSync: any;
declare const DIMENSIONS: string[];
interface Window {
  Noise: any;
  Utils: any;
  Terrain: any;
  Icons: any;
  Backgrounds: any;
  Store: any;
  CloudSync: any;
  DIMENSIONS: string[];
  MINECARTE_CONFIG: { syncUrl?: string };
  MineCarte: any;
}
