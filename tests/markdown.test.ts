import { describe, expect, it } from 'vitest'
import { renderMarkdown } from '../app/utils/markdown'

/**
 * 聊天回复的 Markdown 渲染测试。
 *
 * 这里重点盯两件事：
 * 1. 常见语法要真的渲染出来（模型回复基本都是标题 + 列表 + 粗体 + 代码块）；
 * 2. **不能透传原始 HTML / 危险协议** —— 产物直接进 v-html，漏一个就是 XSS。
 */
describe('renderMarkdown', () => {
  it('渲染常见语法', () => {
    expect(renderMarkdown('**粗体**')).toContain('<strong>粗体</strong>')
    expect(renderMarkdown('*斜体*')).toContain('<em>斜体</em>')
    expect(renderMarkdown('行内 `code`')).toContain('<code>code</code>')
    expect(renderMarkdown('# 一级标题')).toContain('<h1>一级标题</h1>')
    expect(renderMarkdown('## 二级标题')).toContain('<h2>二级标题</h2>')
    expect(renderMarkdown('- a\n- b')).toContain('<li>a</li>')
    expect(renderMarkdown('1. a\n2. b')).toContain('<ol>')
    expect(renderMarkdown('> 引用')).toContain('<blockquote>')
    expect(renderMarkdown('| a | b |\n| - | - |\n| 1 | 2 |')).toContain('<table>')
    expect(renderMarkdown('~~删掉~~')).toContain('<del>删掉</del>')
  })

  it('代码块按语言高亮（shiki 双主题）', () => {
    const js = renderMarkdown('```js\nconst a = 1\n```')
    expect(js).toContain('class="shiki')
    expect(js).toContain('github-light')
    // 暗色只出变量，交给 main.css 的 .dark 规则接管 —— 两者都在才算「明暗都覆盖」
    expect(js).toContain('--shiki-dark')
    // 别名（shiki 自己登记的）也要能用
    expect(renderMarkdown('```py\ndef f(): pass\n```')).toContain('class="shiki')
    expect(renderMarkdown('```ts\nconst n: number = 1\n```')).toContain('class="shiki')
  })

  it('不认识的/没标语言的代码块退回纯代码块', () => {
    const rust = renderMarkdown('```rust\nfn main() {}\n```')
    expect(rust).toContain('class="md-code"')
    expect(rust).not.toContain('class="shiki')

    const bare = renderMarkdown('```\nplain text\n```')
    expect(bare).toContain('class="md-code"')
    expect(bare).toContain('plain text')
  })

  it('换行按 <br> 处理（聊天输出靠换行断句）', () => {
    expect(renderMarkdown('第一行\n第二行')).toContain('<br>')
  })

  it('原始 HTML 一律转义，绝不透传', () => {
    const script = renderMarkdown('<script>alert(1)</script>')
    expect(script).not.toContain('<script>')
    expect(script).toContain('&lt;script&gt;')

    const img = renderMarkdown('<img src=x onerror="alert(1)">')
    expect(img).not.toContain('<img src=x')

    // 代码块里的尖括号也不能变成真实标签
    // （shiki 会把 < 写成 &#x3C; 之类的实体，只要页面里没有真标签就行）
    const code = renderMarkdown('```html\n<b>hi</b>\n```')
    expect(code).not.toContain('<b>')
    expect(code).not.toContain('</b>')
    expect(code).toContain('hi')
  })

  it('链接/图片只放行安全协议', () => {
    expect(renderMarkdown('[点我](javascript:alert(1))')).not.toContain('javascript:')
    expect(renderMarkdown('[点我](JavaScript:alert(1))')).not.toContain('JavaScript:')
    expect(renderMarkdown('![x](data:text/html,<script>1</script>)')).not.toContain('data:text/html')
    expect(renderMarkdown('[站点](https://example.com/a?b=1)')).toContain('href="https://example.com/a?b=1"')
    expect(renderMarkdown('[锚点](#section)')).toContain('href="#section"')
  })

  it('空输入不炸', () => {
    expect(renderMarkdown('')).toBe('')
    expect(renderMarkdown(null)).toBe('')
  })
})
