/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly APP_NAME: string;
  readonly APP_VERSION: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
