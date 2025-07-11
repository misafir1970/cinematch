interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
  // Add more custom env vars here...
  [key: string]: any;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// Make sure this file is included in the compilation by matching the tsconfig include patterns.