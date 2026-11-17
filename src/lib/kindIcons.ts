import type { Kind } from './formats';

/**
 * One icon per file kind (24×24 path, filled with currentColor). The file cards, the project
 * list and the home page's format panel all draw these, so a kind looks the same everywhere.
 */
export const KIND_ICONS: Readonly<Record<Kind, string>> = {
  image: 'M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zm2 10 3.5-4.5 2.5 3 2-2.5L18 15H6zm2.5-7a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3z',
  audio: 'M9 18a3 3 0 1 1-2-2.83V6l11-2v10a3 3 0 1 1-2-2.83V7.4l-7 1.27V18z',
  video: 'M4 6h11a1 1 0 0 1 1 1v2.5l4-2.5a.6.6 0 0 1 1 .5v9a.6.6 0 0 1-1 .5l-4-2.5V17a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1z',
  pdf: 'M6 3h8l5 5v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zm7 1.5V9h4.5L13 4.5zM8 12h8v1.6H8V12zm0 3.2h8v1.6H8v-1.6zm0 3.2h5V20H8v-1.6z',
  doc: 'M6 3h9l4 4v14H6zM15 3v4h4M8 12h8M8 15h8M8 18h5',
};
