/** The prototype's element lookup. Every id comes from index.html. */
export const $ = <T extends HTMLElement = HTMLElement>(id: string): T =>
  document.getElementById(id) as T;
