/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_ACCESSPATH_LAUNCH_TOKEN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
