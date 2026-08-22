/**
 * 修复 Vite 8（rolldown-vite）生产构建在 @mlc-ai/web-llm 上的栈溢出崩溃
 * （RangeError: Maximum call stack size exceeded，见 vitejs/vite#21696）。
 *
 * 背景：@mlc-ai/web-llm@0.2.84 的 lib/index.js（约 6.5MB）内唯一 `import.meta.url`
 * 出现在一行 JSDoc 注释里（new URL('./worker.ts', import.meta.url)），恰好命中 Vite
 * `vite:asset-import-meta-url` 插件的 code 过滤器，导致其对整个大文件执行
 * stripLiteral（jsTokens）→ 栈溢出（Linux/Vercel 必现）。
 *
 * 处理：在 pre 阶段把该模式中和为 document.baseURI，后续插件过滤器不再命中，
 * 从而跳过 stripLiteral。对运行时零影响（该模式仅存在于注释；document.baseURI 与
 * import.meta.url 在浏览器解析相对资源 URL 时语义等价）。
 */

export function isWebllmIndexJs(id: string): boolean {
  return /[\\/]@mlc-ai[\\/]web-llm[\\/]lib[\\/]index\.js$/.test(id)
}

// 与 Vite `vite:asset-import-meta-url` 的 assetImportMetaUrlRE 保持一致
// （`new URL(<字符串字面量>, import.meta.url)`），仅用于中和命中点。
const IMPORT_META_URL_PATTERN
  = /new\s+URL\s*\(\s*('[^']+'|"[^"]+"|`[^`]+`)\s*,\s*import\.meta\.url/g

export function neutralizeImportMetaUrl(code: string): string {
  return code.replace(IMPORT_META_URL_PATTERN, m =>
    m.replace('import.meta.url', 'document.baseURI')
  )
}
