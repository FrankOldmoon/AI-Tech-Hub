import { Marked } from 'marked'
import { createHighlighterCoreSync } from 'shiki/core'
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript'
import bash from 'shiki/dist/langs/bash.mjs'
import css from 'shiki/dist/langs/css.mjs'
import html from 'shiki/dist/langs/html.mjs'
import javascript from 'shiki/dist/langs/javascript.mjs'
import json from 'shiki/dist/langs/json.mjs'
import markdown from 'shiki/dist/langs/markdown.mjs'
import python from 'shiki/dist/langs/python.mjs'
import sql from 'shiki/dist/langs/sql.mjs'
import typescript from 'shiki/dist/langs/typescript.mjs'
import vue from 'shiki/dist/langs/vue.mjs'
import githubDark from 'shiki/dist/themes/github-dark.mjs'
import githubLight from 'shiki/dist/themes/github-light.mjs'

/**
 * 聊天回复用的 Markdown → HTML（含代码高亮）。
 *
 * 解析用 marked（GFM：表格、删除线、任务列表、自动链接都支持），但它只负责出结构；
 * 代码块交给 shiki 上色。
 *
 * 为了让产物可以安全地 `v-html`，做了两处收紧：
 * 1. **原始 HTML 一律转义成文本**：模型输出里的 `<script>`、`<img onerror=…>` 只会被
 *    当字面量显示出来，不会被浏览器执行；
 * 2. **链接/图片只放行安全协议**（http/https/mailto/tel/锚点/站内路径），
 *    `[点我](javascript:alert(1))` 这类会被降级成 `#`。
 *
 * 高亮用 shiki 的**同步 core + JS 正则引擎**（免 WASM，浏览器与 SSR 都能跑），只装
 * 模型回复里常见的十种语言，不认得的语言退回转义后的纯代码块。
 * 主题用 github-light / github-dark 双份：浅色走内联 color/background-color，
 * 暗色只写进 `--shiki-dark*` 变量，由 main.css 里一条 `.dark` 规则接管 ——
 * 这样不必为暗色再高亮一遍。
 */

const marked = new Marked({ gfm: true, breaks: true })

const highlighter = createHighlighterCoreSync({
  themes: [githubLight, githubDark],
  langs: [javascript, typescript, vue, html, css, json, python, bash, markdown, sql],
  engine: createJavaScriptRegexEngine()
})
const loadedLangs = new Set(highlighter.getLoadedLanguages())
const SHIKI_THEMES = { light: 'github-light', dark: 'github-dark' }

/** 允许出现在 href/src 里的协议（其余一律降级为 #） */
const SAFE_URL = /^(?:https?:|mailto:|tel:|#|\/)/i

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  '\'': '&#39;'
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, c => HTML_ESCAPES[c]!)
}

function safeUrl(url: string): string {
  const trimmed = (url ?? '').trim()
  return SAFE_URL.test(trimmed) ? escapeHtml(trimmed) : '#'
}

function plainCode(code: string): string {
  return `<pre class="md-code"><code>${escapeHtml(code)}</code></pre>`
}

function highlightCode(code: string, lang: string | null | undefined): string {
  // 语言标记可能带附加信息（```js title="a.js"），只取第一个词；
  // 别名（js / ts / py / sh…）由 shiki 自己登记，认识就上色，不认识就退回纯代码块
  const language = (lang ?? '').trim().split(/\s+/)[0]!.toLowerCase()
  if (!language || !loadedLangs.has(language)) return plainCode(code)
  try {
    return highlighter.codeToHtml(code, { lang: language, themes: SHIKI_THEMES })
  } catch {
    return plainCode(code)
  }
}

marked.use({
  renderer: {
    // 原始 HTML：转义后原样显示，绝不透传
    html(token) {
      return escapeHtml(token.text)
    },
    code(token) {
      return highlightCode(token.text, token.lang)
    },
    link(token) {
      const text = this.parser.parseInline(token.tokens)
      const title = token.title ? ` title="${escapeHtml(token.title)}"` : ''
      return `<a href="${safeUrl(token.href)}" target="_blank" rel="noopener noreferrer"${title}>${text}</a>`
    },
    image(token) {
      const title = token.title ? ` title="${escapeHtml(token.title)}"` : ''
      return `<img src="${safeUrl(token.href)}" alt="${escapeHtml(token.text ?? '')}"${title} />`
    }
  }
})

export function renderMarkdown(src: string | null | undefined): string {
  return marked.parse(src ?? '', { async: false })
}
