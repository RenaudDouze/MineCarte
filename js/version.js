/*
 * Affiche le numéro de version du projet dans la barre latérale (VER-09).
 * La version vient de config.js, généré par scripts/build.mjs à partir du
 * dernier tag v* ; absente (serveur de développement), elle vaut « dev ».
 */
(function () {
  const el = document.getElementById('app-version');
  if (!el) return;
  el.textContent = `Version ${(window.MINECARTE_CONFIG || {}).version || 'dev'}`;
})();
