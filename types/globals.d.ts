// Modules du site chargés par <script> (IIFE qui s'attachent à window).
declare const Noise: any;
declare const Utils: any;
declare const Terrain: any;
declare const Icons: any;
declare const Store: any;
declare const UndoStack: any;
declare const Backups: any;
declare const CloudSync: any;
declare const DIMENSIONS: string[];
interface Window {
  Noise: any;
  Utils: any;
  Terrain: any;
  Icons: any;
  Store: any;
  UndoStack: any;
  Backups: any;
  CloudSync: any;
  DIMENSIONS: string[];
  MINECARTE_CONFIG: { syncUrl?: string };
  MineCarte: any;
}
