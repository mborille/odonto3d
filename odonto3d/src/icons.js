// Small, locally embedded icons. No font or network dependency.
const paths={
  layers:'<path d="m12 3 10 5-10 5L2 8l10-5ZM2 12l10 5 10-5M2 16l10 5 10-5"/>',
  sparkles:'<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3ZM20 2v4m-2-2h4"/>',
  cube:'<path d="m12 3 9 5v8l-9 5-9-5V8l9-5Z"/><path d="m3 8 9 5 9-5M12 13v8M7.5 5.5l9 5"/>',
  grid:'<rect x="3" y="3" width="7" height="7" rx="1.7"/><rect x="14" y="3" width="7" height="7" rx="1.7"/><rect x="3" y="14" width="7" height="7" rx="1.7"/><rect x="14" y="14" width="7" height="7" rx="1.7"/>',
  document:'<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9l-6-6Z"/><path d="M14 3v6h6M8 13h8M8 17h5"/>',
  plus:'<path d="M12 5v14M5 12h14"/>',
  import:'<path d="M12 3v12m-4-4 4 4 4-4M5 15v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4"/>',
  info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/>',
  arrow:'<path d="m9 5 7 7-7 7"/>',
  reset:'<path d="M3 10a9 9 0 1 1 2 8M3 4v6h6"/>',
  target:'<circle cx="12" cy="12" r="7"/><path d="M12 2v5m0 10v5M2 12h5m10 0h5"/>',
  ruler:'<path d="m4 15 11-11a2 2 0 0 1 3 0l2 2a2 2 0 0 1 0 3L9 20a2 2 0 0 1-3 0l-2-2a2 2 0 0 1 0-3ZM9 11l3 3m1-7 3 3m-11 5 3 3"/>',
  sliders:'<path d="M4 7h7m5 0h4M4 17h2m5 0h9"/><circle cx="13.5" cy="7" r="2.5"/><circle cx="8.5" cy="17" r="2.5"/>',
  shield:'<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z"/><path d="m8 12 3 3 5-6"/>',
  archive:'<rect x="4" y="3" width="16" height="18" rx="3"/><path d="M11 3v3h2v3h-2v3h2v3h-2v3h2M8 3v18"/>',
  folder:'<path d="M3 7V6a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"/>',
  files:'<rect x="7" y="7" width="13" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h2"/>',
  close:'<path d="m6 6 12 12M6 18 18 6"/>',
  trash:'<path d="M3 6h18M9 6V3h6v3M5 6l1 14h12l1-14M10 10v6m4-6v6"/>',
  plane:'<path d="m3 12 9-6 9 6-9 6-9-6Z"/><path d="M12 2v5m0 10v5"/>',
};
export function icon(name){if(!paths[name])throw new Error('Unknown icon: '+name);return `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]}</svg>`;}
