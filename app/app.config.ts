export default defineAppConfig({
  ui: {
    colors: {
      primary: 'green',
      neutral: 'slate'
    },
    header: {
      slots: {
        // 默认 center 是 hidden lg:flex（<1024px 隐藏导航容器），导致中屏 768–1023px 顶部导航断层。
        // 改为始终 flex，显隐交给导航自身的 `hidden md:flex` 控制（≥768 显示水平导航）。
        center: 'flex min-w-0',
        // 汉堡按钮默认 lg:hidden；改为 md:hidden，让 <768px 才显示，避免 768–1023px 与水平导航重复。
        toggle: 'md:hidden'
      }
    }
  }
})
