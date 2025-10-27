declare module "virtual:pwa-register" {
  export function registerSW(options?: Record<string, unknown>): () => void;
}

declare module "virtual:pwa-register/auto" {
  export function registerSW(options?: Record<string, unknown>): () => void;
}
