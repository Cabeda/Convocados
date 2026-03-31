declare const __APP_VERSION__: string;

// Allow importing CSS files as side-effects (e.g. leaflet/dist/leaflet.css)
declare module "*.css" {
  const content: Record<string, string>;
  export default content;
}
