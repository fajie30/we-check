const TEXT_EXTENSIONS = new Set([
  "html", "htm", "css", "scss", "sass", "less", "js", "mjs", "cjs", "jsx", "ts", "tsx",
  "php", "py", "sql", "json", "md", "txt", "xml", "yml", "yaml", "java", "c", "cpp", "cs",
  "rb", "go", "vue", "svelte", "ini", "env.example", "htaccess",
]);

const SKIP_DIRS = new Set([
  "node_modules", "vendor", ".git", ".svn", ".hg", "dist", "build", "out", ".next",
  ".nuxt", "coverage", "__pycache__", ".idea", ".vscode", "__macosx", "bower_components",
]);

const SKIP_FILES = new Set([
  "package-lock.json", "yarn.lock", "pnpm-lock.yaml", "composer.lock", "pipfile.lock",
  ".ds_store", "thumbs.db",
]);

export function extensionOf(path: string): string {
  const name = path.split("/").pop() ?? "";
  const i = name.lastIndexOf(".");
  return i <= 0 ? name.toLowerCase() : name.slice(i + 1).toLowerCase();
}

/** True if the file is source text worth sending to the grader. */
export function shouldInclude(path: string): boolean {
  const parts = path.split("/");
  const name = (parts[parts.length - 1] ?? "").toLowerCase();
  if (parts.slice(0, -1).some((d) => SKIP_DIRS.has(d.toLowerCase()))) return false;
  if (SKIP_FILES.has(name)) return false;
  if (/\.min\.(js|css)$/.test(name) || /\.map$/.test(name) || name.endsWith(".bundle.js")) {
    return false;
  }
  return TEXT_EXTENSIONS.has(extensionOf(path));
}

/** Heuristic binary check: NUL byte in the first 8 KB. */
export function looksBinary(data: Buffer): boolean {
  const n = Math.min(data.length, 8192);
  for (let i = 0; i < n; i++) if (data[i] === 0) return true;
  return false;
}
